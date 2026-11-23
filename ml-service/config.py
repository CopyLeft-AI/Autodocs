"""Service configuration: which model and inference source each step uses.

One JSON file (AUTODOCS_CONFIG_FILE, default ml-service/config.json) holds the
settings. The web app edits it through GET/PUT /config; edit by hand if you
prefer. Resolution order for every value: config file, then the legacy
environment variable, then the built-in default, so existing env-only
deployments keep working unchanged. Secrets (API keys) are written to the file
with owner-only permissions and are never returned by the API.

A running job works from a snapshot taken when it starts; edits apply to jobs
started afterwards (except `maxConcurrentJobs`, read when the service starts).
"""

import json
import os
import tempfile
import threading
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

BACKENDS = ("ollama", "llamacpp", "openai", "cloudtemple")
# Chat-style backends talk to a general model through /chat/completions.
CHAT_BACKENDS = ("openai", "cloudtemple")
STEP_IDS = ("boundaries", "annotate")
REASONING_EFFORTS = ("low", "medium", "high")
LOCATIONS = ("auto", "local", "remote")

DEFAULT_URLS = {
    "ollama": "http://127.0.0.1:11434",
    "llamacpp": "",
    "openai": "https://api.openai.com/v1",
    "cloudtemple": "https://api.ai.cloud-temple.com/v1",
}
API_KEY_ENV = {"openai": "OPENAI_API_KEY", "cloudtemple": "CLOUDTEMPLE_API_KEY"}


class ConfigError(ValueError):
    """The configuration file or an update to it is invalid."""


@dataclass(frozen=True)
class StepConfig:
    """Everything one analysis step needs to call its model."""

    step: str
    backend: str
    model: str
    base_url: str
    api_key: str = field(default="", repr=False)
    timeout_seconds: float = 300.0
    max_tokens: int = 32
    num_thread: int = 1
    max_attempts: int = 3
    reasoning_effort: str = "low"
    summary_word_limit: int = 50

    @property
    def is_chat(self) -> bool:
        return self.backend in CHAT_BACKENDS


@dataclass(frozen=True)
class ServiceConfig:
    """Resolved settings; `steps` maps a step id to its StepConfig."""

    steps: dict[str, StepConfig]
    remote_api_concurrency: int
    max_concurrent_jobs: int
    inference_location: str


# Field metadata shared by validation, the API schema and the UI.
# name in file -> (kind, minimum, maximum)
STEP_FIELDS: dict[str, tuple[str, float | None, float | None]] = {
    "backend": ("choice", None, None),
    "model": ("text", None, None),
    "baseUrl": ("text", None, None),
    "apiKey": ("secret", None, None),
    "timeoutSeconds": ("number", 1, 86400),
    "maxTokens": ("integer", 1, 100000),
    "numThread": ("integer", 1, 1024),
    "maxAttempts": ("integer", 1, 6),
    "reasoningEffort": ("choice", None, None),
    "summaryWordLimit": ("integer", 1, 500),
}
PROCESSING_FIELDS: dict[str, tuple[str, float | None, float | None]] = {
    "remoteApiConcurrency": ("integer", 1, 32),
    "maxConcurrentJobs": ("integer", 1, 16),
    "inferenceLocation": ("choice", None, None),
}
CHOICES = {"backend": BACKENDS, "reasoningEffort": REASONING_EFFORTS, "inferenceLocation": LOCATIONS}

_lock = threading.Lock()


def config_path() -> Path:
    return Path(os.getenv("AUTODOCS_CONFIG_FILE", str(Path(__file__).with_name("config.json"))))


def empty_file_config() -> dict[str, Any]:
    return {"processing": {}, "steps": {step: {} for step in STEP_IDS}}


def read_file_config() -> dict[str, Any]:
    """The stored (sparse) configuration; empty sections when there is no file."""
    path = config_path()
    stored = empty_file_config()
    if not path.exists():
        return stored
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ConfigError(f"Cannot read {path}: {error}") from error
    if not isinstance(data, dict):
        raise ConfigError(f"{path} must contain a JSON object.")
    stored["processing"].update(data.get("processing") or {})
    for step in STEP_IDS:
        stored["steps"][step].update((data.get("steps") or {}).get(step) or {})
    validate(stored)
    return stored


def validate(stored: dict[str, Any]) -> None:
    """Raise ConfigError naming the first invalid value; None/absent means 'use default'."""
    unknown = set(stored.get("steps", {})) - set(STEP_IDS)
    if unknown:
        raise ConfigError(f"Unknown step: {sorted(unknown)[0]}")
    for step, values in stored.get("steps", {}).items():
        _validate_section(f"steps.{step}", values, STEP_FIELDS)
    _validate_section("processing", stored.get("processing", {}), PROCESSING_FIELDS)


def _validate_section(path: str, values: Any, spec: dict) -> None:
    if not isinstance(values, dict):
        raise ConfigError(f"{path} must be an object.")
    for name, value in values.items():
        if name not in spec:
            raise ConfigError(f"{path}.{name} is not a known setting.")
        if value is None:
            continue
        kind, low, high = spec[name]
        label = f"{path}.{name}"
        if kind in ("text", "secret", "choice"):
            if not isinstance(value, str):
                raise ConfigError(f"{label} must be text.")
            if kind == "choice" and value not in CHOICES[name]:
                raise ConfigError(f"{label} must be one of: {', '.join(CHOICES[name])}.")
            if name == "baseUrl" and value and not value.startswith(("http://", "https://")):
                raise ConfigError(f"{label} must start with http:// or https://.")
        else:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ConfigError(f"{label} must be a number.")
            if kind == "integer" and int(value) != value:
                raise ConfigError(f"{label} must be a whole number.")
            if not (low <= value <= high):
                raise ConfigError(f"{label} must be between {low:g} and {high:g}.")


def _env_int(name: str, fallback: int) -> int:
    try:
        return int(os.getenv(name, ""))
    except ValueError:
        return fallback


def _step_defaults(step: str, backend: str) -> dict[str, Any]:
    """Built-in defaults (with the legacy environment variables applied)."""
    boundaries = step == "boundaries"
    timeout = {
        "boundaries": {"ollama": 300, "llamacpp": 3600, "openai": 300, "cloudtemple": 300},
        "annotate": {"ollama": 600, "llamacpp": 1800, "openai": 600, "cloudtemple": 600},
    }[step][backend]
    legacy_timeout = {
        "cloudtemple": "CLOUDTEMPLE_MODEL0_TIMEOUT_SECONDS" if boundaries else "CLOUDTEMPLE_MODEL1_TIMEOUT_SECONDS",
        "llamacpp": "LLAMACPP_MODEL0_TIMEOUT_SECONDS" if boundaries else None,
    }.get(backend)
    if legacy_timeout and os.getenv(legacy_timeout):
        timeout = float(os.environ[legacy_timeout])
    url = {
        "ollama": os.getenv("OLLAMA_URL"),
        "llamacpp": os.getenv("LLAMACPP_BASE_URL"),
        "cloudtemple": os.getenv("CLOUDTEMPLE_BASE_URL"),
    }.get(backend) or DEFAULT_URLS[backend]
    if boundaries:
        max_tokens = 256 if backend in CHAT_BACKENDS else 32
        model = os.getenv("MODEL0_NAME", "model0")
    else:
        max_tokens = _env_int("MAX_NEW_TOKENS", 2000)
        model = os.getenv("MODEL1_NAME", "gpt-oss:20b")
    return {
        "model": model,
        "baseUrl": url.rstrip("/"),
        "apiKey": os.getenv(API_KEY_ENV.get(backend, ""), "").strip(),
        "timeoutSeconds": timeout,
        "maxTokens": max_tokens,
        "numThread": _env_int("OLLAMA_NUM_THREAD", os.cpu_count() or 1),
        "maxAttempts": _env_int("CLOUDTEMPLE_MAX_ATTEMPTS", 3),
        "reasoningEffort": os.getenv("MODEL1_REASONING_EFFORT", "low"),
        "summaryWordLimit": _env_int("SUMMARY_WORD_LIMIT", 50),
    }


def _may_use_environment_key(backend: str, base_url: str) -> bool:
    """Whether the key from the environment may be sent to this URL.

    OPENAI_API_KEY is a real OpenAI key, so it is only used for OpenAI's own
    host; pointing the step at any other server needs a key set on the step.
    """
    if backend == "openai":
        return urlparse(base_url).hostname == "api.openai.com"
    return backend in API_KEY_ENV


def _resolve_step(step: str, stored: dict[str, Any]) -> StepConfig:
    backend = stored.get("backend") or os.getenv("LLM_BACKEND", "ollama").lower()
    if backend not in BACKENDS:
        raise ConfigError(f"Unsupported backend: {backend}")
    defaults = _step_defaults(step, backend)

    def pick(name: str) -> Any:
        value = stored.get(name)
        return defaults[name] if value is None or value == "" else value

    base_url = str(pick("baseUrl")).rstrip("/")
    api_key = stored.get("apiKey") or ""
    if not api_key and _may_use_environment_key(backend, base_url):
        api_key = defaults["apiKey"]
    return StepConfig(
        step=step, backend=backend, model=pick("model"), base_url=base_url,
        api_key=api_key, timeout_seconds=float(pick("timeoutSeconds")),
        max_tokens=int(pick("maxTokens")), num_thread=int(pick("numThread")),
        max_attempts=int(pick("maxAttempts")), reasoning_effort=pick("reasoningEffort"),
        summary_word_limit=int(pick("summaryWordLimit")),
    )


def resolve(stored: dict[str, Any]) -> ServiceConfig:
    processing = stored["processing"]

    def pick(name: str, fallback: Any) -> Any:
        value = processing.get(name)
        return fallback if value is None or value == "" else value

    return ServiceConfig(
        steps={step: _resolve_step(step, stored["steps"][step]) for step in STEP_IDS},
        remote_api_concurrency=int(pick("remoteApiConcurrency", _env_int("AUTODOCS_REMOTE_API_CONCURRENCY", 8))),
        max_concurrent_jobs=int(pick("maxConcurrentJobs", _env_int("AUTODOCS_MAX_CONCURRENT_JOBS", 2))),
        inference_location=pick("inferenceLocation", os.getenv("AUTODOCS_INFERENCE_LOCATION", "auto").lower()),
    )


def load_config() -> ServiceConfig:
    """Current effective configuration, read fresh so edits apply to new jobs."""
    return resolve(read_file_config())


def update_file_config(changes: dict[str, Any]) -> dict[str, Any]:
    """Merge `changes` into the stored file and write it atomically (mode 0600).

    A null value resets a setting to its default. For `apiKey`, omit the key to
    keep the stored secret, send null or "" to remove it. Returns the new
    stored configuration.
    """
    if not isinstance(changes, dict):
        raise ConfigError("The update must be a JSON object.")
    with _lock:
        stored = read_file_config()
        merged = {"processing": dict(stored["processing"]), "steps": {s: dict(v) for s, v in stored["steps"].items()}}
        incoming = {"processing": changes.get("processing") or {}, "steps": changes.get("steps") or {}}
        validate(incoming)
        merged["processing"].update(incoming["processing"])
        for step, values in incoming["steps"].items():
            merged["steps"][step].update(values)
        for step in STEP_IDS:  # Resetting or clearing stores nothing, so the default applies.
            merged["steps"][step] = {k: v for k, v in merged["steps"][step].items() if v not in (None, "")}
        merged["processing"] = {k: v for k, v in merged["processing"].items() if v not in (None, "")}
        resolve(merged)  # Fails on an inconsistent combination before anything is written.
        path = config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".config-", suffix=".tmp")
        try:
            with os.fdopen(descriptor, "w") as handle:
                json.dump({"version": 1, **merged}, handle, indent=2)
                handle.write("\n")
            os.chmod(temporary, 0o600)
            os.replace(temporary, path)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise
        return merged


def public_view(stored: dict[str, Any]) -> dict[str, Any]:
    """What the API returns: stored values, effective values, no secrets."""
    resolved = resolve(stored)
    steps: dict[str, Any] = {}
    for step in STEP_IDS:
        values = {k: v for k, v in stored["steps"][step].items() if k != "apiKey"}
        effective = resolved.steps[step]
        steps[step] = {
            "stored": values,
            "effective": {
                "backend": effective.backend, "model": effective.model, "baseUrl": effective.base_url,
                "timeoutSeconds": effective.timeout_seconds, "maxTokens": effective.max_tokens,
                "numThread": effective.num_thread, "maxAttempts": effective.max_attempts,
                "reasoningEffort": effective.reasoning_effort, "summaryWordLimit": effective.summary_word_limit,
            },
            "apiKeySet": bool(effective.api_key),
            "apiKeyInFile": bool(stored["steps"][step].get("apiKey")),
        }
    return {
        "path": str(config_path()),
        "steps": steps,
        "processing": {
            "stored": stored["processing"],
            "effective": {
                "remoteApiConcurrency": resolved.remote_api_concurrency,
                "maxConcurrentJobs": resolved.max_concurrent_jobs,
                "inferenceLocation": resolved.inference_location,
            },
        },
        "schema": {
            "backends": list(BACKENDS),
            "chatBackends": list(CHAT_BACKENDS),
            "reasoningEfforts": list(REASONING_EFFORTS),
            "locations": list(LOCATIONS),
            "limits": {name: {"min": low, "max": high} for name, (kind, low, high) in {**STEP_FIELDS, **PROCESSING_FIELDS}.items() if low is not None},
        },
    }
