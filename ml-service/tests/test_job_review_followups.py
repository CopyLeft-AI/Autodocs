"""Regression tests for the second Copilot review of PR #8."""

import asyncio
from tempfile import TemporaryDirectory

import httpx
import pytest

from job_runner import JobRunner
from job_store import JobStore


@pytest.mark.parametrize(
    "error_type",
    [
        httpx.ReadError,
        httpx.WriteError,
        httpx.ReadTimeout,
        httpx.WriteTimeout,
        httpx.RemoteProtocolError,
    ],
)
def test_transient_response_errors_schedule_persistent_retry(error_type):
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "transient-response-test"
            await store.create(job_id, "Synthetic", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)

            async def fail(_):
                raise error_type("synthetic interrupted response")

            runner._run = fail

            await runner._run_supervised(job_id)

            state = await store.status(job_id)
            assert state["status"] == "queued"
            assert state["retryCount"] == 1
            assert state["nextRetryAt"]
            assert await store.input_content(job_id) == "input"

            # The job was queued for a later retry.
            assert runner.queue.get_nowait() == job_id

    asyncio.run(scenario())


def test_local_protocol_error_is_not_retried():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "local-protocol-test"
            await store.create(job_id, "Synthetic", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)

            async def fail(_):
                raise httpx.LocalProtocolError(
                    "synthetic invalid local request"
                )

            runner._run = fail

            await runner._run_supervised(job_id)

            state = await store.status(job_id)
            assert state["status"] == "failed"
            assert not state.get("nextRetryAt")
            assert not state.get("retryCount")

    asyncio.run(scenario())


def test_pause_scheduled_retry_prevents_execution_until_resumed():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "scheduled-pause-test"
            await store.create(job_id, "Synthetic", "input")

            # Simulate a previous network failure.
            assert await store.running(job_id)
            assert await store.defer_network_retry(
                job_id, attempt=1, delay_seconds=0.4
            )

            initial = await store.status(job_id)
            deadline = initial["nextRetryAt"]

            runner = JobRunner(store, max_concurrent_jobs=1)
            attempts = 0
            finished = asyncio.Event()

            async def process(current_id):
                nonlocal attempts
                attempts += 1
                await store.completed(
                    current_id, {"content": []}
                )
                finished.set()

            runner._run = process

            try:
                await runner.start()

                # Wait until the worker has created the retry timer.
                for _ in range(200):
                    if job_id in runner.retry_tasks:
                        break
                    await asyncio.sleep(0.01)

                assert job_id in runner.retry_tasks

                paused = await runner.pause(job_id)

                assert paused["status"] == "paused"
                assert paused["retryCount"] == 1
                assert paused["nextRetryAt"] == deadline
                assert job_id not in runner.retry_tasks

                # Even after the original deadline, the job remains paused.
                await asyncio.sleep(0.5)

                state = await store.status(job_id)
                assert state["status"] == "paused"
                assert attempts == 0

                resumed = await runner.resume(job_id)

                assert resumed["status"] == "queued"
                assert resumed["nextRetryAt"] == deadline

                await asyncio.wait_for(
                    finished.wait(), timeout=3
                )

                state = await store.status(job_id)
                assert state["status"] == "completed"
                assert state["retryCount"] == 1
                assert attempts == 1

            finally:
                await runner.stop()

    asyncio.run(scenario())


def test_normal_queued_job_still_cannot_be_paused():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "normal-queue-test"
            await store.create(job_id, "Synthetic", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)

            with pytest.raises(ValueError):
                await runner.pause(job_id)

            state = await store.status(job_id)
            assert state["status"] == "queued"
            assert not state.get("nextRetryAt")

    asyncio.run(scenario())


def test_paused_scheduled_retry_survives_restart():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "paused-restart-test"
            await store.create(job_id, "Synthetic", "input")

            assert await store.running(job_id)
            assert await store.defer_network_retry(
                job_id, attempt=1, delay_seconds=60
            )

            runner = JobRunner(store)
            paused = await runner.pause(job_id)

            assert paused["status"] == "paused"

            # Recreate the store as if the service restarted.
            recovered = JobStore(directory)

            assert await recovered.pending_job_ids() == []

            saved = await recovered.status(job_id)
            assert saved["status"] == "paused"
            assert saved["retryCount"] == 1
            assert saved["nextRetryAt"]

            new_runner = JobRunner(recovered)
            resumed = await new_runner.resume(job_id)

            assert resumed["status"] == "queued"
            assert resumed["retryCount"] == 1
            assert new_runner.queue.get_nowait() == job_id

    asyncio.run(scenario())


def test_cancel_paused_retry_removes_control_without_timer():
    """A paused retry without a worker must not leak JobControl."""
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "cancel-paused-no-timer"
            await store.create(job_id, "Synthetic", "input")

            assert await store.running(job_id)
            assert await store.defer_network_retry(
                job_id, attempt=1, delay_seconds=60
            )

            runner = JobRunner(store, max_concurrent_jobs=1)

            paused = await runner.pause(job_id)
            assert paused["status"] == "paused"
            assert job_id in runner.controls
            assert job_id not in runner.job_tasks
            assert job_id not in runner.retry_tasks

            cancelled = await runner.cancel(job_id)

            assert cancelled["status"] == "cancelled"
            assert job_id not in runner.controls
            assert job_id not in runner.job_tasks
            assert job_id not in runner.retry_tasks
            assert (await store.status(job_id))["status"] == "cancelled"

    asyncio.run(scenario())


def test_cancel_paused_retry_removes_control_after_timer_cancel():
    """Pause, then cancel a scheduled retry with an existing timer."""
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "cancel-paused-with-timer"
            await store.create(job_id, "Synthetic", "input")

            assert await store.running(job_id)
            assert await store.defer_network_retry(
                job_id, attempt=1, delay_seconds=60
            )

            runner = JobRunner(store, max_concurrent_jobs=1)

            try:
                await runner.start()

                for _ in range(200):
                    if job_id in runner.retry_tasks:
                        break
                    await asyncio.sleep(0.01)

                assert job_id in runner.retry_tasks
                timer = runner.retry_tasks[job_id]

                paused = await runner.pause(job_id)
                assert paused["status"] == "paused"
                assert job_id in runner.controls
                assert job_id not in runner.retry_tasks
                assert job_id not in runner.job_tasks

                cancelled = await runner.cancel(job_id)
                assert cancelled["status"] == "cancelled"

                await asyncio.gather(timer, return_exceptions=True)

                assert job_id not in runner.controls
                assert job_id not in runner.job_tasks
                assert job_id not in runner.retry_tasks
                assert (await store.status(job_id))["status"] == "cancelled"

            finally:
                await runner.stop()

    asyncio.run(scenario())


