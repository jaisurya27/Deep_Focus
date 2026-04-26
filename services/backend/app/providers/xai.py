"""xAI Grok provider (primary) — text, vision, and image generation."""

from __future__ import annotations

import base64
from typing import AsyncIterator

import httpx

from ._openai_compat import stream_openai_compatible_chat
from .base import ChatMessage, GeneratedImage, VisionMessage


class XAIProvider:
    name = "xai"

    def __init__(self, *, api_key: str, base_url: str, model: str) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self.model = model

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        async for chunk in stream_openai_compatible_chat(
            base_url=self._base_url,
            api_key=self._api_key,
            model=self.model,
            messages=messages,
        ):
            yield chunk

    async def chat_stream_json(
        self, messages: list[ChatMessage]
    ) -> AsyncIterator[str]:
        """Stream a JSON-mode response (guaranteed parseable JSON object)."""
        async for chunk in stream_openai_compatible_chat(
            base_url=self._base_url,
            api_key=self._api_key,
            model=self.model,
            messages=messages,
            extra_payload={"response_format": {"type": "json_object"}},
        ):
            yield chunk


class XAIVisionProvider:
    name = "xai"

    def __init__(self, *, api_key: str, base_url: str, model: str) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self.model = model

    async def chat_stream_multimodal(
        self, messages: list[VisionMessage]
    ) -> AsyncIterator[str]:
        async for chunk in stream_openai_compatible_chat(
            base_url=self._base_url,
            api_key=self._api_key,
            model=self.model,
            messages=messages,
        ):
            yield chunk

    async def chat_stream_multimodal_json(
        self, messages: list[VisionMessage]
    ) -> AsyncIterator[str]:
        async for chunk in stream_openai_compatible_chat(
            base_url=self._base_url,
            api_key=self._api_key,
            model=self.model,
            messages=messages,
            extra_payload={"response_format": {"type": "json_object"}},
        ):
            yield chunk


class XAIImageProvider:
    name = "xai"

    def __init__(self, *, api_key: str, base_url: str, model: str) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self.model = model

    async def generate(self, prompt: str) -> GeneratedImage:
        url = f"{self._base_url.rstrip('/')}/images/generations"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.model,
            "prompt": prompt,
            "n": 1,
            "response_format": "b64_json",
        }
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(url, headers=headers, json=body)
            if resp.status_code >= 400:
                raise RuntimeError(
                    f"xAI image generation failed ({resp.status_code}): "
                    f"{resp.text[:400]}"
                )
            data = resp.json()

        first = (data.get("data") or [{}])[0]
        b64 = first.get("b64_json")
        if b64:
            return GeneratedImage(
                provider="xai",
                model=self.model,
                data_url=f"data:image/png;base64,{b64}",
            )
        remote = first.get("url")
        if remote:
            # Inline fetch so the renderer never has to talk to xAI directly.
            async with httpx.AsyncClient(timeout=30.0) as client:
                img_resp = await client.get(remote)
                img_resp.raise_for_status()
                b64_payload = base64.b64encode(img_resp.content).decode()
            return GeneratedImage(
                provider="xai",
                model=self.model,
                data_url=f"data:image/png;base64,{b64_payload}",
            )
        raise RuntimeError("xAI image response had neither b64_json nor url")
