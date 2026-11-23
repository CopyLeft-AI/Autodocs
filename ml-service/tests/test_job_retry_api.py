"""HTTP API integration test for an automatically recovered ML job."""

import asyncio
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx

import app as ml_api
from job_runner import JobRunner
from job_store import JobStore


def test_http_api_exposes_scheduled_retry_and_completion():
    async def scenario():
        with TemporaryDirectory() as directory:
            store = JobStore(directory)
            job_id = "synthetic-http-retry"
            await store.create(job_id, "Synthetic", "test input")

            runner = JobRunner(store, max_concurrent_jobs=1)
            runner.max_network_retries = 1

            attempts = 0
            finished = asyncio.Event()

            async def synthetic_processing(current_job_id):
                nonlocal attempts
                attempts += 1

                if attempts == 1:
                    raise httpx.ConnectError(
                        "synthetic DNS failure"
                    )

                await store.completed(
                    current_job_id,
                    {"content": []},
                )
                finished.set()

            runner._run = synthetic_processing

            transport = httpx.ASGITransport(app=ml_api.app)

            with (
                patch.object(ml_api, "job_store", store),
                patch.object(ml_api, "job_runner", runner),
                patch(
                    "job_runner.random.uniform",
                    return_value=0.8,
                ),
            ):
                await runner.start()

                try:
                    async with httpx.AsyncClient(
                        transport=transport,
                        base_url="http://ml.test",
                    ) as client:

                        scheduled = None

                        for _ in range(100):
                            response = await client.get(
                                f"/jobs/{job_id}"
                            )
                            assert response.status_code == 200

                            state = response.json()
                            if (
                                state["status"] == "queued"
                                and state.get("retryCount") == 1
                            ):
                                scheduled = state
                                break

                            await asyncio.sleep(0.01)

                        assert scheduled is not None
                        assert scheduled["nextRetryAt"]

                        await asyncio.wait_for(
                            finished.wait(),
                            timeout=5,
                        )

                        response = await client.get(
                            f"/jobs/{job_id}"
                        )
                        assert response.status_code == 200

                        state = response.json()
                        assert state["status"] == "completed"
                        assert state["percent"] == 100
                        assert state["nextRetryAt"] is None
                        assert attempts == 2

                finally:
                    await runner.stop()

    asyncio.run(scenario())
