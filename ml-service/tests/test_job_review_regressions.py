"""Regression tests for issues identified in PR #8 Copilot review."""

import asyncio
from datetime import datetime, timedelta, timezone
from tempfile import TemporaryDirectory

from job_metrics import active_seconds, estimate_remaining_seconds
from job_runner import JobRunner
from job_store import JobStore


def test_shutdown_stops_workers_before_cancelling_retry_timers():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "shutdown-review-test"

            await store.create(job_id, "Synthetic", "input")
            assert await store.running(job_id)
            assert await store.defer_network_retry(job_id, 1, 120.0)

            runner = JobRunner(store, max_concurrent_jobs=1)

            # Hold the worker while it reads a queued retry.
            status_entered = asyncio.Event()
            release_status = asyncio.Event()
            original_status = store.status

            async def delayed_status(current_id):
                status_entered.set()
                await release_status.wait()
                return await original_status(current_id)

            store.status = delayed_status

            await runner.start()
            await asyncio.wait_for(status_entered.wait(), timeout=2)

            timer_started = asyncio.Event()
            workers_stopped_at_timer_cleanup = False

            async def existing_timer():
                nonlocal workers_stopped_at_timer_cleanup
                timer_started.set()

                try:
                    await asyncio.sleep(60)
                except asyncio.CancelledError:
                    workers_stopped_at_timer_cleanup = all(
                        worker.done() for worker in runner.worker_tasks
                    )

                    # Under the old shutdown ordering, releasing this
                    # worker lets it create a new timer after the snapshot.
                    release_status.set()
                    await asyncio.sleep(0.05)
                finally:
                    runner.retry_tasks.pop("__shutdown_gate__", None)

            timer = asyncio.create_task(existing_timer())
            runner.retry_tasks["__shutdown_gate__"] = timer
            await timer_started.wait()

            try:
                await asyncio.wait_for(runner.stop(), timeout=3)

                assert workers_stopped_at_timer_cleanup, (
                    "Retry timers were cancelled before workers stopped"
                )

                assert not any(
                    not task.done()
                    for task in runner.retry_tasks.values()
                ), "A retry timer survived shutdown"
            finally:
                release_status.set()
                remaining = list(runner.retry_tasks.values())

                for task in remaining:
                    task.cancel()

                await asyncio.gather(
                    *remaining, return_exceptions=True
                )

    asyncio.run(scenario())


def test_network_retry_resets_pause_accounting_for_eta():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "retry-eta-review-test"

            await store.create(job_id, "Synthetic", "input")
            assert await store.running(job_id)

            await store.pause(job_id)

            # Simulate a long pause during the previous attempt.
            state = await store.status(job_id)
            state["pausedAt"] = (
                datetime.now(timezone.utc) - timedelta(seconds=180)
            ).isoformat()
            store._write_json(store._state_path(job_id), state)

            await store.resume(job_id)

            state = await store.status(job_id)
            assert state["pausedSeconds"] >= 170

            assert await store.defer_network_retry(
                job_id, attempt=1, delay_seconds=0
            )
            assert await store.running(job_id)

            retry_state = await store.status(job_id)

            assert retry_state["status"] == "running"
            assert retry_state["retryCount"] == 1
            assert retry_state["pausedAt"] is None
            assert retry_state["pausedSeconds"] == 0.0

            retry_state["percent"] = 50
            started = datetime.fromisoformat(
                retry_state["startedAt"]
            )
            now = started + timedelta(seconds=45)

            assert abs(
                active_seconds(retry_state, now) - 45.0
            ) < 0.001

            assert estimate_remaining_seconds(
                retry_state, now
            ) == 45

    asyncio.run(scenario())
