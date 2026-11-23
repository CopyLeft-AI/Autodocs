"""Bounded retries for transient Cloud Temple failures."""

import asyncio

import httpx
import pytest

import cloudtemple


SUCCESS = {
    "choices": [
        {
            "finish_reason": "stop",
            "message": {"content": "READY"},
        }
    ]
}


def run_request(client):
    return asyncio.run(
        cloudtemple.chat_completion(
            client,
            model="test-model",
            prompt="Synthetic test prompt",
            max_tokens=128,
            timeout_seconds=10,
        )
    )


def configure(monkeypatch):
    monkeypatch.setenv("CLOUDTEMPLE_API_KEY", "fake-test-key")
    monkeypatch.setenv("CLOUDTEMPLE_MAX_ATTEMPTS", "3")
    monkeypatch.delenv("CLOUDTEMPLE_BASE_URL", raising=False)


def test_retries_503_and_429(monkeypatch):
    configure(monkeypatch)
    calls = []
    delays = []

    async def fake_sleep(seconds):
        delays.append(seconds)

    monkeypatch.setattr(cloudtemple.asyncio, "sleep", fake_sleep)

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(503, json={"error": "saturation"})
        if len(calls) == 2:
            return httpx.Response(
                429,
                headers={"Retry-After": "1"},
                json={"error": "rate limit"},
            )
        return httpx.Response(200, json=SUCCESS)

    async def execute():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            return await cloudtemple.chat_completion(
                client,
                model="test-model",
                prompt="Synthetic test prompt",
                max_tokens=128,
                timeout_seconds=10,
            )

    assert asyncio.run(execute()) == "READY"
    assert len(calls) == 3
    assert delays == [2.0, 4.0]


@pytest.mark.parametrize("status", [400, 401, 403])
def test_client_errors_are_not_retried(monkeypatch, status):
    configure(monkeypatch)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"error": "client error"})

    async def execute():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            await cloudtemple.chat_completion(
                client,
                model="test-model",
                prompt="Synthetic test prompt",
                max_tokens=128,
                timeout_seconds=10,
            )

    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(execute())

    assert len(calls) == 1


def test_stops_after_three_503_responses(monkeypatch):
    configure(monkeypatch)
    calls = []
    delays = []

    async def fake_sleep(seconds):
        delays.append(seconds)

    monkeypatch.setattr(cloudtemple.asyncio, "sleep", fake_sleep)

    def handler(request):
        calls.append(request)
        return httpx.Response(503, json={"error": "saturation"})

    async def execute():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            await cloudtemple.chat_completion(
                client,
                model="test-model",
                prompt="Synthetic test prompt",
                max_tokens=128,
                timeout_seconds=10,
            )

    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(execute())

    assert len(calls) == 3
    assert delays == [2.0, 4.0]


def test_empty_reasoning_response_retries_and_fails(monkeypatch):
    configure(monkeypatch)
    calls = []
    delays = []

    async def fake_sleep(seconds):
        delays.append(seconds)

    monkeypatch.setattr(cloudtemple.asyncio, "sleep", fake_sleep)

    def handler(request):
        calls.append(request)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"content": ""},
                    }
                ],
                "usage": {
                    "completion_tokens": 0,
                    "reasoning_tokens": 256,
                },
            },
        )

    async def execute():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            await cloudtemple.chat_completion(
                client,
                model="test-model",
                prompt="Synthetic test prompt",
                max_tokens=256,
                timeout_seconds=10,
            )

    with pytest.raises(RuntimeError, match="no text content"):
        asyncio.run(execute())

    assert len(calls) == 3
    assert delays == [2.0, 4.0]


def test_retries_transient_connection_failure(monkeypatch):
    configure(monkeypatch)
    calls = []

    async def fake_sleep(seconds):
        pass

    monkeypatch.setattr(cloudtemple.asyncio, "sleep", fake_sleep)

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ConnectError("temporary failure", request=request)
        return httpx.Response(200, json=SUCCESS)

    async def execute():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            return await cloudtemple.chat_completion(
                client,
                model="test-model",
                prompt="Synthetic test prompt",
                max_tokens=128,
                timeout_seconds=10,
            )

    assert asyncio.run(execute()) == "READY"
    assert len(calls) == 2


def test_empty_response_then_success(monkeypatch):
    configure(monkeypatch)
    calls = []
    delays = []

    async def fake_sleep(seconds):
        delays.append(seconds)

    monkeypatch.setattr(cloudtemple.asyncio, "sleep", fake_sleep)

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(
                200,
                json={
                    "choices": [{
                        "finish_reason": "stop",
                        "message": {"content": ""},
                    }]
                },
            )
        return httpx.Response(200, json=SUCCESS)

    async def execute():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            return await cloudtemple.chat_completion(
                client,
                model="test-model",
                prompt="Synthetic test prompt",
                max_tokens=128,
                timeout_seconds=10,
            )

    assert asyncio.run(execute()) == "READY"
    assert len(calls) == 2
    assert delays == [2.0]


def test_token_limit_error_is_not_retried(monkeypatch):
    configure(monkeypatch)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            200,
            json={
                "choices": [{
                    "finish_reason": "length",
                    "message": {"content": ""},
                }]
            },
        )

    async def execute():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            await cloudtemple.chat_completion(
                client,
                model="test-model",
                prompt="Synthetic test prompt",
                max_tokens=128,
                timeout_seconds=10,
            )

    with pytest.raises(RuntimeError, match="max_tokens"):
        asyncio.run(execute())

    assert len(calls) == 1


def test_long_retry_after_is_deferred_to_persistent_scheduler(monkeypatch):
    """A long provider cooldown must not be shortened or slept in-process."""
    configure(monkeypatch)
    calls = []
    delays = []

    async def fake_sleep(seconds):
        delays.append(seconds)

    monkeypatch.setattr(cloudtemple.asyncio, "sleep", fake_sleep)

    def handler(request):
        calls.append(request)
        return httpx.Response(
            429,
            headers={"Retry-After": "600"},
            json={"error": "rate limit"},
        )

    async def execute():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            await cloudtemple.chat_completion(
                client,
                model="test-model",
                prompt="Synthetic test prompt",
                max_tokens=128,
                timeout_seconds=10,
                defer_long_retries=True,
            )

    with pytest.raises(httpx.HTTPStatusError) as error:
        asyncio.run(execute())

    assert error.value.response.status_code == 429
    assert len(calls) == 1
    assert delays == []


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("600", 600.0),
        ("7200", 7200.0),
        ("invalid", None),
        ("-5", None),
        ("nan", None),
        ("", None),
        (None, None),
    ],
)
def test_parse_retry_after_values(header, expected):
    assert cloudtemple.parse_retry_after_seconds(header) == expected


def test_parse_retry_after_http_date():
    from datetime import datetime, timedelta, timezone
    from email.utils import format_datetime

    deadline = datetime.now(timezone.utc) + timedelta(hours=2)
    header = format_datetime(deadline, usegmt=True)

    delay = cloudtemple.parse_retry_after_seconds(header)

    assert delay is not None
    assert 7190 <= delay <= 7200


def test_short_http_date_retry_after_is_respected(monkeypatch):
    """An HTTP-date cooldown below 30 seconds must not be ignored."""
    from datetime import datetime, timedelta, timezone
    from email.utils import format_datetime

    configure(monkeypatch)
    calls = []
    delays = []
    header = format_datetime(
        datetime.now(timezone.utc) + timedelta(seconds=20),
        usegmt=True,
    )

    async def fake_sleep(seconds):
        delays.append(seconds)

    monkeypatch.setattr(cloudtemple.asyncio, "sleep", fake_sleep)

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(
                429,
                headers={"Retry-After": header},
            )
        return httpx.Response(200, json=SUCCESS)

    async def execute():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            return await cloudtemple.chat_completion(
                client,
                model="test-model",
                prompt="Synthetic test prompt",
                max_tokens=128,
                timeout_seconds=10,
            )

    assert asyncio.run(execute()) == "READY"
    assert len(calls) == 2
    assert len(delays) == 1
    assert 18 <= delays[0] <= 21


def test_legacy_long_retry_after_retries_internally(monkeypatch):
    """Without a persistent scheduler, long cooldowns stay in the adapter."""
    configure(monkeypatch)
    calls = []
    delays = []

    async def fake_sleep(seconds):
        delays.append(seconds)

    monkeypatch.setattr(cloudtemple.asyncio, "sleep", fake_sleep)

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(
                503,
                headers={"Retry-After": "600"},
                json={"error": "temporary overload"},
            )
        return httpx.Response(200, json=SUCCESS)

    async def execute():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            return await cloudtemple.chat_completion(
                client,
                model="test-model",
                prompt="Synthetic test prompt",
                max_tokens=128,
                timeout_seconds=10,
            )

    assert asyncio.run(execute()) == "READY"
    assert len(calls) == 2
    assert delays == [600.0]


@pytest.mark.parametrize("defer_long_retries", [False, True])
def test_model0_forwards_retry_mode_to_cloudtemple(monkeypatch, defer_long_retries):
    import model0

    monkeypatch.setattr(model0, "LLM_BACKEND", "cloudtemple")
    received = []

    async def fake_completion(client, **kwargs):
        received.append(kwargs["defer_long_retries"])
        return "OLD EVENT"

    monkeypatch.setattr(model0, "chat_completion", fake_completion)

    prompt = (
        "<|im_start|>user<|im_sep|>test"
        "<|im_end|><|im_start|>assistant<|im_sep|>"
    )

    async def execute():
        if defer_long_retries:
            return await model0.classify_chunk(
                None, prompt, defer_long_retries=True
            )
        return await model0.classify_chunk(None, prompt)

    assert asyncio.run(execute()) == "old event"
    assert received == [defer_long_retries]


@pytest.mark.parametrize("defer_long_retries", [False, True])
def test_model1_forwards_retry_mode_to_cloudtemple(monkeypatch, defer_long_retries):
    import model1

    monkeypatch.setattr(model1, "LLM_BACKEND", "cloudtemple")
    received = []

    async def fake_completion(client, **kwargs):
        received.append(kwargs["defer_long_retries"])
        return "READY"

    monkeypatch.setattr(model1, "chat_completion", fake_completion)

    async def execute():
        if defer_long_retries:
            return await model1.generate(
                None, "test", defer_long_retries=True
            )
        return await model1.generate(None, "test")

    assert asyncio.run(execute()) == "READY"
    assert received == [defer_long_retries]
