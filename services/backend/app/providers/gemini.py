"""Google Gemini provider via the OpenAI-compatible endpoint.

Gemini exposes an OpenAI-compatible API at:
  https://generativelanguage.googleapis.com/v1beta/openai/

This lets us reuse the existing fetch_openai_compatible_chat helper
with no streaming (same as xAI).
"""

from __future__ import annotations

from typing import AsyncIterator

from ._openai_compat import fetch_openai_compatible_chat
from .base import ChatMessage, VisionMessage

_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


class GeminiProvider:
    name = "gemini"

    def __init__(self, *, api_key: str, model: str) -> None:
        self._api_key = api_key
        self.model = model

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        async for chunk in fetch_openai_compatible_chat(
            base_url=_GEMINI_BASE_URL,
            api_key=self._api_key,
            model=self.model,
            messages=messages,
        ):
            yield chunk

    async def chat_stream_json(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        async for chunk in fetch_openai_compatible_chat(
            base_url=_GEMINI_BASE_URL,
            api_key=self._api_key,
            model=self.model,
            messages=messages,
            extra_payload={"response_format": {"type": "json_object"}},
        ):
            yield chunk


class GeminiVisionProvider:
    name = "gemini"

    def __init__(self, *, api_key: str, model: str) -> None:
        self._api_key = api_key
        self.model = model

    async def chat_stream_multimodal(
        self, messages: list[VisionMessage]
    ) -> AsyncIterator[str]:
        async for chunk in fetch_openai_compatible_chat(
            base_url=_GEMINI_BASE_URL,
            api_key=self._api_key,
            model=self.model,
            messages=messages,
        ):
            yield chunk

    async def chat_stream_multimodal_json(
        self, messages: list[VisionMessage]
    ) -> AsyncIterator[str]:
        async for chunk in fetch_openai_compatible_chat(
            base_url=_GEMINI_BASE_URL,
            api_key=self._api_key,
            model=self.model,
            messages=messages,
            extra_payload={"response_format": {"type": "json_object"}},
        ):
            yield chunk
