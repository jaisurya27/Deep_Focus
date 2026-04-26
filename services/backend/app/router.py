"""Action router for Glance.

Given captured text and/or an image, pick the *best* artifact action from the
catalog in `app.artifacts`. Always streams through a JSON-mode LLM call so the
output is parseable; mock mode uses a small heuristic so offline demos still
pick sensible actions.

The router returns:
    {
      "action": "<id from ACTIONS, or 'answer' for a plain prose response>",
      "alternatives": [{"id": "...", "reason": "..."}, ...],
      "reason": "short explanation"
    }
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from app.artifacts import ACTIONS
from app.providers import get_chat_provider, get_vision_provider

logger = logging.getLogger(__name__)


def _catalog_for_prompt(*, has_image: bool) -> list[dict]:
    """Actions the router is allowed to pick, filtered by available inputs.

    Image-only actions (needs_image=True) are dropped when no image is
    attached; text-only ones are dropped when only an image is present.
    """
    out: list[dict] = []
    for spec in ACTIONS.values():
        # `needs_context` is the "please capture a screenshot first" escape
        # hatch — only a legal router pick when nothing visual is attached.
        if spec.id == "needs_context" and has_image:
            continue
        if spec.needs_image and not has_image:
            continue
        out.append(
            {
                "id": spec.id,
                "category": spec.category,
                "label": spec.label,
                "blurb": spec.blurb,
            }
        )
    # "answer" is our conversational escape hatch — always available.
    out.append(
        {
            "id": "answer",
            "category": "understand",
            "label": "Answer",
            "blurb": "Free-form markdown answer when no specialized artifact fits.",
        }
    )
    return out


def _router_system_prompt(catalog: list[dict]) -> str:
    items = "\n".join(
        f"- {c['id']} ({c['category']}): {c['label']} — {c['blurb']}" for c in catalog
    )
    return (
        "You are Glance's router. The user has captured context from their "
        "screen (selected text and/or a screenshot). Your job is to pick the "
        "single best artifact action for the given context and user intent.\n\n"
        "Available actions:\n"
        f"{items}\n\n"
        "Rules:\n"
        "- If the captured content is clearly code, an error/trace, a chart, "
        "  a UI screenshot, an equation, a recipe/dish photo, a product, a "
        "  landmark, a to-do list, an email, or a diagram, pick the specialized "
        "  action. Be decisive when the signal is strong.\n"
        "- If the user is clearly asking about what's visible on their screen "
        "  (e.g. 'what am I looking at', 'describe my screen', 'read this for me') "
        "  AND no image is attached, pick `needs_context` so the client can "
        "  capture a screenshot and retry.\n"
        "- If nothing specialized fits, or the user is just having a "
        "  conversation, pick `answer` and produce prose.\n"
        "- `alternatives` should list up to 2 other plausible actions so the "
        "  UI can offer 'try this instead' chips.\n"
        "- Respect the user's explicit instruction if present; never override "
        "  a clear 'translate this' with something else.\n\n"
        "Respond with a SINGLE JSON object, no prose, no fences, shape:\n"
        '{"action":"<id>","alternatives":[{"id":"<id>","reason":"…"}],"reason":"<1 sentence>"}'
    )


async def route_action(
    *,
    text: str | None,
    has_image: bool,
    image_data_url: str | None,
    user_instruction: str | None,
    window_context: dict | None,
) -> dict[str, Any]:
    """Return `{action, alternatives, reason}` for the given context."""
    catalog = _catalog_for_prompt(has_image=has_image)
    sys_prompt = _router_system_prompt(catalog)

    user_chunks: list[str] = []
    if user_instruction and user_instruction.strip():
        user_chunks.append(f"User instruction: {user_instruction.strip()}")
    if text and text.strip():
        snippet = text.strip()
        # keep prompt lean; the router doesn't need a full novel
        if len(snippet) > 1600:
            snippet = snippet[:1600] + "…"
        user_chunks.append("<captured>\n" + snippet + "\n</captured>")
    elif has_image:
        user_chunks.append("(No captured text — route based on the attached image.)")
    else:
        user_chunks.append("(No captured context — the user is asking free-form.)")
    if window_context:
        title = (window_context.get("title") or "").strip()
        app = (window_context.get("appName") or "").strip()
        url = (window_context.get("url") or "").strip()
        ctx_bits = [b for b in [app and f"app={app}", title and f'title="{title}"', url and f"url={url}"] if b]
        if ctx_bits:
            user_chunks.append("Viewing: " + ", ".join(ctx_bits))

    user_payload = "\n\n".join(user_chunks)

    # Mock / heuristic path — also used as a fallback when the provider errors.
    async def _heuristic() -> dict[str, Any]:
        return _heuristic_route(
            text=text or "",
            has_image=has_image,
            user_instruction=user_instruction or "",
            window_context=window_context,
            allowed_ids={c["id"] for c in catalog},
        )

    if has_image:
        provider = get_vision_provider()
        streamer = getattr(provider, "chat_stream_multimodal_json", None)
        if provider.name == "mock" or streamer is None:
            return await _heuristic()
        wire = [
            {"role": "system", "content": sys_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_payload},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ]
    else:
        provider = get_chat_provider()
        streamer = getattr(provider, "chat_stream_json", None)
        if provider.name == "mock" or streamer is None:
            return await _heuristic()
        wire = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_payload},
        ]

    # Collect the JSON-mode stream with a small hard timeout; routing must
    # feel snappy so we don't wait forever for the model to decide.
    chunks: list[str] = []
    try:
        async def _collect() -> None:
            async for delta in streamer(wire):  # type: ignore[misc]
                chunks.append(delta)

        await asyncio.wait_for(_collect(), timeout=12.0)
    except Exception as exc:  # noqa: BLE001
        logger.warning("router stream failed, falling back to heuristic: %s", exc)
        return await _heuristic()

    raw = "".join(chunks).strip()
    parsed = _safe_json(raw)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("action"), str):
        return await _heuristic()
    chosen = parsed["action"].strip()
    allowed = {c["id"] for c in catalog}
    if chosen not in allowed:
        return await _heuristic()
    alts = parsed.get("alternatives") or []
    if not isinstance(alts, list):
        alts = []
    alts = [
        {"id": a.get("id"), "reason": a.get("reason", "")}
        for a in alts
        if isinstance(a, dict) and a.get("id") in allowed and a.get("id") != chosen
    ][:2]
    return {
        "action": chosen,
        "alternatives": alts,
        "reason": str(parsed.get("reason") or "").strip(),
    }


# ---------------------------------------------------------------------------
# Heuristic fallback


_CODE_RE = re.compile(
    r"(?:[{};]|=>|function\s|def\s|class\s|import\s|from\s+\w+\s+import|"
    r"#include|console\.|traceback|\berror:|"
    r"\bprint\(|\brange\(|\bfor\s+\w+\s+in\b|\breturn\s|"
    r"async\s+def|await\s+|yield\s+|struct\s+\w+\s*\{)",
    re.IGNORECASE,
)
_ERROR_RE = re.compile(r"\b(error|exception|traceback|failed|undefined is not)\b", re.I)
_MATH_RE = re.compile(r"(?:^|\s)(\d+[\s\-+*/^=]|solve|integrate|derivative|equation)", re.I)
_URL_RE = re.compile(r"\bhttps?://", re.I)
_NON_ENGLISH_RE = re.compile(
    r"[\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\u0600-\u06FF]"
)
_CODEY_APPS = re.compile(
    r"code|xcode|terminal|iterm|intellij|pycharm|webstorm|vim|nvim|sublime", re.I
)
# "what am I looking at", "describe my screen", "read this", "what's on the
# screen right now" — user is clearly asking about visible content but we
# don't have an image yet. The router emits `needs_context` so the client
# auto-captures a screenshot and retries.
_VISUAL_INTENT_RE = re.compile(
    r"\b("
    r"what\s+am\s+i\s+(looking|seeing|viewing)\s+at|"
    r"what'?s?\s+(on|in)\s+(my|the)\s+screen|"
    r"describe\s+(my|the|this)\s+(screen|window|page|tab|app)|"
    r"read\s+(my|the|this)\s+(screen|window)|"
    r"what\s+is\s+(this|that)\s+(showing|on\s+(my|the)\s+screen)|"
    r"summarize\s+(my|the|this)\s+(screen|window|page|tab)|"
    r"explain\s+(my|the|this)\s+(screen|window|page)|"
    r"help\s+me\s+with\s+(this|what'?s\s+on)"
    r")\b",
    re.I,
)


def _heuristic_route(
    *,
    text: str,
    has_image: bool,
    user_instruction: str,
    window_context: dict | None,
    allowed_ids: set[str],
) -> dict[str, Any]:
    instr = (user_instruction or "").lower()
    body = text or ""
    app = ((window_context or {}).get("appName") or "").lower()

    def pick(primary: str, alts: list[str], reason: str) -> dict[str, Any]:
        if primary not in allowed_ids:
            primary = "answer"
        return {
            "action": primary,
            "alternatives": [
                {"id": a, "reason": "Alternative view"} for a in alts if a in allowed_ids and a != primary
            ][:2],
            "reason": reason,
        }

    # If the user is asking about what's visible but we don't have any
    # image context yet, signal the client to capture a screenshot and
    # retry. The frontend auto-fulfills this and re-runs the same turn.
    if not has_image and _VISUAL_INTENT_RE.search(instr):
        return pick(
            "needs_context",
            ["answer"],
            "Asking about the screen — need a screenshot to answer.",
        )

    # Explicit user instruction wins.
    if "translate" in instr:
        return pick("translate", ["answer"], "User asked to translate.")
    if "rewrite" in instr or "rephrase" in instr:
        return pick("rewrite", ["answer"], "User asked to rewrite.")
    if "explain" in instr and (_CODE_RE.search(body) or _CODEY_APPS.search(app)):
        return pick("explain_code", ["diagnose_error", "fix_code"], "Explain-code intent.")
    if "fix" in instr and _CODE_RE.search(body):
        return pick("fix_code", ["explain_code", "diagnose_error"], "Fix-code intent.")
    if "solve" in instr:
        return pick("solve_math", ["answer"], "Solve intent.")
    if "reply" in instr or "respond" in instr:
        return pick("draft_reply", ["rewrite"], "Draft-reply intent.")

    if body:
        if _ERROR_RE.search(body):
            return pick("diagnose_error", ["fix_code", "explain_code"], "Looks like an error/trace.")
        if _CODE_RE.search(body) or _CODEY_APPS.search(app):
            return pick("explain_code", ["fix_code", "diagnose_error"], "Looks like source code.")
        if _MATH_RE.search(body):
            return pick("solve_math", ["answer"], "Looks like a math problem.")
        if _NON_ENGLISH_RE.search(body):
            return pick("translate", ["answer", "rewrite"], "Non-English text detected.")
        if _URL_RE.search(body):
            return pick("answer", ["product", "media_lookup"], "Text contains a link.")
        if len(body) > 280:
            return pick("answer", ["rewrite", "translate"], "Long passage — summarize/prose.")

    if has_image:
        # When there's no text and no instruction, use the window context
        # to make a smarter heuristic pick before the LLM router takes over.
        # This only matters in mock mode or as a fast-path before the vision
        # model responds; real providers will call the LLM router above.
        app_lc = ((window_context or {}).get("appName") or "").lower()
        title_lc = ((window_context or {}).get("title") or "").lower()
        _FOOD_APPS = re.compile(r"doordash|ubereats|uber\s*eats|grubhub|yelp|opentable|zomato|instacart", re.I)
        _FOOD_TITLE = re.compile(r"\b(recipe|restaurant|menu|food|eat|cook|dish|meal|dinner|lunch|breakfast|cafe|pizza|sushi|burger|ramen)\b", re.I)
        _PRODUCT_APPS = re.compile(r"amazon|walmart|shopify|ebay|etsy|bestbuy|target", re.I)
        _CODE_APPS_RE = re.compile(r"code|xcode|terminal|iterm|intellij|pycharm|webstorm|vim|nvim|sublime", re.I)
        _CHART_TITLE = re.compile(r"\b(chart|graph|analytics|dashboard|stats|metrics|data)\b", re.I)

        if _FOOD_APPS.search(app_lc) or _FOOD_TITLE.search(title_lc):
            return pick("food_order", ["recipe", "restaurant_booking"], "Food context detected.")
        if _PRODUCT_APPS.search(app_lc):
            return pick("product", ["shopping"], "Shopping context detected.")
        if _CODE_APPS_RE.search(app_lc):
            return pick("explain_code", ["fix_code", "diagnose_error"], "Code editor detected.")
        if _CHART_TITLE.search(title_lc):
            return pick("explain_chart", ["answer"], "Chart/data context detected.")

        return pick("identify", ["critique_ui", "explain_chart"], "Image-only context.")

    return pick("answer", [], "Fallback — free-form answer.")


_JSON_FENCE = re.compile(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", re.IGNORECASE)


def _safe_json(raw: str) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    m = _JSON_FENCE.search(raw)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    first = raw.find("{")
    last = raw.rfind("}")
    if first != -1 and last > first:
        try:
            return json.loads(raw[first : last + 1])
        except json.JSONDecodeError:
            return None
    return None
