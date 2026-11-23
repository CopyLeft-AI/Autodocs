"""Cancellation and resume during scheduled network retries."""

import asyncio
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx

from job_runner import JobRunner
from job_store import JobStore


async def wait_until(predicate, timeout=2):
    async def check():
        while not await predicate():
            await asyncio.sleep(0.01)

    await asyncio.wait_for(check(), timeout)


def test_cancel_during_retry_wait_never_restarts_job():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "cancel-retry-test"
            await store.create(job_id, "Synthetic", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)
            attempts = 0

            async def process(current_id):
                nonlocal attempts
                attempts += 1
                raise httpx.ConnectError("synthetic DNS error")

            async def timer_exists():
                return job_id in runner.retry_tasks

            runner._run = process

            try:
                with patch("job_runner.random.uniform", return_value=0.15):
                    await runner.start()
                    await wait_until(timer_exists)

                    assert (await store.status(job_id))["status"] == "queued"
                    assert attempts == 1

                    await runner.cancel(job_id)
                    await asyncio.sleep(0.4)

                    assert (await store.status(job_id))["status"] == "cancelled"
                    assert attempts == 1
                    assert job_id not in runner.retry_tasks
            finally:
                await runner.stop()

    asyncio.run(scenario())


def test_paused_network_failure_resumes_and_completes():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "pause-retry-test"
            await store.create(job_id, "Synthetic", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)
            attempts = 0
            finished = asyncio.Event()

            async def process(current_id):
                nonlocal attempts
                attempts += 1

                if attempts == 1:
                    await runner.pause(current_id)
                    raise httpx.ConnectError("synthetic DNS error")

                await store.completed(current_id, {"content": []})
                finished.set()

            async def paused_retry_ready():
                state = await store.status(job_id)
                return (
                    state["status"] == "paused"
                    and state.get("retryCount") == 1
                    and job_id not in runner.job_tasks
                )

            runner._run = process

            try:
                with patch("job_runner.random.uniform", return_value=0.05):
                    await runner.start()
                    await wait_until(paused_retry_ready)

                    assert attempts == 1

                    await runner.resume(job_id)
                    await asyncio.wait_for(finished.wait(), timeout=3)

                    state = await store.status(job_id)
                    assert state["status"] == "completed"
                    assert attempts == 2
            finally:
                await runner.stop()

    asyncio.run(scenario())
