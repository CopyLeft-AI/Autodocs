"""OpenAI-compatible Cloud Temple chat completion adapter."""

import asyncio
import math
import os
from urllib.parse import urlsplit

import httpx


async def chat_completion(client, *, model, prompt, max_tokens, timeout_seconds, base_url=None, api_key=None, max_attempts=None):
    """OpenAI-compatible chat completion with retries.

    base_url, api_key and max_attempts come from the step configuration; when
    omitted they fall back to the CLOUDTEMPLE_* environment variables.
    """
    api_key = (api_key if api_key is not None else os.getenv("CLOUDTEMPLE_API_KEY", "")).strip()
    if not api_key:
        raise ValueError("No API key is configured: set apiKey for this step, or CLOUDTEMPLE_API_KEY")

    base_url = (base_url or os.getenv(
        "CLOUDTEMPLE_BASE_URL",
        "https://api.ai.cloud-temple.com/v1",
    )).rstrip("/")

    parsed_url = urlsplit(base_url)
    if parsed_url.scheme not in ("http", "https") or not parsed_url.hostname:
        raise ValueError("The API base URL must be a valid http(s) URL")

    max_attempts = max_attempts or int(os.getenv("CLOUDTEMPLE_MAX_ATTEMPTS", "3"))
    if not 1 <= max_attempts <= 6:
        raise ValueError("max attempts must be between 1 and 6")

    for attempt in range(1, max_attempts + 1):
        retry_after = None

        try:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "temperature": 0.0,
                    "max_tokens": max_tokens,
                },
                timeout=timeout_seconds,
            )
            response.raise_for_status()

        except httpx.HTTPStatusError as error:
            if (
                error.response.status_code not in (429, 500, 502, 503, 504)
                or attempt == max_attempts
            ):
                raise

            retry_after = error.response.headers.get("Retry-After")

        except httpx.TransportError:
            if attempt == max_attempts:
                raise

        else:
            data = response.json()
            choices = data.get("choices") if isinstance(data, dict) else None

            if not isinstance(choices, list) or not choices:
                raise RuntimeError("Cloud Temple returned no completion choices")

            choice = choices[0]
            if not isinstance(choice, dict):
                raise RuntimeError("Cloud Temple returned invalid choice data")

            if choice.get("finish_reason") == "length":
                raise RuntimeError("Cloud Temple response exceeded max_tokens")

            message = choice.get("message")
            content = (
                message.get("content")
                if isinstance(message, dict)
                else None
            )

            if isinstance(content, str) and content.strip():
                return content.strip()

            # HTTP 200 without usable text is a retriable failure.
            # No response body or secret is included in the error.
            if attempt == max_attempts:
                raise RuntimeError(
                    "Cloud Temple returned no text content "
                    f"after {max_attempts} attempts"
                )

        delay = min(30.0, 2.0 ** attempt)

        if retry_after is not None:
            try:
                requested_delay = float(retry_after)
                if math.isfinite(requested_delay) and requested_delay >= 0:
                    delay = min(30.0, requested_delay)
            except ValueError:
                pass

        await asyncio.sleep(delay)

    raise RuntimeError("Cloud Temple exhausted retry attempts")
