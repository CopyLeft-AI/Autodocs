"""How many model requests one job may have in flight at once."""

import asyncio
import contextlib
import heapq
import itertools

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


class RequestLimiter:
    """Allows at most `limit` model requests at once, serving urgent callers first.

    A job shares one limiter between its two stages when inference is local
    (one request at a time across both models). Lower `priority` numbers go
    first, equal priorities in arrival order. Summaries use a better priority
    than boundary checks: otherwise every boundary request already waiting
    would be served before the first summary, and nothing would stream.
    """

    SUMMARY_PRIORITY = 0
    BOUNDARY_PRIORITY = 1

    def __init__(self, limit: int = 1) -> None:
        self._free = max(1, limit)
        self._waiting: list[tuple[int, int, asyncio.Future]] = []
        self._arrivals = itertools.count()

    @contextlib.asynccontextmanager
    async def slot(self, priority: int = BOUNDARY_PRIORITY):
        """Hold one request slot for the body of the `async with`."""
        await self._acquire(priority)
        try:
            yield
        finally:
            self._release()

    async def _acquire(self, priority: int) -> None:
        if self._free > 0 and not self._waiting:
            self._free -= 1
            return
        turn = asyncio.get_running_loop().create_future()
        heapq.heappush(self._waiting, (priority, next(self._arrivals), turn))
        try:
            await turn
        except asyncio.CancelledError:
            if turn.done() and not turn.cancelled():
                self._release()  # The slot was handed to us just as we were cancelled.
            raise

    def _release(self) -> None:
        while self._waiting:
            _, _, turn = heapq.heappop(self._waiting)
            if not turn.done():  # Skip waiters that were cancelled.
                turn.set_result(None)
                return  # The slot passes straight to the next caller.
        self._free += 1
