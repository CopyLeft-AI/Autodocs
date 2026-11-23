"""Paused network retries must not block workers or be lost."""

import asyncio
from tempfile import TemporaryDirectory

import httpx

from job_runner import JobRunner
from job_store import JobStore


def test_paused_connection_failure_is_resumable_after_restart():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            await store.create("paused-retry", "Synthetic", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)

            async def fail_while_paused(job_id):
                await store.pause(job_id)
                raise httpx.ConnectError("synthetic DNS failure")

            runner._run = fail_while_paused

            # Must finish promptly instead of blocking the worker.
            await asyncio.wait_for(
                runner._run_supervised("paused-retry"),
                timeout=2,
            )

            state = await store.status("paused-retry")
            assert state["status"] == "paused"
            assert state["retryCount"] == 1
            assert state["nextRetryAt"]

            # Simulate a service restart.
            recovered = JobStore(directory)
            assert await recovered.pending_job_ids() == []
            assert (await recovered.status("paused-retry"))["status"] == "paused"

            new_runner = JobRunner(recovered, max_concurrent_jobs=1)
            resumed = await new_runner.resume("paused-retry")

            assert resumed["status"] == "queued"
            assert new_runner.queue.get_nowait() == "paused-retry"

    asyncio.run(scenario())
