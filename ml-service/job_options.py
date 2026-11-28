"""Per-job choices made at upload time: which model and how it summarises.

A job can only change the model name and summary settings of a step. The backend,
server address and API key always come from the service configuration, so a
request can never redirect recordings or keys to another server.
"""

from dataclasses import replace

from pydantic import BaseModel, Field

from config import ServiceConfig, StepConfig


class JobOptions(BaseModel):
    boundaryModel: str | None = Field(default=None, min_length=1, max_length=200)
    annotateModel: str | None = Field(default=None, min_length=1, max_length=200)
    summaryWordLimit: int | None = Field(default=None, ge=5, le=500)
    reasoningEffort: str | None = Field(default=None, pattern="^(low|medium|high)$")


def apply_options(config: ServiceConfig, options: dict | None) -> tuple[StepConfig, StepConfig]:
    """The boundary and annotation steps of one job."""
    chosen = JobOptions.model_validate(options or {})
    boundaries, annotate = config.steps["boundaries"], config.steps["annotate"]
    if chosen.boundaryModel:
        boundaries = replace(boundaries, model=chosen.boundaryModel)
    changes = {
        "model": chosen.annotateModel,
        "summary_word_limit": chosen.summaryWordLimit,
        "reasoning_effort": chosen.reasoningEffort,
    }
    annotate = replace(annotate, **{name: value for name, value in changes.items() if value is not None})
    return boundaries, annotate


def models_used(boundaries: StepConfig, annotate: StepConfig) -> dict:
    """Record of which models produced a result, stored with its annotations."""
    return {
        name: {"backend": step.backend, "model": step.model}
        for name, step in (("boundaries", boundaries), ("annotate", annotate))
    }
