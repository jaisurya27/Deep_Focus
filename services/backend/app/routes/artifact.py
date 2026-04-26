"""Structured artifact route for Glance.

`POST /artifact` takes an action id + optional captured text and/or image and
streams a typed JSON artifact back as Server-Sent Events.

Event types:
    - `meta`     — `{provider, model, session_id}` emitted immediately so the
                   UI can show a badge and bind session id.
    - `progress` — `{chars}` character count of the JSON assembled so far.
                   Lets the thinking orb show subtle liveness without leaking
                   half-formed JSON into the renderer.
    - `artifact` — `{artifact}` the final parsed typed artifact.
    - `error`    — `{message}` fatal error; stream ends after this.
    - `done`     — `{session_id}` always emitted last.

When the backing provider supports JSON-mode (OpenAI / xAI), we set
`response_format={"type":"json_object"}` so the model cannot return anything
other than a parseable object. That eliminates the old greedy-brace fallback
for live models; mock mode still falls back to canned per-action artifacts.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.artifacts import ACTIONS, list_actions, mock_artifact
from app.providers import get_chat_provider, get_vision_provider
from app.router import route_action
from app.store.memory import Exchange, store

logger = logging.getLogger(__name__)

router = APIRouter(tags=["artifact"])


class ArtifactRequest(BaseModel):
    action: str
    text: str | None = None
    image_data_url: str | None = Field(default=None)
    user_instruction: str | None = Field(
        default=None,
        description="Optional free-form instruction to layer on top of the action.",
    )
    session_id: str | None = None
    window_context: dict | None = None


@router.get("/artifact/actions")
def actions_index() -> dict:
    return {"actions": list_actions()}


@router.post("/artifact")
async def artifact(req: ArtifactRequest) -> EventSourceResponse:
    has_image = bool((req.image_data_url or "").strip())
    has_text = bool((req.text or "").strip())

    if req.action == "auto":
        # Router decides the real action later, inside the stream. We do a
        # minimal up-front validation (need at least *some* signal).
        if not has_text and not has_image and not (req.user_instruction or "").strip():
            raise HTTPException(
                status_code=400,
                detail="action 'auto' needs text, an image, or an instruction",
            )
    else:
        spec = ACTIONS.get(req.action)
        if not spec:
            raise HTTPException(
                status_code=400, detail=f"unknown action '{req.action}'"
            )
        if spec.needs_text and not has_text and not has_image:
            raise HTTPException(
                status_code=400,
                detail=f"action '{req.action}' needs text context",
            )
        if spec.needs_image and not has_image:
            raise HTTPException(
                status_code=400,
                detail=f"action '{req.action}' needs an image",
            )

    session = store.ensure(req.session_id)

    return EventSourceResponse(
        _artifact_event_stream(req, session.id, has_image),
        headers={"X-Session-Id": session.id},
    )


async def _artifact_event_stream(
    req: ArtifactRequest,
    session_id: str,
    has_image: bool,
) -> AsyncIterator[dict[str, Any]]:
    routed_alternatives: list[dict[str, Any]] = []
    routed_reason: str | None = None
    chosen_action = req.action

    if req.action == "auto":
        routing = await route_action(
            text=req.text,
            has_image=has_image,
            image_data_url=req.image_data_url,
            user_instruction=req.user_instruction,
            window_context=req.window_context,
        )
        chosen_action = routing["action"]
        routed_alternatives = routing.get("alternatives") or []
        routed_reason = routing.get("reason") or None
        if chosen_action not in ACTIONS:
            chosen_action = "answer"
        yield {
            "event": "routing",
            "data": json.dumps(
                {
                    "action": chosen_action,
                    "alternatives": routed_alternatives,
                    "reason": routed_reason,
                }
            ),
        }

    spec = ACTIONS[chosen_action]
    user_payload = _user_payload(req.text, req.user_instruction, spec.label)

    # Select provider + build wire payload.
    if has_image:
        provider = get_vision_provider()
        wire = [
            {"role": "system", "content": spec.system_prompt},
            _window_hint(req.window_context),
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_payload},
                    {"type": "image_url", "image_url": {"url": req.image_data_url}},
                ],
            },
        ]
        wire = [m for m in wire if m]
        json_stream = _pick_json_stream(provider, multimodal=True)
    else:
        provider = get_chat_provider()
        wire = [
            {"role": "system", "content": spec.system_prompt},
            _window_hint(req.window_context),
            {"role": "user", "content": user_payload},
        ]
        wire = [m for m in wire if m]
        json_stream = _pick_json_stream(provider, multimodal=False)

    yield {
        "event": "meta",
        "data": json.dumps(
            {
                "provider": provider.name,
                "model": provider.model,
                "session_id": session_id,
            }
        ),
    }

    raw_chars: list[str] = []
    stream_error: str | None = None
    try:
        async for delta in json_stream(wire):  # type: ignore[misc]
            raw_chars.append(delta)
            # Emit lightweight progress so the thinking orb can tick along.
            yield {
                "event": "progress",
                "data": json.dumps({"chars": sum(len(c) for c in raw_chars)}),
            }
    except Exception as exc:  # noqa: BLE001
        logger.exception("artifact stream failed")
        stream_error = str(exc)

    # Mock provider emits prose/placeholder JSON — swap in the richer canned
    # artifact so the UI stays demoable offline.
    if getattr(provider, "name", "") == "mock":
        data = mock_artifact(chosen_action, req.text)
    else:
        raw = "".join(raw_chars)
        data = _parse_json(raw)
        if data is None:
            if stream_error:
                yield {
                    "event": "error",
                    "data": json.dumps({"message": stream_error}),
                }
                yield {"event": "done", "data": json.dumps({"session_id": session_id})}
                return
            data = {
                "kind": "generic",
                "action": chosen_action,
                "text": raw.strip(),
                "notes": ["Model did not return valid JSON; showing raw output."],
            }

    data.setdefault("kind", chosen_action)

    # Merge routing alternatives into the artifact's `suggested_alternatives`
    # so the UI can offer "try X instead" chips even in auto mode. The model's
    # own `suggested_action` (single, stronger) passes through untouched.
    if routed_alternatives and "suggested_alternatives" not in data:
        data["suggested_alternatives"] = [
            {
                "id": a.get("id"),
                "label": ACTIONS[a["id"]].label if a.get("id") in ACTIONS else a.get("id"),
                "reason": a.get("reason", ""),
            }
            for a in routed_alternatives
            if a.get("id") in ACTIONS
        ]

    _persist(session_id, req, data, provider=provider.name, model=provider.model)

    yield {
        "event": "artifact",
        "data": json.dumps(
            {
                "artifact": data,
                "meta": {
                    "provider": provider.name,
                    "model": provider.model,
                    "session_id": session_id,
                    "routed_action": chosen_action if req.action == "auto" else None,
                    "routed_reason": routed_reason,
                },
            }
        ),
    }
    yield {"event": "done", "data": json.dumps({"session_id": session_id})}


def _pick_json_stream(provider: Any, *, multimodal: bool):
    """Return the JSON-mode streamer if available, else the plain streamer.

    Live providers (xAI / OpenAI / mock) implement `chat_stream_json` /
    `chat_stream_multimodal_json` which force `response_format=json_object`.
    Any provider without those falls back to the prose-style streamer and
    we rely on the action system prompt + `_parse_json` fallbacks.
    """
    if multimodal:
        if hasattr(provider, "chat_stream_multimodal_json"):
            return provider.chat_stream_multimodal_json
        return provider.chat_stream_multimodal
    if hasattr(provider, "chat_stream_json"):
        return provider.chat_stream_json
    return provider.chat_stream


# --- helpers --------------------------------------------------------------


def _user_payload(text: str | None, extra: str | None, label: str) -> str:
    chunks: list[str] = [f"Action: {label}."]
    if extra and extra.strip():
        chunks.append(f"User instruction: {extra.strip()}")
    if text and text.strip():
        chunks.append("<captured>\n" + text.strip() + "\n</captured>")
    else:
        chunks.append("(No text — use the attached image as the context.)")
    return "\n\n".join(chunks)


def _window_hint(ctx: dict | None) -> dict | None:
    if not ctx:
        return None
    title = (ctx.get("title") or "").strip()
    url = (ctx.get("url") or "").strip()
    app = (ctx.get("appName") or "").strip()
    bits = [
        b
        for b in [
            app and f"app={app}",
            title and f'title="{title}"',
            url and f"url={url}",
        ]
        if b
    ]
    if not bits:
        return None
    return {"role": "system", "content": "User is viewing: " + ", ".join(bits)}


_JSON_FENCE = re.compile(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", re.IGNORECASE)


def _parse_json(raw: str) -> dict[str, Any] | None:
    if not raw:
        return None
    raw = raw.strip()
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass
    m = _JSON_FENCE.search(raw)
    if m:
        try:
            parsed = json.loads(m.group(1))
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            pass
    first = raw.find("{")
    last = raw.rfind("}")
    if first != -1 and last > first:
        candidate = raw[first : last + 1]
        try:
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def _persist(
    session_id: str,
    req: ArtifactRequest,
    data: dict,
    *,
    provider: str,
    model: str,
) -> None:
    try:
        preset_tag = f"artifact:{req.action}"
        store.append(
            session_id,
            Exchange(
                role="user",
                content=(req.text or "").strip() or f"[{req.action}] (image)",
                source=req.action,
                source_text=req.text,
                preset=preset_tag,
            ),
        )
        store.append(
            session_id,
            Exchange(
                role="assistant",
                content=json.dumps(data)[:8000],
                source=req.action,
                preset=preset_tag,
            ),
        )
    except KeyError:
        logger.debug("session vanished while persisting artifact")
