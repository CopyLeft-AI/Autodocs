"""OpenAI-compatible Cloud Temple chat completion adapter."""

import os
from urllib.parse import urlsplit


async def chat_completion(client, *, model, prompt, max_tokens, timeout_seconds):
    api_key = os.getenv("CLOUDTEMPLE_API_KEY", "").strip()
    if not api_key:
        raise ValueError("CLOUDTEMPLE_API_KEY is not configured")

    base_url = os.getenv(
        "CLOUDTEMPLE_BASE_URL",
        "https://api.ai.cloud-temple.com/v1",
    ).rstrip("/")

    parsed_url = urlsplit(base_url)
    if parsed_url.scheme != "https" or not parsed_url.hostname:
        raise ValueError("CLOUDTEMPLE_BASE_URL must be a valid HTTPS URL")

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

    data = response.json()
    choices = data.get("choices") if isinstance(data, dict) else None
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("Cloud Temple returned no completion choices")

    choice = choices[0]
    if choice.get("finish_reason") == "length":
        raise RuntimeError("Cloud Temple response exceeded max_tokens")

    message = choice.get("message")
    content = message.get("content") if isinstance(message, dict) else None

    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("Cloud Temple returned no text content")

    return content.strip()
