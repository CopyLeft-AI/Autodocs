"""How many model requests one job may have in flight at once."""

import os

from resources import is_local_inference

DEFAULT_PARALLEL_REQUESTS = 8
MAX_PARALLEL_REQUESTS = 32


def effective_concurrency(requested: int | None = None) -> int:
    """Parallel requests to use for a job.

    Local inference (Ollama or llama.cpp on this machine) always runs one
    request at a time: parallel calls would only compete for the same cores.
    A remote API uses the user's setting, else AUTODOCS_REMOTE_API_CONCURRENCY,
    else 8, clamped to 1..32.
    """
    if is_local_inference():
        return 1
    value = requested or int(os.getenv("AUTODOCS_REMOTE_API_CONCURRENCY", str(DEFAULT_PARALLEL_REQUESTS)))
    return max(1, min(MAX_PARALLEL_REQUESTS, value))
