"""Multimodal (image + text) chat route.

Accepts a user turn plus a `image_data_url` (data:image/png;base64,…). We
re-use the same session store as `/chat`, so follow-up text-only turns in the
same session continue the conversation started around the image.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.presets import build_system_prompt
from app.providers import get_vision_provider
from app.store.memory import Exchange, store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat-vision"])

MAX_CONTEXT_EXCHANGES = 8


class IncomingMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str


class VisionChatRequest(BaseModel):
    messages: list[IncomingMessage] = Field(default_factory=list)
    session_id: str | None = None
    preset: str | None = None
    source: str | None = None
    source_text: str | None = None
    image_data_url: str = Field(description="data:image/...;base64,<payload> data URL")
    window_context: dict | None = None


def _wire_messages(
    session_messages: list[Exchange],
    incoming: list[IncomingMessage],
    preset: str | None,
    source_text: str | None,
    image_data_url: str,
) -> list[dict]:
    """Assemble the multimodal messages we send upstream."""
    wire: list[dict] = [
        {"role": "system", "content": build_system_prompt(preset)},
    ]
    if source_text:
        wire.append(
            {
                "role": "system",
                "content": (
                    "Context text associated with the image:\n<selection>\n"
                    f"{source_text.strip()}\n</selection>"
                ),
            }
        )
    # Replay prior text turns (images are attached per-turn and not replayed to
    # keep the payload small; the conversation summary lives in the text).
    for m in session_messages[-MAX_CONTEXT_EXCHANGES:]:
        if m.role in ("user", "assistant"):
            wire.append({"role": m.role, "content": m.content})

    # The last user turn — text + image in a single multimodal content array.
    last_user_text = next(
        (m.content for m in reversed(incoming) if m.role == "user"),
        "Describe this image.",
    )
    wire.append(
        {
            "role": "user",
            "content": [
                {"type": "text", "text": last_user_text},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        }
    )
    return wire


async def _stream(
    session_id: str,
    wire: list[dict],
    user_turn_text: str,
    source: str | None,
    source_text: str | None,
    preset: str | None,
) -> AsyncIterator[dict[str, Any]]:
    provider = get_vision_provider()
    yield {
        "event": "meta",
        "data": json.dumps({"provider": provider.name, "model": provider.model}),
    }
    buffer: list[str] = []
    try:
        async for delta in provider.chat_stream_multimodal(wire):
            buffer.append(delta)
            yield {"event": "token", "data": json.dumps({"text": delta})}
    except Exception as exc:  # noqa: BLE001
        logger.exception("vision stream failed")
        yield {"event": "error", "data": json.dumps({"message": str(exc)})}
    finally:
        text = "".join(buffer).strip()
        try:
            store.append(
                session_id,
                Exchange(
                    role="user",
                    content=user_turn_text,
                    source=source or "region",
                    source_text=source_text,
                    preset=preset,
                ),
            )
            if text:
                store.append(
                    session_id,
                    Exchange(
                        role="assistant",
                        content=text,
                        source=source or "region",
                        preset=preset,
                    ),
                )
        except KeyError:
            pass
        yield {"event": "done", "data": json.dumps({"session_id": session_id})}


@router.post("/vision")
async def chat_vision(req: VisionChatRequest) -> EventSourceResponse:
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages cannot be empty")
    if not req.image_data_url.startswith("data:"):
        raise HTTPException(status_code=400, detail="image_data_url must be a data URL")
    last_user = next(
        (m for m in reversed(req.messages) if m.role == "user"),
        None,
    )
    if last_user is None:
        raise HTTPException(status_code=400, detail="no user message in payload")

    session = store.ensure(req.session_id)
    wire = _wire_messages(
        session.messages,
        req.messages,
        req.preset,
        req.source_text,
        req.image_data_url,
    )
    return EventSourceResponse(
        _stream(
            session_id=session.id,
            wire=wire,
            user_turn_text=last_user.content,
            source=req.source,
            source_text=req.source_text,
            preset=req.preset,
        ),
        headers={"X-Session-Id": session.id},
    )
