"""Live usage of the local processing resources (CPU cores, GPUs) behind a job.

Inference runs in a separate process (Ollama or llama.cpp), so only the
machine-wide figures describe the load a job causes. Nothing is reported when
inference goes to a remote API, because local usage would say nothing about it.
"""

import asyncio
import os
import shutil
import subprocess
import time
from typing import Any
from urllib.parse import urlparse

import psutil

CACHE_SECONDS = 2.0
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def is_local_inference() -> bool:
    """True when the configured LLM backend runs on this machine."""
    backend = os.getenv("LLM_BACKEND", "ollama").lower()
    if backend == "cloudtemple":
        return False
    url = os.getenv("LLAMACPP_BASE_URL") if backend == "llamacpp" else os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
    host = urlparse(url or "").hostname
    return host in LOOPBACK_HOSTS


def _read_gpu_utilization() -> list[float]:
    """Per-GPU utilisation percentages from nvidia-smi; empty when unavailable."""
    if shutil.which("nvidia-smi") is None:
        return []
    try:
        output = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3, check=True,
        ).stdout
        return [float(line) for line in output.split() if line.strip()]
    except (OSError, subprocess.SubprocessError, ValueError):
        return []


class ResourceSampler:
    """Samples machine-wide CPU and GPU load, cached so frequent polls stay cheap."""

    def __init__(self) -> None:
        self._cached: dict[str, Any] | None = None
        self._cached_at = 0.0
        self._lock = asyncio.Lock()
        psutil.cpu_percent(interval=None)  # The first call only primes the counter.

    async def sample(self) -> dict[str, Any] | None:
        """Return current usage, or None when inference is not local."""
        if not is_local_inference():
            return None
        async with self._lock:
            if self._cached is None or time.monotonic() - self._cached_at > CACHE_SECONDS:
                self._cached = await asyncio.to_thread(self._measure)
                self._cached_at = time.monotonic()
            return self._cached

    @staticmethod
    def _measure() -> dict[str, Any]:
        cores = psutil.cpu_count(logical=True) or 1
        cpu_percent = psutil.cpu_percent(interval=None)
        gpus = _read_gpu_utilization()
        return {
            "cpu": {"percent": round(cpu_percent, 1), "cores": cores, "busyCores": round(cpu_percent * cores / 100, 1)},
            "gpu": {"percent": round(sum(gpus) / len(gpus), 1), "count": len(gpus)} if gpus else None,
        }
