"""Pure helpers that derive live figures (elapsed time, ETA) from a job snapshot."""

from datetime import datetime, timezone
from typing import Any

# An ETA from too little data is noise, so wait for both a minimum amount of
# finished work and a minimum amount of running time before showing one.
MINIMUM_PERCENT_FOR_ETA = 5
MINIMUM_ACTIVE_SECONDS_FOR_ETA = 30


def active_seconds(state: dict[str, Any], now: datetime | None = None) -> float:
    """Seconds the job has actually been running: excludes queue time and pauses."""
    started_at = state.get("startedAt")
    if not started_at:
        return 0.0
    now = now or datetime.now(timezone.utc)
    # While paused the clock is frozen at the moment the pause began.
    paused_at = state.get("pausedAt")
    end = datetime.fromisoformat(paused_at) if paused_at else now
    elapsed = (end - datetime.fromisoformat(started_at)).total_seconds()
    return max(0.0, elapsed - state.get("pausedSeconds", 0.0))


def estimate_remaining_seconds(state: dict[str, Any], now: datetime | None = None) -> int | None:
    """Linear extrapolation of the remaining run time, or None while unreliable."""
    if state.get("status") not in ("running", "paused"):
        return None
    percent = state.get("percent", 0)
    elapsed = active_seconds(state, now)
    if percent < MINIMUM_PERCENT_FOR_ETA or elapsed < MINIMUM_ACTIVE_SECONDS_FOR_ETA:
        return None
    return round(elapsed * (100 - percent) / percent)
