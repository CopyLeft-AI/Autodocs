"""Tests for pause, resume, cancel, concurrency and live ETA of ML jobs."""

import asyncio
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from job_control import JobControl
from job_metrics import active_seconds, estimate_remaining_seconds
from job_runner import JobRunner
from job_store import JobStore


class JobStoreControlTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = JobStore(self.temp.name)

    async def create_running_job(self):
        job_id = str(uuid4())
        await self.store.create(job_id, "Test", "recording")
        self.assertTrue(await self.store.running(job_id))
        return job_id

    async def test_pause_then_resume(self):
        job_id = await self.create_running_job()
        paused = await self.store.pause(job_id)
        self.assertEqual(paused["status"], "paused")
        self.assertIsNotNone(paused["pausedAt"])
        resumed = await self.store.resume(job_id)
        self.assertEqual(resumed["status"], "running")
        self.assertIsNone(resumed["pausedAt"])
        self.assertGreaterEqual(resumed["pausedSeconds"], 0)

    async def test_queued_job_cannot_be_paused_or_resumed(self):
        job_id = str(uuid4())
        await self.store.create(job_id, "Test", "recording")
        with self.assertRaises(ValueError):
            await self.store.pause(job_id)
        with self.assertRaises(ValueError):
            await self.store.resume(job_id)

    async def test_cancel_queued_job_prevents_start(self):
        job_id = str(uuid4())
        await self.store.create(job_id, "Test", "recording")
        await self.store.cancel(job_id)
        self.assertFalse(await self.store.running(job_id))

    async def test_cancel_finished_job_is_rejected(self):
        job_id = await self.create_running_job()
        await self.store.completed(job_id, {"content": []})
        with self.assertRaises(ValueError):
            await self.store.cancel(job_id)

    async def test_late_completion_does_not_overwrite_cancel(self):
        job_id = await self.create_running_job()
        await self.store.cancel(job_id)
        await self.store.completed(job_id, {"content": []})
        await self.store.failed(job_id, "late error")
        self.assertEqual((await self.store.status(job_id))["status"], "cancelled")

    async def test_cancelled_job_can_be_deleted(self):
        job_id = await self.create_running_job()
        await self.store.cancel(job_id)
        await self.store.delete_inactive(job_id)
        with self.assertRaises(KeyError):
            await self.store.status(job_id)

    async def test_restart_fails_paused_jobs(self):
        job_id = await self.create_running_job()
        await self.store.pause(job_id)
        self.assertEqual(await self.store.pending_job_ids(), [])
        self.assertEqual((await self.store.status(job_id))["status"], "failed")


class EstimateTests(unittest.TestCase):
    NOW = datetime(2026, 11, 19, 12, 0, 0, tzinfo=timezone.utc)

    def state(self, **overrides):
        base = {"status": "running", "percent": 25, "startedAt": (self.NOW - timedelta(seconds=100)).isoformat(), "pausedAt": None, "pausedSeconds": 0.0}
        return {**base, **overrides}

    def test_linear_extrapolation(self):
        self.assertEqual(estimate_remaining_seconds(self.state(), self.NOW), 300)

    def test_no_estimate_with_too_little_data(self):
        self.assertIsNone(estimate_remaining_seconds(self.state(percent=2), self.NOW))
        self.assertIsNone(estimate_remaining_seconds(self.state(startedAt=(self.NOW - timedelta(seconds=10)).isoformat()), self.NOW))

    def test_no_estimate_when_not_running(self):
        self.assertIsNone(estimate_remaining_seconds(self.state(status="queued", startedAt=None), self.NOW))
        self.assertIsNone(estimate_remaining_seconds(self.state(status="completed"), self.NOW))

    def test_paused_time_is_excluded(self):
        self.assertEqual(active_seconds(self.state(pausedSeconds=40.0), self.NOW), 60.0)

    def test_clock_is_frozen_while_paused(self):
        paused = self.state(status="paused", pausedAt=(self.NOW - timedelta(seconds=30)).isoformat())
        self.assertEqual(active_seconds(paused, self.NOW), 70.0)


class JobControlTests(unittest.IsolatedAsyncioTestCase):
    async def test_checkpoint_blocks_while_paused(self):
        control = JobControl()
        control.pause()
        waiter = asyncio.create_task(control.checkpoint())
        await asyncio.sleep(0.01)
        self.assertFalse(waiter.done())
        control.resume()
        await asyncio.wait_for(waiter, 1)


class JobRunnerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = JobStore(self.temp.name)

    async def submit(self, runner):
        job_id = str(uuid4())
        await self.store.create(job_id, "Test", "recording")
        await runner.enqueue(job_id)
        return job_id

    async def wait_for_status(self, job_id, status):
        for _ in range(200):
            if (await self.store.status(job_id))["status"] == status:
                return
            await asyncio.sleep(0.01)
        self.fail(f"job never reached {status}")

    async def test_runs_jobs_in_parallel_up_to_the_limit(self):
        runner = JobRunner(self.store, max_concurrent_jobs=2)
        started: list[str] = []
        release = asyncio.Event()

        async def fake_run(job_id):
            started.append(job_id)
            await release.wait()

        runner._run = fake_run
        await runner.start()
        self.addAsyncCleanup(runner.stop)
        ids = [await self.submit(runner) for _ in range(3)]
        await asyncio.sleep(0.05)
        self.assertEqual(len(started), 2)
        release.set()
        await asyncio.sleep(0.05)
        self.assertEqual(sorted(started), sorted(ids))

    async def test_cancel_interrupts_running_job_and_frees_worker(self):
        runner = JobRunner(self.store, max_concurrent_jobs=1)

        async def fake_run(job_id):
            await asyncio.sleep(60)

        runner._run = fake_run
        await runner.start()
        self.addAsyncCleanup(runner.stop)
        first = await self.submit(runner)
        await self.wait_for_status(first, "running")
        second = await self.submit(runner)
        await runner.cancel(first)
        await self.wait_for_status(second, "running")
        self.assertEqual((await self.store.status(first))["status"], "cancelled")

    async def test_cancelled_queued_job_is_skipped(self):
        runner = JobRunner(self.store, max_concurrent_jobs=1)
        ran: list[str] = []

        async def fake_run(job_id):
            ran.append(job_id)

        runner._run = fake_run
        job_id = await self.submit(runner)
        await runner.cancel(job_id)
        await runner.start()
        self.addAsyncCleanup(runner.stop)
        await asyncio.sleep(0.05)
        self.assertEqual(ran, [])
        self.assertEqual((await self.store.status(job_id))["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()
