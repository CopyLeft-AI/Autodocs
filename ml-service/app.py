"""ml-service: local-CPU replacement for the Colab+ngrok Flask endpoint.

Implements the same contract the notebook's Flask sketch intended
(POST / -> {title, content}) but with real, verified glue between the four
pipeline stages, and calling local Ollama-served models instead of Colab.

Response contract (verified against autodocs-app/app/api/terminal-sessions/route.ts):
  {"title": <str>, "content": [<JSON string of {"idx","depth","summary"}>, ...]}
content must be an array of JSON-encoded STRINGS, not objects -- the Next.js
route does JSON.parse() on each element itself.
"""
import json
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import config as service_config
import model0
import model1
import parser0
import restructure
from concurrency import MAX_PARALLEL_REQUESTS
from job_metrics import estimate_remaining_seconds
from job_runner import JobRunner
from job_store import JobStore
from resources import ResourceSampler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ml-service")

job_store = JobStore(os.getenv("AUTODOCS_JOB_DIRECTORY", str(Path(__file__).with_name("jobs"))))
job_runner = JobRunner(job_store)
resource_sampler = ResourceSampler()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await job_runner.start()
    try:
        yield
    finally:
        await job_runner.stop()


API_DESCRIPTION = """
Analysis service of AutoDocs: turns asciinema recordings into event summaries with
local or remote language models.

It has no login of its own. In a deployment it sits behind the web app, which shows
this page at `/ml-service/docs` to administrators only.
"""

OPENAPI_TAGS = [
    {"name": "Configuration", "description": "Which model and inference source each analysis step uses."},
    {"name": "Analysis jobs", "description": "Queued background analyses that can be paused, resumed and cancelled."},
    {"name": "Legacy", "description": "Synchronous analysis kept for older clients."},
    {"name": "Health", "description": "Liveness check."},
]

app = FastAPI(title="autodocs-ml-service", version="1.0.0", description=API_DESCRIPTION, openapi_tags=OPENAPI_TAGS, lifespan=lifespan)


class RecordingRequest(BaseModel):
    title: str
    content: str


class RecordingResponse(BaseModel):
    title: str
    content: list[str]


class JobRequest(RecordingRequest):
    jobId: str
    # Parallel model requests for a remote API; ignored for local inference.
    parallelRequests: int | None = Field(default=None, ge=1, le=MAX_PARALLEL_REQUESTS)


async def with_live_fields(state: dict) -> dict:
    """Add figures that are derived at read time and never persisted."""
    live = state["status"] in ("running", "paused")
    return {
        **state,
        "etaSeconds": estimate_remaining_seconds(state),
        "resources": await resource_sampler.sample() if live else None,
    }


@app.get("/config", tags=["Configuration"], summary="Read the settings")
async def get_config():
    """Current settings (stored and effective values; API keys are never returned)."""
    try:
        return service_config.public_view(service_config.read_file_config())
    except service_config.ConfigError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.put("/config", tags=["Configuration"], summary="Change the settings")
async def update_config(body: dict):
    """Merge the given settings into the config file. Applies to jobs started afterwards."""
    try:
        return service_config.public_view(service_config.update_file_config(body))
    except service_config.ConfigError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"Could not write the config file: {error}") from error


@app.get("/health", tags=["Health"], summary="Liveness check")
async def health():
    return {"status": "ok"}


@app.post("/jobs", tags=["Analysis jobs"], summary="Queue a recording for analysis")
async def create_job(body: JobRequest):
    try:
        state = await job_store.create(body.jobId, body.title, body.content, body.parallelRequests)
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"Could not persist upload job: {error}") from error
    await job_runner.enqueue(body.jobId)
    return await with_live_fields(state)


@app.get("/jobs/{job_id}", tags=["Analysis jobs"], summary="Progress and result of a job")
async def get_job(job_id: str):
    try:
        return await with_live_fields(await job_store.status(job_id))
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Upload job not found.") from error


async def control_job(job_id: UUID, action):
    """Apply a pause/resume/cancel action, mapping store errors to HTTP codes."""
    try:
        return await with_live_fields(await action(str(job_id)))
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Upload job not found.") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/jobs/{job_id}/pause", tags=["Analysis jobs"], summary="Pause a running job")
async def pause_job(job_id: UUID):
    return await control_job(job_id, job_runner.pause)


@app.post("/jobs/{job_id}/resume", tags=["Analysis jobs"], summary="Resume a paused job")
async def resume_job(job_id: UUID):
    return await control_job(job_id, job_runner.resume)


@app.post("/jobs/{job_id}/cancel", tags=["Analysis jobs"], summary="Cancel a job")
async def cancel_job(job_id: UUID):
    return await control_job(job_id, job_runner.cancel)


@app.delete("/jobs/{job_id}", tags=["Analysis jobs"], summary="Delete a finished job", responses={409: {"description": "The job is still active."}})
async def delete_inactive_job(job_id: UUID):
    try:
        await job_store.delete_inactive(str(job_id))
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Upload job not found.") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"deleted": True}


@app.post("/", response_model=RecordingResponse, tags=["Legacy"], summary="Analyse a recording and wait for the result")
async def process_recording(body: RecordingRequest):
    title = body.title
    logger.info("processing %s (%d bytes)", title, len(body.content))

    try:
        flat_xml = parser0.cast_to_xml(body.content, strip_annotations=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"parser0 failed: {e}") from e

    async with httpx.AsyncClient() as client:
        new_event_timestamps = await model0.find_new_event_timestamps(flat_xml, client)
        logger.info("model0: %d new-event boundaries", len(new_event_timestamps))

        event_xml = restructure.restructure_xml_to_events(flat_xml, new_event_timestamps)

        with tempfile.NamedTemporaryFile(mode="w", suffix=".xml", delete=False) as f:
            f.write(event_xml)
            event_xml_path = f.name

        try:
            events = model1.load_events(event_xml_path)
            preds = await model1.annotate_events(events, client)
        finally:
            Path(event_xml_path).unlink(missing_ok=True)

    logger.info("model1: annotated %d/%d events", len(preds), len(events))

    content = [
        json.dumps({"idx": idx, "depth": v["depth"], "summary": v["summary"]})
        for idx, v in sorted(preds.items())
    ]

    return RecordingResponse(title=title, content=content)
