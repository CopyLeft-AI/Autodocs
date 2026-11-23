"""Regression tests for persistent retries after HTTP status errors."""

import asyncio
from tempfile import TemporaryDirectory

import httpx
import pytest

from job_runner import JobRunner
from job_store import JobStore


@pytest.mark.parametrize("status_code", [429, 503])
def test_transient_http_status_schedules_retry(status_code):
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = f"http-retry-{status_code}"
            await store.create(job_id, "Synthetic", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)

            async def fail(_job_id):
                request = httpx.Request(
                    "POST",
                    "https://api.ai.cloud-temple.com/v1/chat/completions",
                )
                response = httpx.Response(status_code, request=request)
                response.raise_for_status()

            runner._run = fail
            await runner._run_supervised(job_id)

            state = await store.status(job_id)
            assert state["status"] == "queued"
            assert state["retryCount"] == 1
            assert state["nextRetryAt"]
            assert await store.input_content(job_id) == "input"

    asyncio.run(scenario())


def test_permanent_http_status_does_not_retry():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "http-401"
            await store.create(job_id, "Synthetic", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)

            async def fail(_job_id):
                request = httpx.Request(
                    "POST",
                    "https://api.ai.cloud-temple.com/v1/chat/completions",
                )
                response = httpx.Response(401, request=request)
                response.raise_for_status()

            runner._run = fail
            await runner._run_supervised(job_id)

            state = await store.status(job_id)
            assert state["status"] == "failed"
            assert not state.get("nextRetryAt")
            assert not state.get("retryCount")

    asyncio.run(scenario())


@pytest.mark.parametrize("cooldown", [600, 7200])
def test_http_429_respects_retry_after_600_seconds(cooldown):
    """A provider cooldown must override a shorter scheduler backoff."""
    from datetime import datetime, timezone

    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = f"http-retry-after-{cooldown}"
            await store.create(job_id, "Synthetic", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)

            async def fail(_job_id):
                request = httpx.Request(
                    "POST",
                    "https://api.ai.cloud-temple.com/v1/chat/completions",
                )
                response = httpx.Response(
                    429,
                    headers={"Retry-After": str(cooldown)},
                    request=request,
                )
                response.raise_for_status()

            runner._run = fail
            before = datetime.now(timezone.utc)

            await runner._run_supervised(job_id)

            state = await store.status(job_id)
            deadline = datetime.fromisoformat(
                state["nextRetryAt"].replace("Z", "+00:00")
            )
            delay = (deadline - before).total_seconds()

            assert state["status"] == "queued"
            assert state["retryCount"] == 1
            assert cooldown <= delay <= cooldown + 10

    asyncio.run(scenario())


def test_extremely_long_retry_after_is_persisted_safely():
    """An unrepresentably distant cooldown must not fail the job."""
    from datetime import datetime, timezone

    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "extreme-retry-after"
            await store.create(job_id, "Synthetic", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)

            async def fail(_job_id):
                request = httpx.Request(
                    "POST",
                    "https://api.ai.cloud-temple.com/v1/chat/completions",
                )
                response = httpx.Response(
                    429,
                    headers={"Retry-After": "1e20"},
                    request=request,
                )
                response.raise_for_status()

            runner._run = fail
            await runner._run_supervised(job_id)

            state = await store.status(job_id)
            assert state["status"] == "queued"
            assert state["retryCount"] == 1
            assert datetime.fromisoformat(
                state["nextRetryAt"]
            ) == datetime.max.replace(tzinfo=timezone.utc)

    asyncio.run(scenario())
