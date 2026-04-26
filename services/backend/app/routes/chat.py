"""Text-only chat route.

Accepts a user turn, plus an optional `session_id` and `preset`. Maintains
per-session memory so follow-ups feel coherent, and streams the provider
reply as Server-Sent Events that the Electron renderer consumes.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.presets import build_system_prompt
from app.providers import get_chat_provider
from app.providers.base import ChatMessage
from app.store.memory import Exchange, store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

# How many of the most recent exchanges to replay as context.
# (The spec calls for the last 4 turns, so 8 messages total: user+assistant.)
MAX_CONTEXT_EXCHANGES = 16


class IncomingMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str


class ChatRequest(BaseModel):
    messages: list[IncomingMessage] = Field(
        default_factory=list,
        description=(
            "The new turn(s) from the client. Typically a single user message; "
            "prior turns are already stored server-side by `session_id`."
        ),
    )
    session_id: str | None = None
    preset: str | None = None
    source: str | None = Field(
        default=None,
        description="Provenance tag for session history (e.g. 'just-ask').",
    )
    source_text: str | None = Field(
        default=None,
        description=(
            "Optional verbatim text the user selected or captured on screen. "
            "We attach it as context so the model grounds its reply in this passage."
        ),
    )
    window_context: dict | None = Field(
        default=None,
        description=(
            "Optional hint about what the user is currently looking at "
            "(active window title / URL). Rendered as an invisible system note."
        ),
    )


def _selection_preamble(source_text: str) -> str:
    # Quote fences keep even code-heavy selections from colliding with the
    # model's own markdown output.
    return (
        "The user has selected / captured the following text on their screen. "
        "Ground your answer in it directly — refer to it, quote from it, do not "
        "invent content beyond it.\n\n"
        "<selection>\n"
        f"{source_text.strip()}\n"
        "</selection>"
    )


def _window_hint(window_context: dict | None) -> str | None:
    if not window_context:
        return None
    title = (window_context.get("title") or "").strip()
    url = (window_context.get("url") or "").strip()
    if not title and not url:
        return None
    bits = [f'title="{title}"' if title else None, f'url="{url}"' if url else None]
    return "User is currently viewing: " + ", ".join(b for b in bits if b)


def _build_wire_messages(
    session_messages: list[Exchange],
    incoming: list[IncomingMessage],
    preset: str | None,
    source_text: str | None = None,
    window_context: dict | None = None,
) -> list[ChatMessage]:
    """Assemble the messages we'll send upstream."""
    wire: list[ChatMessage] = [
        {"role": "system", "content": build_system_prompt(preset)}
    ]
    hint = _window_hint(window_context)
    if hint:
        wire.append({"role": "system", "content": hint})
    if source_text:
        wire.append({"role": "system", "content": _selection_preamble(source_text)})
    for m in session_messages[-MAX_CONTEXT_EXCHANGES:]:
        if m.role in ("user", "assistant"):
            wire.append({"role": m.role, "content": m.content})
    for m in incoming:
        wire.append({"role": m.role, "content": m.content})
    return wire


async def _sse_event_stream(
    session_id: str,
    wire_messages: list[ChatMessage],
    user_turn_text: str,
    source: str | None,
    source_text: str | None = None,
    source_image_path: str | None = None,
    preset: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yield SSE events: token deltas, then a final 'done' event.

    sse-starlette accepts dicts of the form `{"event": str, "data": str}`.
    Clients should handle the `token`, `done`, and `error` event types.
    """
    provider = get_chat_provider()
    # Announce the provider so the renderer can show a subtle badge if it wants.
    yield {
        "event": "meta",
        "data": json.dumps({"provider": provider.name, "model": provider.model}),
    }

    assistant_buffer: list[str] = []
    try:
        async for delta in provider.chat_stream(wire_messages):
            assistant_buffer.append(delta)
            # JSON-encode so newlines/quotes never break the SSE framing.
            yield {"event": "token", "data": json.dumps({"text": delta})}
    except Exception as exc:  # noqa: BLE001
        logger.exception("chat stream failed")
        yield {"event": "error", "data": json.dumps({"message": str(exc)})}
        # Still persist the partial turn so the session isn't orphaned.
    finally:
        assistant_text = "".join(assistant_buffer).strip()
        # Persist *after* we've streamed, so memory == what the user saw.
        try:
            store.append(
                session_id,
                Exchange(
                    role="user",
                    content=user_turn_text,
                    source=source,
                    source_text=source_text,
                    source_image_path=source_image_path,
                    preset=preset,
                ),
            )
            if assistant_text:
                store.append(
                    session_id,
                    Exchange(
                        role="assistant",
                        content=assistant_text,
                        source=source,
                        preset=preset,
                    ),
                )
        except KeyError:
            # Session vanished mid-stream — nothing to persist to.
            pass
        yield {
            "event": "done",
            "data": json.dumps({"session_id": session_id}),
        }


@router.post("")
async def chat(req: ChatRequest) -> EventSourceResponse:
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages cannot be empty")

    # The last user message is what we'll persist as "the turn".
    last_user = next(
        (m for m in reversed(req.messages) if m.role == "user"),
        None,
    )
    if last_user is None:
        raise HTTPException(status_code=400, detail="no user message in payload")

    session = store.ensure(req.session_id)
    wire_messages = _build_wire_messages(
        session.messages,
        req.messages,
        req.preset,
        source_text=req.source_text,
        window_context=req.window_context,
    )

    return EventSourceResponse(
        _sse_event_stream(
            session_id=session.id,
            wire_messages=wire_messages,
            user_turn_text=last_user.content,
            source=req.source,
            source_text=req.source_text,
            preset=req.preset,
        ),
        headers={"X-Session-Id": session.id},
    )
