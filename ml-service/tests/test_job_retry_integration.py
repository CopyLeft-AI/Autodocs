"""Exercise the real worker queue and delayed retry scheduler."""

import asyncio
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx

from job_runner import JobRunner
from job_store import JobStore


def test_network_failure_recovers_without_user_action():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "synthetic-retry-success"

            await store.create(job_id, "Synthetic", "test input")

            runner = JobRunner(store, max_concurrent_jobs=1)
            runner.max_network_retries = 1

            attempts = []
            finished = asyncio.Event()

            async def synthetic_processing(current_job_id):
                attempts.append(current_job_id)

                if len(attempts) == 1:
                    raise httpx.ConnectError(
                        "synthetic DNS connection failure"
                    )

                await store.completed(
                    current_job_id,
                    {"content": []},
                )
                finished.set()

            runner._run = synthetic_processing

            try:
                # Shorten only the synthetic test's retry delay.
                with patch(
                    "job_runner.random.uniform",
                    return_value=0.01,
                ):
                    await runner.start()

                    await asyncio.wait_for(
                        finished.wait(),
                        timeout=3,
                    )

                state = await store.status(job_id)

                assert attempts == [job_id, job_id]
                assert state["status"] == "completed"
                assert state["retryCount"] == 1
                assert state["nextRetryAt"] is None
                assert state["percent"] == 100

            finally:
                await runner.stop()

    asyncio.run(scenario())
