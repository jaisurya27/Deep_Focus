"""Shared streaming helper for OpenAI-compatible chat completions.

xAI's Grok API exposes the same `/chat/completions` schema as OpenAI, so the
same SSE parsing works for both. We keep the transport logic here and let the
concrete providers supply base URL, key, and model.
"""

from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from .base import ChatMessage


async def stream_openai_compatible_chat(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list,
    timeout: float = 60.0,
    extra_payload: dict | None = None,
) -> AsyncIterator[str]:
    """POST to `{base_url}/chat/completions` with `stream=true` and yield text deltas.

    `messages` can contain either plain string content (text-only) or an
    OpenAI-compatible multimodal array (list of {type, text|image_url} parts),
    so the same helper serves `/chat` and `/chat/vision`.
    """

    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    payload: dict = {
        "model": model,
        "messages": messages,
        "stream": True,
    }
    if extra_payload:
        payload.update(extra_payload)

    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            if response.status_code >= 400:
                error_body = await response.aread()
                raise RuntimeError(
                    f"Upstream {response.status_code} from {url}: "
                    f"{error_body.decode(errors='replace')[:500]}"
                )

            async for raw_line in response.aiter_lines():
                if not raw_line:
                    continue
                if not raw_line.startswith("data:"):
                    continue
                data = raw_line[len("data:") :].strip()
                if data == "[DONE]":
                    break
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue

                # Chat completion delta schema: choices[0].delta.content
                choices = event.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield content
