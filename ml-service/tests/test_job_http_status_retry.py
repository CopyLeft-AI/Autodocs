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
