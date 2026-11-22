"""Regression tests for persistent network retries."""

import asyncio
from tempfile import TemporaryDirectory

import httpx

from job_runner import JobRunner
from job_store import JobStore


def test_connection_failure_is_deferred_then_exhausted():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            await store.create("retry-job", "Synthetic", "test input")

            runner = JobRunner(store, max_concurrent_jobs=1)
            runner.max_network_retries = 1
            attempts = []

            async def fail(job_id):
                attempts.append(job_id)
                raise httpx.ConnectError("synthetic DNS failure")

            runner._run = fail

            await runner._run_supervised("retry-job")
            state = await store.status("retry-job")

            assert state["status"] == "queued"
            assert state["retryCount"] == 1
            assert state["nextRetryAt"]
            assert await store.input_content("retry-job") == "test input"

            await runner._run_supervised("retry-job")
            state = await store.status("retry-job")

            assert state["status"] == "failed"
            assert len(attempts) == 2

    asyncio.run(scenario())


def test_deferred_job_survives_restart_and_frees_worker():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)

            await store.create("waiting-job", "Waiting", "input")
            assert await store.running("waiting-job")
            assert await store.defer_network_retry(
                "waiting-job", attempt=1, delay_seconds=60
            )

            await store.create("ready-job", "Ready", "input")

            # Simulate reconstruction after an ML-service restart.
            recovered = JobStore(directory)
            runner = JobRunner(recovered, max_concurrent_jobs=1)
            ready_processed = asyncio.Event()
            processed = []

            async def succeed(job_id):
                processed.append(job_id)
                await recovered.completed(job_id, {"content": []})
                if job_id == "ready-job":
                    ready_processed.set()

            runner._run = succeed

            try:
                await runner.start()
                await asyncio.wait_for(
                    ready_processed.wait(), timeout=2
                )

                assert processed == ["ready-job"]

                waiting = await recovered.status("waiting-job")
                assert waiting["status"] == "queued"
                assert waiting["retryCount"] == 1

                # Cancellation must prevent a delayed retry.
                await runner.cancel("waiting-job")
                cancelled = await recovered.status("waiting-job")
                assert cancelled["status"] == "cancelled"
            finally:
                await runner.stop()

    asyncio.run(scenario())


def test_non_network_error_is_not_retried():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            await store.create("invalid-job", "Invalid", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)

            async def invalid(_job_id):
                raise ValueError("synthetic permanent failure")

            runner._run = invalid
            await runner._run_supervised("invalid-job")

            state = await store.status("invalid-job")
            assert state["status"] == "failed"
            assert state.get("retryCount", 0) == 0

    asyncio.run(scenario())
