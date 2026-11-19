"""Isolate every test from the developer's real config file and environment."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

LEGACY_ENV = (
    "LLM_BACKEND", "OLLAMA_URL", "LLAMACPP_BASE_URL", "MODEL0_NAME", "MODEL1_NAME", "MODEL1_REASONING_EFFORT",
    "MAX_NEW_TOKENS", "SUMMARY_WORD_LIMIT", "OLLAMA_NUM_THREAD", "CLOUDTEMPLE_API_KEY", "CLOUDTEMPLE_BASE_URL",
    "CLOUDTEMPLE_MAX_ATTEMPTS", "CLOUDTEMPLE_MODEL0_TIMEOUT_SECONDS", "CLOUDTEMPLE_MODEL1_TIMEOUT_SECONDS",
    "LLAMACPP_MODEL0_TIMEOUT_SECONDS", "OPENAI_API_KEY", "AUTODOCS_REMOTE_API_CONCURRENCY",
    "AUTODOCS_MAX_CONCURRENT_JOBS", "AUTODOCS_INFERENCE_LOCATION",
)


@pytest.fixture(autouse=True)
def isolated_config(tmp_path, monkeypatch):
    for name in LEGACY_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AUTODOCS_CONFIG_FILE", str(tmp_path / "config.json"))
