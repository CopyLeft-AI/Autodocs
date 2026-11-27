"""Durable, observable state for serialized local AutoDocs inference jobs."""

import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


STAGES = (
    ("parse", "Parsing terminal recording", 5),
    ("boundaries", "Detecting event boundaries", 45),
    ("annotate", "Generating event summaries", 48),
    ("finalize", "Finalizing session", 2),
)


ACTIVE_STATUSES = ("queued", "running", "paused")
REMOVABLE_STATUSES = ("failed", "cancelled")


class JobStore:
    """Own job snapshots and raw inputs without exposing raw terminal data."""

    def __init__(self, root_path: str) -> None:
        self.root = Path(root_path)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._lock = asyncio.Lock()

    def _state_path(self, job_id: str) -> Path:
        return self.root / f"{job_id}.json"

    def _input_path(self, job_id: str) -> Path:
        return self.root / f"{job_id}.cast"

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _write_json(self, path: Path, value: dict[str, Any]) -> None:
        temporary_path = path.with_suffix(".tmp")
        temporary_path.write_text(json.dumps(value, separators=(",", ":")))
        os.chmod(temporary_path, 0o600)
        temporary_path.replace(path)

    def _load(self, job_id: str) -> dict[str, Any]:
        path = self._state_path(job_id)
        if not path.exists():
            raise KeyError(job_id)
        return json.loads(path.read_text())

    @staticmethod
    def _stages() -> list[dict[str, Any]]:
        return [{"id": identifier, "label": label, "weight": weight, "status": "pending", "current": 0, "total": 0, "estimated": False, "detail": ""} for identifier, label, weight in STAGES]

    async def create(self, job_id: str, title: str, content: str, concurrency: int | None = None, options: dict[str, Any] | None = None) -> dict[str, Any]:
        """Persist source input first, then publish an observable queued job."""
        async with self._lock:
            input_path = self._input_path(job_id)
            temporary_path = input_path.with_suffix(".tmp")
            temporary_path.write_text(content)
            os.chmod(temporary_path, 0o600)
            temporary_path.replace(input_path)
            now = self._now()
            state = {"id": job_id, "title": title, "status": "queued", "percent": 0, "createdAt": now, "updatedAt": now, "stages": self._stages(), "requestedConcurrency": concurrency, "options": options, "parallelRequests": 1, "startedAt": None, "pausedAt": None, "pausedSeconds": 0.0, "timeline": [{"at": now, "kind": "queued", "message": "Upload accepted; waiting for an inference worker."}], "error": None, "result": None}
            self._write_json(self._state_path(job_id), state)
            return state

    async def status(self, job_id: str) -> dict[str, Any]:
        async with self._lock:
            return self._load(job_id)

    async def input_content(self, job_id: str) -> str:
        async with self._lock:
            return self._input_path(job_id).read_text()

    async def running(self, job_id: str) -> bool:
        """Start a queued job; return False when it was cancelled while waiting."""
        async with self._lock:
            state = self._load(job_id)
            if state["status"] != "queued":
                return False
            # Current stage list and zero progress: a job queued before an upgrade may carry
            # stages the runner no longer completes (and a retried job starts over anyway).
            state.update(status="running", startedAt=self._now(), nextRetryAt=None, pausedAt=None, pausedSeconds=0.0, percent=0, stages=self._stages())
            self._append_event(state, "started", "Inference worker started.")
            self._touch(state)
            self._write_json(self._state_path(job_id), state)
            return True

    async def pause(self, job_id: str) -> dict[str, Any]:
        """Pause a running job or a queued network retry."""
        async with self._lock:
            state = self._load(job_id)
            if state["status"] != "running" and not (
                state["status"] == "queued" and state.get("nextRetryAt")
            ):
                raise ValueError(
                    "Only running jobs or scheduled network retries can be paused."
                )
            state.update(status="paused", pausedAt=self._now())
            self._append_event(state, "paused", "Analysis paused; it will stop after the current step finishes.")
            self._touch(state)
            self._write_json(self._state_path(job_id), state)
            return state

    async def resume(self, job_id: str) -> dict[str, Any]:
        """Return a paused job to running and bank the time spent paused."""
        async with self._lock:
            state = self._load(job_id)
            if state["status"] != "paused":
                raise ValueError("Only paused jobs can be resumed.")
            self._bank_paused_time(state)
            state["status"] = "queued" if state.get("nextRetryAt") else "running"
            self._append_event(state, "resumed", "Analysis resumed.")
            self._touch(state)
            self._write_json(self._state_path(job_id), state)
            return state

    async def cancel(self, job_id: str) -> dict[str, Any]:
        """Stop a queued, running or paused job; keeps the record until deleted."""
        async with self._lock:
            state = self._load(job_id)
            if state["status"] not in ACTIVE_STATUSES:
                raise ValueError("Only queued, running or paused jobs can be cancelled.")
            self._bank_paused_time(state)
            state["status"] = "cancelled"
            self._append_event(state, "cancelled", "Analysis cancelled.")
            self._touch(state)
            self._write_json(self._state_path(job_id), state)
            return state

    def _bank_paused_time(self, state: dict[str, Any]) -> None:
        if not state.get("pausedAt"):
            return
        paused_for = (datetime.now(timezone.utc) - datetime.fromisoformat(state["pausedAt"])).total_seconds()
        state["pausedSeconds"] = state.get("pausedSeconds", 0.0) + max(0.0, paused_for)
        state["pausedAt"] = None

    async def stage(self, job_id: str, stage_id: str, total: int, detail: str) -> None:
        async with self._lock:
            state = self._load(job_id)
            stage = next(stage for stage in state["stages"] if stage["id"] == stage_id)
            stage.update({"status": "running", "current": 0, "total": total, "detail": detail})
            self._append_event(state, "stage", detail)
            self._touch(state)
            self._write_json(self._state_path(job_id), state)

    async def set_parallel_requests(self, job_id: str, count: int) -> None:
        """Record how many model requests this job runs at once."""
        await self._mutate(job_id, parallelRequests=count)

    async def progress(self, job_id: str, stage_id: str, current: int, total: int, detail: str, estimated: bool = False) -> None:
        """Record stage progress. `estimated` marks a total that is still a guess.

        Stages can overlap (event summaries start while boundaries are still
        being detected), so the job percent sums every running stage and never
        moves backwards when an estimated total is revised.
        """
        async with self._lock:
            state = self._load(job_id)
            stage = next(stage for stage in state["stages"] if stage["id"] == stage_id)
            previous_current = stage["current"]
            stage.update({"current": current, "total": total, "estimated": estimated, "detail": detail})
            weight = 0.0
            for candidate in state["stages"]:
                if candidate["status"] == "completed":
                    weight += candidate["weight"]
                elif candidate["status"] == "running" and candidate["total"]:
                    weight += candidate["weight"] * min(candidate["current"] / candidate["total"], 1)
            state["percent"] = max(state["percent"], min(99, int(weight)))
            milestone = total and (current == 1 or current == total or (current * 100 // total) // 10 > (previous_current * 100 // total) // 10)
            if milestone:
                self._append_event(state, "progress", detail)
            self._touch(state)
            self._write_json(self._state_path(job_id), state)

    async def complete_stage(self, job_id: str, stage_id: str, detail: str) -> None:
        async with self._lock:
            state = self._load(job_id)
            stage = next(stage for stage in state["stages"] if stage["id"] == stage_id)
            stage["status"] = "completed"
            stage["estimated"] = False
            stage["current"] = stage["total"] or 1
            stage["total"] = stage["total"] or 1
            stage["detail"] = detail
            self._append_event(state, "complete", detail)
            self._touch(state)
            self._write_json(self._state_path(job_id), state)

    async def completed(self, job_id: str, result: dict[str, Any]) -> None:
        await self._mutate(job_id, status="completed", percent=100, result=result, message="Session analysis completed and is ready to save.", kind="completed", unless_cancelled=True)

    async def failed(self, job_id: str, message: str) -> None:
        await self._mutate(job_id, status="failed", error=message, message=message, kind="failed", unless_cancelled=True)

    async def defer_network_retry(
        self, job_id: str, attempt: int, delay_seconds: float
    ) -> bool:
        """Persist a delayed retry without losing the original input."""
        from datetime import timedelta
        import math

        if attempt < 1 or not math.isfinite(delay_seconds) or delay_seconds < 0:
            raise ValueError("Invalid network retry parameters")

        async with self._lock:
            state = self._load(job_id)

            # Cancellation and other state changes take precedence.
            if state["status"] not in ("running", "paused"):
                return False
            was_paused = state["status"] == "paused"

            try:
                deadline = datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)
            except OverflowError:
                # Keep an unrepresentably distant cooldown persisted.
                deadline = datetime.max.replace(tzinfo=timezone.utc)
            next_retry_at = deadline.isoformat()

            state.update(
                status="paused" if was_paused else "queued",
                percent=0,
                stages=self._stages(),
                startedAt=None,
                error=None,
                retryCount=attempt,
                nextRetryAt=next_retry_at,
            )
            self._append_event(
                state,
                "retry",
                f"Temporary network failure; retry {attempt} scheduled.",
            )
            self._touch(state)
            self._write_json(self._state_path(job_id), state)
            return True

    async def delete_inactive(self, job_id: str) -> None:
        """Remove a failed or cancelled job and its uploaded recording."""
        async with self._lock:
            state = self._load(job_id)
            if state["status"] not in REMOVABLE_STATUSES:
                raise ValueError("Only failed or cancelled jobs may be deleted.")
            self._input_path(job_id).unlink(missing_ok=True)
            self._state_path(job_id).unlink()

    async def pending_job_ids(self) -> list[str]:
        async with self._lock:
            queued: list[str] = []
            for path in self.root.glob("*.json"):
                state = json.loads(path.read_text())
                if state["status"] == "queued":
                    queued.append(state["id"])
                elif state["status"] == "running":
                    recoveries = int(state.get("restartRecoveryCount", 0))
                    if recoveries < 3:
                        state.update(
                            status="queued",
                            percent=0,
                            stages=self._stages(),
                            startedAt=None,
                            pausedAt=None,
                            pausedSeconds=0.0,
                            nextRetryAt=None,
                            error=None,
                            result=None,
                            restartRecoveryCount=recoveries + 1,
                        )
                        self._append_event(
                            state,
                            "recovered",
                            "Inference service restarted; analysis queued "
                            "again from its saved input.",
                        )
                        self._touch(state)
                        self._write_json(path, state)
                        queued.append(state["id"])
                    else:
                        state["status"] = "failed"
                        state["error"] = (
                            "Analysis interrupted by repeated service "
                            "restarts; automatic recovery limit reached."
                        )
                        self._append_event(
                            state, "failed", state["error"]
                        )
                        self._touch(state)
                        self._write_json(path, state)
                elif state["status"] == "paused" and state.get("nextRetryAt"):
                    continue
                elif state["status"] == "paused":
                    state["status"] = "failed"
                    state["error"] = "The inference service restarted before this job finished. Upload again to retry."
                    self._append_event(state, "failed", state["error"])
                    self._touch(state)
                    self._write_json(path, state)
            return queued

    async def _mutate(self, job_id: str, **changes: Any) -> None:
        async with self._lock:
            state = self._load(job_id)
            message = changes.pop("message", None)
            kind = changes.pop("kind", "update")
            if changes.pop("unless_cancelled", False) and state["status"] == "cancelled":
                return
            state.update(changes)
            if message:
                self._append_event(state, kind, message)
            self._touch(state)
            self._write_json(self._state_path(job_id), state)

    def _append_event(self, state: dict[str, Any], kind: str, message: str) -> None:
        state["timeline"].append({"at": self._now(), "kind": kind, "message": message})
        state["timeline"] = state["timeline"][-120:]

    def _touch(self, state: dict[str, Any]) -> None:
        state["updatedAt"] = self._now()
