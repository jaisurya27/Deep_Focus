"""Runtime configuration loaded from environment variables / .env."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load a `.env` sitting next to the services/backend directory if present.
# `override=True` makes the file authoritative over the shell env — otherwise
# a stale `XAI_API_KEY` exported from your .zshrc silently wins over an empty
# value in .env, which is maximally confusing.
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
if _ENV_PATH.exists():
    load_dotenv(_ENV_PATH, override=True)


@dataclass(frozen=True)
class Settings:
    # `auto` picks the first provider with a valid API key.
    # CHAT_PROVIDER prefers xAI (keeps Grok continuity with the old project);
    # VISION_PROVIDER prefers OpenAI because grok-vision is often gated;
    # IMAGE_PROVIDER prefers OpenAI because DALL·E is generally accessible.
    chat_provider: str
    vision_provider: str
    image_provider: str
    xai_api_key: str | None
    xai_base_url: str
    xai_model: str
    xai_vision_model: str
    xai_image_model: str
    openai_api_key: str | None
    openai_base_url: str
    openai_model: str
    openai_vision_model: str
    openai_image_model: str
    backend_host: str
    backend_port: int
    session_db_path: str | None
    agentverse_bridge_url: str


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def get_settings() -> Settings:
    return Settings(
        chat_provider=(_env("CHAT_PROVIDER", "auto") or "auto").lower(),
        vision_provider=(_env("VISION_PROVIDER", "auto") or "auto").lower(),
        image_provider=(_env("IMAGE_PROVIDER", "auto") or "auto").lower(),
        xai_api_key=_env("XAI_API_KEY"),
        xai_base_url=_env("XAI_BASE_URL", "https://api.x.ai/v1") or "https://api.x.ai/v1",
        xai_model=_env("XAI_MODEL", "grok-4-fast-reasoning") or "grok-4-fast-reasoning",
        xai_vision_model=_env("XAI_VISION_MODEL", "grok-2-vision-latest")
        or "grok-2-vision-latest",
        xai_image_model=_env("XAI_IMAGE_MODEL", "grok-2-image") or "grok-2-image",
        openai_api_key=_env("OPENAI_API_KEY"),
        openai_base_url=_env("OPENAI_BASE_URL", "https://api.openai.com/v1")
        or "https://api.openai.com/v1",
        openai_model=_env("OPENAI_MODEL", "gpt-4o-mini") or "gpt-4o-mini",
        openai_vision_model=_env("OPENAI_VISION_MODEL", "gpt-4o") or "gpt-4o",
        openai_image_model=_env("OPENAI_IMAGE_MODEL", "gpt-image-1.5") or "gpt-image-1.5",
        backend_host=_env("BACKEND_HOST", "127.0.0.1") or "127.0.0.1",
        backend_port=int(_env("BACKEND_PORT", "8765") or "8765"),
        session_db_path=_env("SESSION_DB_PATH"),
        agentverse_bridge_url=_env("AGENTVERSE_BRIDGE_URL", "http://127.0.0.1:8020") or "http://127.0.0.1:8020",
    )


settings = get_settings()
