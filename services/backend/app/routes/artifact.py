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

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.artifacts import ACTIONS, list_actions, mock_artifact
from app.config import settings
from app.providers import get_chat_provider, get_image_provider, get_vision_provider
from app.router import route_action
from app.store.memory import Exchange, store

# Actions routed through the Fetch.ai Agentverse bridge instead of the
# local LLM. When the bridge is unreachable the stream falls back gracefully.
_AGENTVERSE_ACTIONS = {"fix_code", "food_order", "restaurant_booking",
                       "price_comparison", "price_monitor", "debate"}

logger = logging.getLogger(__name__)

router = APIRouter(tags=["artifact"])

# How many prior user/assistant exchanges we replay as context on follow-ups.
# Matches `/chat` so the two pipelines feel coherent. "Lazy context" means we
# trust the existing session to thread history through; it does NOT mean no
# context. Without this replay the model forgets the last turn entirely and
# follow-up questions read as cold-start asks.
MAX_CONTEXT_EXCHANGES = 16
# Per-message hard cap when replaying. Raised from 1800 — recipes, code fixes,
# and rich artifact bodies need more room so follow-ups don't lose context.
REPLAY_CHAR_CAP = 4000


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
            history=_history_wire(session_id),
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

    # `needs_context` is the "please capture a screenshot first" escape
    # hatch. We don't call any model for it — just emit a deterministic
    # JSON artifact that the frontend knows how to auto-fulfill (capture
    # the declared signal, then resubmit the same instruction).
    if chosen_action == "needs_context":
        provider_name, provider_model = _stub_provider_name()
        yield {
            "event": "meta",
            "data": json.dumps(
                {
                    "provider": provider_name,
                    "model": provider_model,
                    "session_id": session_id,
                }
            ),
        }
        needs_data = {
            "kind": "needs_context",
            "needs": ["screenshot"],
            "reason": routed_reason
            or "Need a screenshot to see what you're looking at.",
            "retry_instruction": (req.user_instruction or "").strip() or None,
        }
        yield {
            "event": "artifact",
            "data": json.dumps(
                {
                    "artifact": needs_data,
                    "meta": {
                        "provider": provider_name,
                        "model": provider_model,
                        "session_id": session_id,
                        "routed_action": "needs_context",
                        "routed_reason": routed_reason,
                    },
                }
            ),
        }
        yield {"event": "done", "data": json.dumps({"session_id": session_id})}
        return

    spec = ACTIONS[chosen_action]
    user_payload = _user_payload(req.text, req.user_instruction, spec.label, has_image=has_image)

    # Delegate Agentverse-integrated actions to the bridge (port 8020).
    # Skip delegation in mock mode so offline demos still work end-to-end.
    if chosen_action in _AGENTVERSE_ACTIONS:
        try:
            p = get_chat_provider()
            is_mock = getattr(p, "name", "") == "mock"
        except Exception:
            is_mock = False
        if not is_mock:
            async for evt in _agentverse_stream(req, session_id, chosen_action, user_payload):
                yield evt
            return

    # Replay prior turns so follow-ups ("what about option 2?") resolve
    # against what the assistant just said. Artifact responses persisted by
    # `_persist` below are raw JSON; we condense them before wiring them
    # back in so the context stays readable instead of a wall of braces.
    history = _history_wire(session_id)

    # Select provider + build wire payload.
    if has_image:
        provider = get_vision_provider()
        wire = [
            {"role": "system", "content": spec.system_prompt},
            _window_hint(req.window_context),
            *history,
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
            *history,
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

    # Two-step image generation: the first LLM call produced a refined prompt;
    # now call the image provider to turn that prompt into an actual image.
    if data.get("kind") == "generate_image" and data.get("prompt"):
        img_prompt = data["prompt"]
        try:
            img_provider = get_image_provider()
            if img_provider.name != "mock":
                yield {
                    "event": "progress",
                    "data": json.dumps({"chars": -1, "status": "Generating image…"}),
                }
                img_result = await img_provider.generate(img_prompt)
                data["data_url"] = img_result.get("data_url") or img_result.get("url")
                data["image_provider"] = img_result.get("provider", img_provider.name)
                data["image_model"] = img_result.get("model", img_provider.model)
        except Exception as exc:  # noqa: BLE001
            logger.warning("image generation failed: %s", exc)
            data["error"] = f"Image generation failed: {exc}"

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


def _history_digest(session_id: str, max_chars: int = 1200) -> str:
    """One-paragraph prose summary of the last few turns for agentverse context."""
    history = _history_wire(session_id)
    if not history:
        return ""
    lines: list[str] = []
    budget = max_chars
    for m in reversed(history):
        role = "User" if m["role"] == "user" else "Assistant"
        snippet = (m.get("content") or "").strip()
        if not snippet:
            continue
        if len(snippet) > 400:
            snippet = snippet[:400].rstrip() + "…"
        line = f"{role}: {snippet}"
        budget -= len(line)
        if budget < 0:
            break
        lines.append(line)
    if not lines:
        return ""
    return "Prior conversation (most recent last):\n" + "\n".join(reversed(lines))


async def _agentverse_stream(
    req: ArtifactRequest,
    session_id: str,
    action: str,
    user_payload: str,
) -> AsyncIterator[dict[str, Any]]:
    """Delegate action to the Fetch.ai Agentverse bridge and wrap as SSE."""
    yield {
        "event": "meta",
        "data": json.dumps(
            {"provider": "fetch_ai", "model": "agentverse", "session_id": session_id}
        ),
    }

    bridge = settings.agentverse_bridge_url
    _BRIDGE_NOT_RUNNING = (
        "Agentverse bridge is not running. "
        "Start it with: cd services/agentverse && .venv/bin/python run_all.py"
    )

    # Send the raw query to the bridge — NOT the formatted user_payload which
    # contains "Action: X. User instruction: ... (No text — use attached image)"
    # preamble that confuses the bridge LLMs. Preference order:
    #   1. captured text (e.g. product name recovered from prior identify artifact)
    #   2. free-form user instruction
    #   3. formatted payload as last resort
    raw_query = (req.text or "").strip() or (req.user_instruction or "").strip() or user_payload

    # History digest as separate context so it's available for follow-ups
    # but never surfaces in display fields (product name, topic, etc.).
    digest = _history_digest(session_id)

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            if action == "price_comparison":
                r = await client.post(
                    f"{bridge}/price_compare",
                    json={"action": action, "text": raw_query, "context": digest},
                )
            elif action == "debate":
                r = await client.post(
                    f"{bridge}/debate",
                    json={"text": raw_query, "context": digest},
                )
            elif action == "price_monitor":
                product, target = _parse_monitor_request(raw_query)
                r = await client.post(
                    f"{bridge}/price_monitor",
                    json={"text": raw_query, "product": product, "target_price": target, "context": digest},
                )
            else:
                r = await client.post(
                    f"{bridge}/agent",
                    json={"action": action, "text": raw_query, "context": digest},
                )
            r.raise_for_status()
            body = r.json()

        data: dict[str, Any] = body.get("artifact") or {}
        data.setdefault("kind", action)
        # Carry through parallel timing for the demo badge
        if body.get("elapsed_ms"):
            data["fetch_parallel_ms"] = body["elapsed_ms"]

    except httpx.ConnectError:
        yield {"event": "error", "data": json.dumps({"message": _BRIDGE_NOT_RUNNING})}
        yield {"event": "done", "data": json.dumps({"session_id": session_id})}
        return
    except Exception as exc:
        logger.exception("Agentverse bridge call failed")
        yield {"event": "error", "data": json.dumps({"message": str(exc)})}
        yield {"event": "done", "data": json.dumps({"session_id": session_id})}
        return

    _persist(session_id, req, data, provider="fetch_ai", model="agentverse")
    yield {
        "event": "artifact",
        "data": json.dumps(
            {
                "artifact": data,
                "meta": {
                    "provider": "fetch_ai",
                    "model": "agentverse",
                    "session_id": session_id,
                    "via": "fetch_ai_agentverse",
                },
            }
        ),
    }
    yield {"event": "done", "data": json.dumps({"session_id": session_id})}


import re as _re

def _parse_monitor_request(text: str) -> tuple[str, float]:
    """Extract product name and target price from user instruction."""
    below = _re.search(
        r"\b(?:below|under|less than|<)\s*\$?\s*(\d[\d,]*(?:\.\d{1,2})?)", text, _re.I
    )
    target = 0.0
    if below:
        try:
            target = float(below.group(1).replace(",", ""))
        except ValueError:
            pass
    product = _re.sub(
        r"\b(?:monitor|watch|track|alert|notify|when|below|under|less than|price|for me|me)\b",
        "", text, flags=_re.I,
    )
    product = _re.sub(r"\$[\d,]+(?:\.\d{1,2})?", "", product).strip().strip("., ") or text.strip()
    return product, target


def _stub_provider_name() -> tuple[str, str]:
    """Provider label used on synthetic artifacts (needs_context).

    We route through whatever chat provider is configured so the UI's
    provider badge stays coherent, but without making an API call.
    """
    try:
        p = get_chat_provider()
        return p.name, p.model
    except Exception:  # noqa: BLE001
        return "local", "router"


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


def _user_payload(
    text: str | None, extra: str | None, label: str, *, has_image: bool = False
) -> str:
    chunks: list[str] = [f"Action: {label}."]
    if extra and extra.strip():
        chunks.append(f"User instruction: {extra.strip()}")
    if text and text.strip():
        chunks.append("<captured>\n" + text.strip() + "\n</captured>")
    elif has_image:
        chunks.append("(No text — use the attached image as the context.)")
    # On pure follow-ups (no text, no image) we omit both — the history
    # replay already gives the model the prior artifact as context.
    return "\n\n".join(chunks)


def _history_wire(session_id: str) -> list[dict[str, Any]]:
    """Replay the last few user/assistant turns for follow-up coherence.

    Assistant turns from `/artifact` are stored as the full artifact JSON.
    We condense them to a short natural-language digest here so the model
    sees "what it said last time" without being re-primed to emit the same
    structure verbatim (which confused JSON-mode on the next turn).
    """
    session = store.get(session_id)
    if session is None or not session.messages:
        return []
    out: list[dict[str, Any]] = []
    for m in session.messages[-MAX_CONTEXT_EXCHANGES:]:
        if m.role not in ("user", "assistant"):
            continue
        content = m.content or ""
        if m.role == "assistant":
            content = _condense_assistant(content)
        if not content:
            continue
        if len(content) > REPLAY_CHAR_CAP:
            content = content[:REPLAY_CHAR_CAP].rstrip() + "…"
        out.append({"role": m.role, "content": content})
    return out


def _condense_assistant(content: str) -> str:
    """Turn a stored artifact JSON blob into a short prose digest."""
    s = (content or "").strip()
    if not s:
        return ""
    if not s.startswith("{"):
        return s
    try:
        data = json.loads(s)
    except json.JSONDecodeError:
        return s
    if not isinstance(data, dict):
        return s
    # Prefer the fields most likely to carry the user-visible answer.
    # "prompt" covers generate_image artifacts; "title" covers recipe/food.
    for key in ("body", "answer", "text", "summary", "explanation", "translation", "prompt", "title", "name", "product_name"):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            kind = data.get("kind") or data.get("action") or "artifact"
            return f"[{kind}] {val.strip()}"
    # Fallback: serialize the whole dict minus noisy/large keys so the
    # downstream model still sees the gist.
    trimmed = {
        k: v
        for k, v in data.items()
        if k not in ("suggested_alternatives", "suggested_action", "followups")
    }
    try:
        return json.dumps(trimmed, ensure_ascii=False)
    except (TypeError, ValueError):
        return s


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
        # Strip large binary fields before persisting — data_url is a huge
        # base64 blob that would crowd out the prompt and artifact text from
        # the 8 kB history replay window, breaking follow-up context.
        storable = {k: v for k, v in data.items() if k not in ("data_url",)}
        store.append(
            session_id,
            Exchange(
                role="assistant",
                content=json.dumps(storable)[:8000],
                source=req.action,
                preset=preset_tag,
            ),
        )
    except KeyError:
        logger.debug("session vanished while persisting artifact")
