"""Provider interface shared by xAI, OpenAI, and the mock fallback."""

from __future__ import annotations

from typing import AsyncIterator, Protocol, TypedDict


class ChatMessage(TypedDict):
    role: str  # "system" | "user" | "assistant"
    content: str


# Multimodal message used by /chat/vision. OpenAI's chat completions API
# accepts an array of content parts for GPT-4o; xAI's grok-2-vision follows
# the same schema. Using a raw dict here keeps the TypedDict noise low.
VisionMessage = dict


class ChatProvider(Protocol):
    name: str
    model: str

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        """Yield text deltas as they stream in from the upstream model."""
        ...


class VisionProvider(Protocol):
    name: str
    model: str

    async def chat_stream_multimodal(
        self, messages: list[VisionMessage]
    ) -> AsyncIterator[str]:
        """Yield text deltas for a multimodal (image + text) turn."""
        ...


class ImageProvider(Protocol):
    name: str
    model: str

    async def generate(self, prompt: str) -> "GeneratedImage":
        ...


class GeneratedImage(TypedDict, total=False):
    provider: str
    model: str
    # Either data_url (base64 PNG) or url — clients should prefer data_url.
    data_url: str
    url: str
