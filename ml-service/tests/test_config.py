"""Configuration file: resolution order, validation, secrets, atomic updates, API."""

import json
import os
import stat

import httpx
import pytest
from fastapi.testclient import TestClient

import config
import model0
import model1


def test_defaults_without_file_or_env():
    cfg = config.load_config()
    boundaries, annotate = cfg.steps["boundaries"], cfg.steps["annotate"]
    assert (boundaries.backend, boundaries.model, boundaries.base_url) == ("ollama", "model0", "http://127.0.0.1:11434")
    assert (annotate.model, annotate.max_tokens, annotate.reasoning_effort, annotate.summary_word_limit) == ("gpt-oss:20b", 2000, "low", 50)
    assert cfg.remote_api_concurrency == 8 and cfg.max_concurrent_jobs == 2


def test_legacy_environment_still_applies(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "llamacpp")
    monkeypatch.setenv("LLAMACPP_BASE_URL", "http://gpu:8080/")
    monkeypatch.setenv("MODEL1_NAME", "big")
    monkeypatch.setenv("AUTODOCS_REMOTE_API_CONCURRENCY", "5")
    cfg = config.load_config()
    assert cfg.steps["annotate"].backend == "llamacpp"
    assert cfg.steps["annotate"].base_url == "http://gpu:8080"
    assert cfg.steps["annotate"].model == "big"
    assert cfg.remote_api_concurrency == 5


def test_file_beats_environment_and_steps_are_independent(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "llamacpp")
    monkeypatch.setenv("MODEL0_NAME", "from-env")
    config.update_file_config({"steps": {"boundaries": {"backend": "openai", "model": "gpt-x", "apiKey": "k"}}})
    cfg = config.load_config()
    assert (cfg.steps["boundaries"].backend, cfg.steps["boundaries"].model) == ("openai", "gpt-x")
    assert cfg.steps["boundaries"].base_url == "https://api.openai.com/v1"
    assert cfg.steps["annotate"].backend == "llamacpp"  # Untouched step keeps the env value.


def test_null_resets_to_default_and_api_key_rules():
    config.update_file_config({"steps": {"annotate": {"model": "m", "apiKey": "secret", "backend": "openai"}}})
    config.update_file_config({"steps": {"annotate": {"model": None}}})  # reset; apiKey omitted -> kept
    stored = config.read_file_config()["steps"]["annotate"]
    assert "model" not in stored and stored["apiKey"] == "secret"
    config.update_file_config({"steps": {"annotate": {"apiKey": ""}}})
    assert "apiKey" not in config.read_file_config()["steps"]["annotate"]


@pytest.mark.parametrize("changes, message", [
    ({"steps": {"annotate": {"backend": "magic"}}}, "must be one of"),
    ({"steps": {"annotate": {"maxTokens": 0}}}, "between"),
    ({"steps": {"annotate": {"maxTokens": 1.5}}}, "whole number"),
    ({"steps": {"annotate": {"maxTokens": True}}}, "must be a number"),
    ({"steps": {"annotate": {"baseUrl": "ftp://x"}}}, "http"),
    ({"steps": {"annotate": {"nope": 1}}}, "not a known setting"),
    ({"steps": {"summarise": {}}}, "Unknown step"),
    ({"processing": {"remoteApiConcurrency": 99}}, "between"),
    ({"processing": {"inferenceLocation": "mars"}}, "must be one of"),
    ({"steps": {"annotate": "text"}}, "must be an object"),
])
def test_invalid_updates_are_rejected_and_nothing_is_written(changes, message):
    with pytest.raises(config.ConfigError, match=message):
        config.update_file_config(changes)
    assert not config.config_path().exists()


def test_file_is_written_atomically_with_private_permissions():
    config.update_file_config({"steps": {"annotate": {"apiKey": "secret"}}})
    path = config.config_path()
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert json.loads(path.read_text())["version"] == 1
    assert [p.name for p in path.parent.iterdir() if p.name.startswith(".config-")] == []


def test_corrupt_file_is_reported_not_ignored():
    config.config_path().write_text("{not json")
    with pytest.raises(config.ConfigError, match="Cannot read"):
        config.load_config()
    config.config_path().write_text(json.dumps({"steps": {"annotate": {"backend": "magic"}}}))
    with pytest.raises(config.ConfigError):
        config.load_config()


def test_public_view_never_contains_the_secret():
    config.update_file_config({"steps": {"boundaries": {"backend": "openai", "apiKey": "super-secret-key"}}})
    view = config.public_view(config.read_file_config())
    assert "super-secret-key" not in json.dumps(view)
    assert view["steps"]["boundaries"]["apiKeySet"] is True
    assert view["steps"]["annotate"]["apiKeySet"] is False


def test_api_key_falls_back_to_environment(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "env-key")
    config.update_file_config({"steps": {"annotate": {"backend": "openai"}}})
    assert config.load_config().steps["annotate"].api_key == "env-key"


def test_openai_environment_key_is_never_sent_to_another_host(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "env-key")
    config.update_file_config({"steps": {"annotate": {"backend": "openai", "baseUrl": "http://my-vllm:8000/v1"}}})
    assert config.load_config().steps["annotate"].api_key == ""
    config.update_file_config({"steps": {"annotate": {"apiKey": "own-key"}}})
    assert config.load_config().steps["annotate"].api_key == "own-key"


def test_openai_backend_without_any_key_fails_clearly():
    import asyncio
    step = config.StepConfig(step="annotate", backend="openai", model="m", base_url="http://x/v1")
    with pytest.raises(ValueError, match="No API key"):
        asyncio.run(model1.generate(None, "p", step))


# --- the HTTP API ------------------------------------------------------------

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTODOCS_JOB_DIRECTORY", str(tmp_path / "jobs"))
    import app as service
    with TestClient(service.app) as test_client:
        yield test_client


def test_api_roundtrip(client):
    first = client.get("/config").json()
    assert first["steps"]["annotate"]["effective"]["model"] == "gpt-oss:20b"
    assert "annotate" in first["steps"] and first["schema"]["backends"] == list(config.BACKENDS)
    updated = client.put("/config", json={"steps": {"annotate": {"model": "other", "apiKey": "abc"}}})
    assert updated.status_code == 200
    body = updated.json()
    assert body["steps"]["annotate"]["effective"]["model"] == "other"
    assert body["steps"]["annotate"]["apiKeyInFile"] is True and "abc" not in updated.text
    assert client.get("/config").json()["steps"]["annotate"]["stored"]["model"] == "other"


def test_api_rejects_bad_input_with_422_and_keeps_old_file(client):
    client.put("/config", json={"steps": {"annotate": {"model": "keep"}}})
    bad = client.put("/config", json={"steps": {"annotate": {"maxTokens": -4}}})
    assert bad.status_code == 422 and "between" in bad.json()["detail"]
    assert config.read_file_config()["steps"]["annotate"]["model"] == "keep"
    assert client.put("/config", content="[1]", headers={"content-type": "application/json"}).status_code == 422


# --- the models really use the configured step -------------------------------

class Recorder:
    """Fake httpx client capturing the request an inference call sends."""

    def __init__(self, payload):
        self.payload, self.url, self.json, self.timeout = payload, None, None, None

    async def post(self, url, json=None, timeout=None, headers=None, **_):
        self.url, self.json, self.timeout, self.headers = url, json, timeout, headers
        return httpx.Response(200, json=self.payload, request=httpx.Request("POST", url))


def make_step(**changes):
    base = dict(step="boundaries", backend="ollama", model="m", base_url="http://h:1", api_key="",
                timeout_seconds=12.0, max_tokens=7, num_thread=3, max_attempts=3,
                reasoning_effort="high", summary_word_limit=9)
    base.update(changes)
    return config.StepConfig(**base)


def test_ollama_boundary_call_uses_step_settings():
    import asyncio
    client = Recorder({"response": " New "})
    answer = asyncio.run(model0.classify_chunk(client, "p", make_step()))
    assert answer == "new"
    assert client.url == "http://h:1/api/generate"
    assert client.json["model"] == "m" and client.json["options"]["num_predict"] == 7
    assert client.json["options"]["num_thread"] == 3 and client.timeout == 12.0


def test_llamacpp_boundary_call_uses_step_settings():
    import asyncio
    client = Recorder({"choices": [{"text": "old"}]})
    asyncio.run(model0.classify_chunk(client, "p", make_step(backend="llamacpp", base_url="http://l:2")))
    assert client.url == "http://l:2/completions" and client.json["max_tokens"] == 7


def test_openai_backend_sends_chat_request_with_step_key_and_url():
    import asyncio
    client = Recorder({"choices": [{"finish_reason": "stop", "message": {"content": "NEW"}}]})
    prompt = "<|im_start|>user<|im_sep|>hello<|im_end|><|im_start|>assistant<|im_sep|>"
    step = make_step(backend="openai", base_url="http://local-vllm:9/v1", api_key="sk-1", max_tokens=5)
    assert asyncio.run(model0.classify_chunk(client, prompt, step)) == "new"
    assert client.url == "http://local-vllm:9/v1/chat/completions"
    assert client.headers["Authorization"] == "Bearer sk-1"
    assert client.json["messages"] == [{"role": "user", "content": "hello"}] and client.json["max_tokens"] == 5


def test_annotation_uses_its_own_step_and_word_limit():
    import asyncio
    client = Recorder({"message": {"content": '{"annotation": "x", "depth": 0}'}})
    step = make_step(step="annotate", model="summ", max_tokens=11, reasoning_effort="high", summary_word_limit=9)
    asyncio.run(model1.generate(client, "do it", step))
    assert client.url == "http://h:1/api/chat" and client.json["model"] == "summ"
    assert client.json["think"] == "high" and client.json["options"]["num_predict"] == 11
    assert "≤9 words" in model1.build_instruction({"target_idxs": [0], "target_events": ["<e/>"], "neighbor_info": [], "currDepth": 0}, 9)


def test_unsupported_backend_and_missing_llamacpp_url_fail_clearly():
    import asyncio
    with pytest.raises(ValueError, match="base URL"):
        asyncio.run(model0.classify_chunk(None, "p", make_step(backend="llamacpp", base_url="")))
    with pytest.raises(ValueError, match="Unsupported"):
        asyncio.run(model1.generate(None, "p", make_step(backend="nope")))
