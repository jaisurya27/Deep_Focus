"""Development fallback when no API key is configured.

Streams a short, helpful message so the panel UX is still demoable end-to-end
without secrets. This makes Phase 1 runnable before you paste a key in.
"""

from __future__ import annotations

import asyncio
import base64
from typing import AsyncIterator

from .base import ChatMessage, GeneratedImage, VisionMessage


class MockProvider:
    name = "mock"
    model = "mock-echo"

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        user_text = _last_user_text(messages)
        snippet = user_text[:160] + ("…" if len(user_text) > 160 else "")
        reply = (
            "**Deep Focus is running in mock mode.**\n\n"
            "I don't have an API key yet, so I can't actually think. "
            "Add `XAI_API_KEY` or `OPENAI_API_KEY` to `services/backend/.env` and restart.\n\n"
            f"You asked: _{snippet}_\n\n"
            "In the meantime, streaming, follow-ups, and session memory are all live."
        )
        async for tok in _word_stream(reply):
            yield tok


class MockVisionProvider:
    name = "mock"
    model = "mock-vision"

    async def chat_stream_multimodal(
        self, messages: list[VisionMessage]
    ) -> AsyncIterator[str]:
        reply = (
            "**Mock vision mode.**\n\n"
            "No vision API key set. Add `XAI_API_KEY` or `OPENAI_API_KEY` to "
            "`services/backend/.env` to enable real image understanding."
        )
        async for tok in _word_stream(reply):
            yield tok


class MockImageProvider:
    name = "mock"
    model = "mock-imagine"

    async def generate(self, prompt: str) -> GeneratedImage:
        # A 32x32 dark emerald placeholder so the UI layout still looks right.
        png = _solid_png(32, 32, (15, 118, 110))
        return GeneratedImage(
            provider="mock",
            model=self.model,
            data_url=f"data:image/png;base64,{base64.b64encode(png).decode()}",
        )


def _last_user_text(messages: list) -> str:
    for m in reversed(messages):
        if m.get("role") != "user":
            continue
        c = m.get("content")
        if isinstance(c, str):
            return c
        if isinstance(c, list):
            for part in c:
                if isinstance(part, dict) and part.get("type") == "text":
                    return str(part.get("text", ""))
        return ""
    return "(no user message)"


async def _word_stream(text: str):
    buf = ""
    for ch in text:
        buf += ch
        if ch == " " or ch == "\n":
            await asyncio.sleep(0.015)
            yield buf
            buf = ""
    if buf:
        yield buf


def _solid_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Minimal PNG writer (no Pillow dep) — for the placeholder only."""
    import struct
    import zlib

    def _chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = b""
    for _ in range(height):
        raw += b"\x00" + bytes(rgb) * width
    idat = zlib.compress(raw)
    return sig + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")
