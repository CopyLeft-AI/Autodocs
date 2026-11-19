"""Pause gate shared between the HTTP layer and a running inference job."""

import asyncio


class JobControl:
    """Lets a job pause cooperatively at safe points between model calls.

    Cancellation does not go through here: the runner cancels the job's asyncio
    task, which also interrupts an in-flight model request.
    """

    def __init__(self) -> None:
        self._running = asyncio.Event()
        self._running.set()

    def pause(self) -> None:
        self._running.clear()

    def resume(self) -> None:
        self._running.set()

    async def checkpoint(self) -> None:
        """Return immediately while running; block until resumed while paused."""
        await self._running.wait()
