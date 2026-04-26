"""LLM provider abstraction.

The rest of the app talks to `get_chat_provider()` / `get_vision_provider()` /
`get_image_provider()` and each returns something with a uniform streaming
interface. Swapping Grok ↔ OpenAI ↔ Anthropic is a config change.
"""

from __future__ import annotations

from app.config import settings

from .base import ChatProvider, ImageProvider, VisionProvider
from .openai_fallback import (
    OpenAIImageProvider,
    OpenAIProvider,
    OpenAIVisionProvider,
)
from .xai import XAIImageProvider, XAIProvider, XAIVisionProvider


# --- Text chat ------------------------------------------------------------


def _xai() -> ChatProvider | None:
    if not settings.xai_api_key:
        return None
    return XAIProvider(
        api_key=settings.xai_api_key,
        base_url=settings.xai_base_url,
        model=settings.xai_model,
    )


def _openai() -> ChatProvider | None:
    if not settings.openai_api_key:
        return None
    return OpenAIProvider(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        model=settings.openai_model,
    )


def _mock_chat() -> ChatProvider:
    from .mock import MockProvider

    return MockProvider()


def get_chat_provider() -> ChatProvider:
    """Resolve the text-chat provider based on CHAT_PROVIDER."""
    choice = settings.chat_provider

    if choice == "xai":
        provider = _xai()
        if provider is None:
            raise RuntimeError(
                "CHAT_PROVIDER=xai but XAI_API_KEY is missing. "
                "Set XAI_API_KEY in services/backend/.env or switch CHAT_PROVIDER."
            )
        return provider
    if choice == "openai":
        provider = _openai()
        if provider is None:
            raise RuntimeError(
                "CHAT_PROVIDER=openai but OPENAI_API_KEY is missing. "
                "Set OPENAI_API_KEY in services/backend/.env or switch CHAT_PROVIDER."
            )
        return provider
    if choice == "mock":
        return _mock_chat()
    return _xai() or _openai() or _mock_chat()


# --- Vision ---------------------------------------------------------------


def _xai_vision() -> VisionProvider | None:
    if not settings.xai_api_key:
        return None
    return XAIVisionProvider(
        api_key=settings.xai_api_key,
        base_url=settings.xai_base_url,
        model=settings.xai_vision_model,
    )


def _openai_vision() -> VisionProvider | None:
    if not settings.openai_api_key:
        return None
    return OpenAIVisionProvider(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        model=settings.openai_vision_model,
    )


def _mock_vision() -> VisionProvider:
    from .mock import MockVisionProvider

    return MockVisionProvider()


def get_vision_provider() -> VisionProvider:
    """Resolve the vision provider based on VISION_PROVIDER (defaults to auto).

    Auto order is OpenAI first (GPT-4o vision is broadly available) then xAI
    (grok vision needs an allow-listed model), then the mock.
    """
    choice = settings.vision_provider
    if choice == "xai":
        p = _xai_vision()
        if p is None:
            raise RuntimeError("VISION_PROVIDER=xai but XAI_API_KEY missing")
        return p
    if choice == "openai":
        p = _openai_vision()
        if p is None:
            raise RuntimeError("VISION_PROVIDER=openai but OPENAI_API_KEY missing")
        return p
    if choice == "mock":
        return _mock_vision()
    return _openai_vision() or _xai_vision() or _mock_vision()


# --- Image generation ------------------------------------------------------


def _xai_image() -> ImageProvider | None:
    if not settings.xai_api_key:
        return None
    return XAIImageProvider(
        api_key=settings.xai_api_key,
        base_url=settings.xai_base_url,
        model=settings.xai_image_model,
    )


def _openai_image() -> ImageProvider | None:
    if not settings.openai_api_key:
        return None
    return OpenAIImageProvider(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        model=settings.openai_image_model,
    )


def _mock_image() -> ImageProvider:
    from .mock import MockImageProvider

    return MockImageProvider()


def get_image_provider() -> ImageProvider:
    choice = settings.image_provider
    if choice == "xai":
        p = _xai_image()
        if p is None:
            raise RuntimeError("IMAGE_PROVIDER=xai but XAI_API_KEY missing")
        return p
    if choice == "openai":
        p = _openai_image()
        if p is None:
            raise RuntimeError("IMAGE_PROVIDER=openai but OPENAI_API_KEY missing")
        return p
    if choice == "mock":
        return _mock_image()
    # Auto order: xAI first (Grok image gen is the preferred provider),
    # OpenAI as fallback, mock for offline demos.
    return _xai_image() or _openai_image() or _mock_image()


__all__ = [
    "ChatProvider",
    "ImageProvider",
    "VisionProvider",
    "get_chat_provider",
    "get_image_provider",
    "get_vision_provider",
]
