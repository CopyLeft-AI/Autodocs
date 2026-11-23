"""Regression test for cancellation and deletion races."""

import asyncio
from tempfile import TemporaryDirectory

from job_runner import JobRunner
from job_store import JobStore


def test_cancel_delete_does_not_stop_next_job():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            await store.create("first", "First", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)
            entered = asyncio.Event()
            release = asyncio.Event()
            second_finished = asyncio.Event()

            original_running = store.running

            async def delayed_running(job_id):
                if job_id == "first":
                    entered.set()
                    await release.wait()
                return await original_running(job_id)

            async def process(job_id):
                await store.completed(job_id, {"content": []})
                if job_id == "second":
                    second_finished.set()

            store.running = delayed_running
            runner._run = process

            try:
                await runner.start()
                await asyncio.wait_for(entered.wait(), timeout=2)

                await runner.cancel("first")
                await store.delete_inactive("first")

                await store.create("second", "Second", "input")
                await runner.enqueue("second")

                release.set()
                await asyncio.wait_for(
                    second_finished.wait(), timeout=2
                )

                assert (
                    await store.status("second")
                )["status"] == "completed"
                assert not runner.worker_tasks[0].done()
            finally:
                release.set()
                await runner.stop()

    asyncio.run(scenario())


def test_cancel_delete_during_failure_does_not_stop_worker():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            await store.create("first", "First", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)
            first_started = asyncio.Event()
            release = asyncio.Event()
            second_finished = asyncio.Event()

            async def process(job_id):
                if job_id == "first":
                    first_started.set()
                    try:
                        await asyncio.sleep(3600)
                    except asyncio.CancelledError:
                        await release.wait()
                        raise RuntimeError("Synthetic cleanup failure")

                await store.completed(job_id, {"content": []})
                if job_id == "second":
                    second_finished.set()

            runner._run = process

            try:
                await runner.start()
                await asyncio.wait_for(first_started.wait(), timeout=2)

                await runner.cancel("first")
                await store.delete_inactive("first")

                await store.create("second", "Second", "input")
                await runner.enqueue("second")

                release.set()

                await asyncio.wait_for(
                    second_finished.wait(), timeout=2
                )

                assert (
                    await store.status("second")
                )["status"] == "completed"
                assert not runner.worker_tasks[0].done()

            finally:
                release.set()
                await runner.stop()

    asyncio.run(scenario())


def test_cancel_delete_during_network_failure_does_not_stop_worker():
    """A deleted job's network error must not terminate its worker."""
    import httpx

    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            await store.create("first", "First", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)
            first_started = asyncio.Event()
            release = asyncio.Event()
            second_finished = asyncio.Event()

            async def process(job_id):
                if job_id == "first":
                    first_started.set()
                    try:
                        await asyncio.sleep(3600)
                    except asyncio.CancelledError:
                        await release.wait()
                        raise httpx.ReadError("Synthetic interrupted response")

                await store.completed(job_id, {"content": []})
                if job_id == "second":
                    second_finished.set()

            runner._run = process

            try:
                await runner.start()
                await asyncio.wait_for(first_started.wait(), timeout=2)

                await runner.cancel("first")
                await store.delete_inactive("first")

                await store.create("second", "Second", "input")
                await runner.enqueue("second")

                release.set()
                await asyncio.wait_for(second_finished.wait(), timeout=2)

                assert (await store.status("second"))["status"] == "completed"
                assert not runner.worker_tasks[0].done()
            finally:
                release.set()
                await runner.stop()

    asyncio.run(scenario())


def test_delete_during_retry_scheduling_keeps_worker_alive():
    """Deleting a job while its retry is persisted must not kill the worker."""
    import httpx

    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            await store.create("first", "First", "input")

            runner = JobRunner(store, max_concurrent_jobs=1)
            retry_entered = asyncio.Event()
            release_retry = asyncio.Event()
            second_finished = asyncio.Event()

            original_defer = store.defer_network_retry

            async def delayed_defer(job_id, attempt, delay_seconds):
                if job_id == "first":
                    retry_entered.set()
                    await release_retry.wait()
                return await original_defer(job_id, attempt, delay_seconds)

            async def process(job_id):
                if job_id == "first":
                    raise httpx.ReadError("Synthetic interrupted response")
                await store.completed(job_id, {"content": []})
                if job_id == "second":
                    second_finished.set()

            store.defer_network_retry = delayed_defer
            runner._run = process

            try:
                await runner.start()
                await asyncio.wait_for(retry_entered.wait(), timeout=2)

                await runner.cancel("first")
                await store.delete_inactive("first")

                await store.create("second", "Second", "input")
                await runner.enqueue("second")

                release_retry.set()

                await asyncio.wait_for(second_finished.wait(), timeout=2)

                assert (await store.status("second"))["status"] == "completed"
                assert not runner.worker_tasks[0].done()
            finally:
                release_retry.set()
                await runner.stop()

    asyncio.run(scenario())
