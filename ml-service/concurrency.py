"""How many model requests one job may have in flight at once."""

from config import ServiceConfig, StepConfig, load_config
from resources import is_local_step

DEFAULT_PARALLEL_REQUESTS = 8
MAX_PARALLEL_REQUESTS = 32


def effective_concurrency(
    requested: int | None = None,
    step: StepConfig | None = None,
    config: ServiceConfig | None = None,
) -> int:
    """Parallel requests to use for a step of a job.

    A step whose model runs on this machine (Ollama or llama.cpp locally)
    always uses one request at a time: parallel calls would only compete for
    the same cores. A remote API uses the user's setting, else the configured
    `remoteApiConcurrency` (default 8), clamped to 1..32.
    """
    config = config or load_config()
    step = step or config.steps["boundaries"]
    if is_local_step(step, config.inference_location):
        return 1
    return max(1, min(MAX_PARALLEL_REQUESTS, requested or config.remote_api_concurrency))
