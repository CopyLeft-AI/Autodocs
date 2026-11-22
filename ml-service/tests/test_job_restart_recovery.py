"""Recovery of interrupted jobs after an ML-service restart."""

import asyncio
from tempfile import TemporaryDirectory

from job_store import JobStore


def test_running_job_recovers_but_restart_loop_is_bounded():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            await store.create("job-1", "Synthetic", "saved input")
            assert await store.running("job-1")

            for recovery_number in range(1, 4):
                restarted = JobStore(directory)
                assert await restarted.pending_job_ids() == ["job-1"]

                state = await restarted.status("job-1")
                assert state["status"] == "queued"
                assert state["restartRecoveryCount"] == recovery_number
                assert state["percent"] == 0
                assert state["startedAt"] is None
                assert await restarted.input_content("job-1") == "saved input"

                assert await restarted.running("job-1")

            restarted = JobStore(directory)
            assert await restarted.pending_job_ids() == []

            state = await restarted.status("job-1")
            assert state["status"] == "failed"
            assert "recovery limit" in state["error"]

    asyncio.run(scenario())


def test_paused_job_without_network_retry_stays_failed():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            await store.create("job-2", "Synthetic", "input")
            assert await store.running("job-2")
            await store.pause("job-2")

            restarted = JobStore(directory)
            assert await restarted.pending_job_ids() == []
            assert (await restarted.status("job-2"))["status"] == "failed"

    asyncio.run(scenario())
