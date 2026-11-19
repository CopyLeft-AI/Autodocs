"""One serialized worker that turns persisted AutoDocs jobs into model results."""

import asyncio
import json
import logging
import os

import httpx

import model0
import model1
import parser0
from concurrency import effective_concurrency
from event_stream import EventSplitter
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
        state = await self.store.status(job_id)
        if state["status"] == "cancelled":
            return  # Cancelled in the instant between starting and being tracked.
        content = await self.store.input_content(job_id)
        await self.store.stage(job_id, "parse", 1, "Reading and validating the asciinema recording.")
        flat_xml = parser0.cast_to_xml(content, strip_annotations=True)
        await self.store.progress(job_id, "parse", 1, 1, "Terminal recording parsed into model input.")
        await self.store.complete_stage(job_id, "parse", "Terminal recording parsed successfully.")

        chunks = model0.extract_chunks(flat_xml)
        total_chunks = len(chunks)
        parallel = effective_concurrency(state.get("requestedConcurrency"))
        await self.store.set_parallel_requests(job_id, parallel)
        mode = f" ({parallel} requests in parallel)" if parallel > 1 else ""
        await self.store.stage(job_id, "boundaries", total_chunks, f"Checking 0 of {total_chunks} terminal chunks for event boundaries{mode}.")
        await self.store.stage(job_id, "annotate", 0, "Waiting for the first event to be delimited.")

        # Boundaries are found in chunk order. As soon as one closes an event,
        # that event goes to the annotator while later chunks are still checked.
        events: list[model1.Event] = []
        predictions: dict[int, dict] = {}
        ready: asyncio.Queue[model1.Event | None] = asyncio.Queue()
        progress = {"chunks_done": 0, "boundaries": 0}

        def expected_events() -> tuple[int, bool]:
            """Best known number of events, and whether it is final."""
            if progress["chunks_done"] >= total_chunks:
                return len(events), True
            if not events:
                return 0, False
            # Extrapolate the event rate seen so far over the chunks left.
            return max(len(events) + 1, round(len(events) * total_chunks / max(progress["chunks_done"], 1))), False

        async def report_annotations() -> None:
            total, final = expected_events()
            label = f"{total}" if final else f"about {total}"
            await self.store.progress(
                job_id, "annotate", len(predictions), total,
                f"Generated {len(predictions)} of {label} event summaries.", estimated=not final,
            )

        async def find_boundaries(client: httpx.AsyncClient) -> None:
            splitter = EventSplitter(flat_xml)

            def hand_over(event_xml: str | None) -> None:
                if event_xml is not None:
                    event = model1.Event(idx=len(events), xml=event_xml)
                    events.append(event)
                    ready.put_nowait(event)

            try:
                async for _, chunk, is_new in model0.stream_boundary_decisions(chunks, client, parallel, control.checkpoint):
                    progress["chunks_done"] += 1
                    progress["boundaries"] += int(is_new)
                    hand_over(splitter.advance(chunk.ts, is_new))
                    await self.store.progress(
                        job_id, "boundaries", progress["chunks_done"], total_chunks,
                        f"Checked {progress['chunks_done']} of {total_chunks} chunks; found {progress['boundaries']} event boundaries{mode}.",
                    )
                    await report_annotations()
                    await control.checkpoint()
                hand_over(splitter.finish())
            finally:
                ready.put_nowait(None)  # Always release the annotator.
            await self.store.complete_stage(job_id, "boundaries", f"Detected {progress['boundaries']} event boundaries across {total_chunks} chunks.")

        async def annotate_events_as_ready(client: httpx.AsyncClient) -> None:
            while (event := await ready.get()) is not None:
                result = await model1.annotate_one(events, event.idx, client)
                if result is not None:
                    predictions[event.idx] = result
                await report_annotations()
                await control.checkpoint()

        async with httpx.AsyncClient() as client:
            await run_together(find_boundaries(client), annotate_events_as_ready(client))

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


async def run_together(*coroutines) -> None:
    """Run coroutines side by side; the first failure cancels the others and is raised."""
    tasks = [asyncio.create_task(coroutine) for coroutine in coroutines]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
        for task in done:
            task.result()  # Re-raises the first failure.
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
