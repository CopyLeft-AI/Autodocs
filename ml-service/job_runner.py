"""One serialized worker that turns persisted AutoDocs jobs into model results."""

import asyncio
import json
import logging
import os
import tempfile
from pathlib import Path

import httpx

import model0
import model1
import parser0
import restructure
from job_control import JobControl
from job_store import JobStore


logger = logging.getLogger("ml-service.jobs")


class JobRunner:
    """Run queued jobs on a bounded pool of workers, with pause and cancel.

    Several jobs may run at once (AUTODOCS_MAX_CONCURRENT_JOBS, default 2);
    further uploads wait in the queue. Local inference shares the same CPUs and
    GPUs, so the pool is bounded rather than one task per upload.
    """

    def __init__(self, store: JobStore, max_concurrent_jobs: int | None = None) -> None:
        self.store = store
        self.max_concurrent_jobs = max_concurrent_jobs or int(os.getenv("AUTODOCS_MAX_CONCURRENT_JOBS", "2"))
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.worker_tasks: list[asyncio.Task[None]] = []
        self.controls: dict[str, JobControl] = {}
        self.job_tasks: dict[str, asyncio.Task[None]] = {}

    async def start(self) -> None:
        for job_id in await self.store.pending_job_ids():
            await self.queue.put(job_id)
        self.worker_tasks = [
            asyncio.create_task(self._work(), name=f"autodocs-job-worker-{index}")
            for index in range(max(1, self.max_concurrent_jobs))
        ]

    async def stop(self) -> None:
        for task in self.worker_tasks:
            task.cancel()
        await asyncio.gather(*self.worker_tasks, return_exceptions=True)

    async def enqueue(self, job_id: str) -> None:
        await self.queue.put(job_id)

    async def pause(self, job_id: str) -> dict:
        state = await self.store.pause(job_id)
        self._control(job_id).pause()
        return state

    async def resume(self, job_id: str) -> dict:
        state = await self.store.resume(job_id)
        self._control(job_id).resume()
        return state

    async def cancel(self, job_id: str) -> dict:
        state = await self.store.cancel(job_id)
        task = self.job_tasks.get(job_id)
        if task:
            task.cancel()
        return state

    def _control(self, job_id: str) -> JobControl:
        return self.controls.setdefault(job_id, JobControl())

    async def _work(self) -> None:
        while True:
            job_id = await self.queue.get()
            try:
                await self._run_supervised(job_id)
            finally:
                self.queue.task_done()

    async def _run_supervised(self, job_id: str) -> None:
        """Run one job as its own task so cancel() can interrupt it mid-request."""
        if not await self.store.running(job_id):
            return  # Cancelled while it waited in the queue.
        task = asyncio.create_task(self._run(job_id), name=f"autodocs-job-{job_id}")
        self.job_tasks[job_id] = task
        try:
            await task
        except asyncio.CancelledError:
            if not task.cancelled() or asyncio.current_task().cancelling():
                raise  # The worker itself is shutting down, not a job cancel.
        except Exception as error:
            logger.exception("job %s failed", job_id)
            await self.store.failed(job_id, f"{type(error).__name__}: {error}")
        finally:
            self.job_tasks.pop(job_id, None)
            self.controls.pop(job_id, None)

    async def _run(self, job_id: str) -> None:
        control = self._control(job_id)
        if (await self.store.status(job_id))["status"] == "cancelled":
            return  # Cancelled in the instant between starting and being tracked.
        content = await self.store.input_content(job_id)
        await self.store.stage(job_id, "parse", 1, "Reading and validating the asciinema recording.")
        flat_xml = parser0.cast_to_xml(content, strip_annotations=True)
        await self.store.progress(job_id, "parse", 1, 1, "Terminal recording parsed into model input.")
        await self.store.complete_stage(job_id, "parse", "Terminal recording parsed successfully.")

        total_chunks = len(model0.extract_chunks(flat_xml))
        await self.store.stage(job_id, "boundaries", total_chunks, f"Checking 0 of {total_chunks} terminal chunks for event boundaries.")

        async def report_boundaries(current: int, total: int, found: int) -> None:
            await self.store.progress(job_id, "boundaries", current, total, f"Checked {current} of {total} chunks; found {found} event boundaries.")
            await control.checkpoint()

        async with httpx.AsyncClient() as client:
            boundaries = await model0.find_new_event_timestamps(flat_xml, client, report_boundaries)
            await control.checkpoint()
            await self.store.complete_stage(job_id, "boundaries", f"Detected {len(boundaries)} event boundaries across {total_chunks} chunks.")

            await self.store.stage(job_id, "restructure", 1, "Grouping chunks into hierarchical terminal events.")
            event_xml = restructure.restructure_xml_to_events(flat_xml, boundaries)
            await self.store.progress(job_id, "restructure", 1, 1, "Terminal chunks grouped into events.")
            await self.store.complete_stage(job_id, "restructure", "Terminal events are ready for summarization.")

            with tempfile.NamedTemporaryFile(mode="w", suffix=".xml", delete=False) as temporary_file:
                temporary_file.write(event_xml)
                event_xml_path = temporary_file.name

            try:
                events = model1.load_events(event_xml_path)
                await self.store.stage(job_id, "annotate", len(events), f"Generating 0 of {len(events)} event summaries.")

                async def report_annotations(current: int, total: int, produced: int) -> None:
                    await self.store.progress(job_id, "annotate", current, total, f"Generated {produced} of {total} event summaries.")
                    await control.checkpoint()

                predictions = await model1.annotate_events(events, client, report_annotations)
            finally:
                Path(event_xml_path).unlink(missing_ok=True)

        await self.store.complete_stage(job_id, "annotate", f"Generated {len(predictions)} event summaries.")
        await self.store.stage(job_id, "finalize", 1, "Formatting results for the AutoDocs application.")
        result = {
            "content": [
                json.dumps({
                    "idx": index,
                    "depth": value["depth"],
                    "summary": value["summary"],
                    "xml": events[index].xml,
                })
                for index, value in sorted(predictions.items())
            ]
        }
        await self.store.progress(job_id, "finalize", 1, 1, "Analysis results formatted successfully.")
        await self.store.complete_stage(job_id, "finalize", "Analysis results are ready to save.")
        await self.store.completed(job_id, result)
