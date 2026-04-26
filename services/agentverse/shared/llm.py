"""Async LLM helpers shared by all Glance Agentverse agents."""
from __future__ import annotations

import json
import os

from openai import AsyncOpenAI


def _get_llm_settings() -> tuple[str, str, str]:
    """Return (api_key, base_url, model) based on available env vars."""
    xai_key = os.getenv("XAI_API_KEY", "")
    openai_key = os.getenv("OPENAI_API_KEY", "")

    if openai_key:
        return (
            openai_key,
            "https://api.openai.com/v1",
            os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        )
    if xai_key:
        return (
            xai_key,
            "https://api.x.ai/v1",
            os.getenv("XAI_MODEL", "grok-3-fast"),
        )
    raise RuntimeError(
        "No LLM API key found. Set OPENAI_API_KEY or XAI_API_KEY in .env"
    )


async def call_artifact_llm(system_prompt: str, user_text: str) -> dict:
    """Call the LLM with JSON-mode and return parsed dict."""
    api_key, base_url, model = _get_llm_settings()
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        response_format={"type": "json_object"},
        max_tokens=1024,
    )
    raw = response.choices[0].message.content or "{}"
    # Strip accidental code fences if the model ignores the instruction
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw)


async def classify_intent(text: str) -> str:
    """Classify user text into: code | food | book | direct."""
    classify_system = (
        "You are a routing assistant. Classify the user's request into exactly "
        "one of these four categories:\n"
        "- code: debugging, fixing bugs, explaining code, any programming question\n"
        "- food: recipes, cooking, ordering food, food delivery, what to eat\n"
        "- book: booking or reserving a table at a specific restaurant\n"
        "- direct: everything else\n\n"
        "Respond with ONLY the single category word. Nothing else."
    )
    # Keyword heuristic first (fast, free)
    lower = text.lower()
    if any(w in lower for w in ("book", "reservation", "reserve", "table for")):
        return "book"
    if any(w in lower for w in ("bug", "error", "fix", "def ", "function", "class ", "import ", "traceback", "exception")):
        return "code"
    if any(w in lower for w in ("recipe", "cook", "ingredient", "doordash", "uber eats", "order food", "delivery")):
        return "food"

    # Fallback to LLM
    try:
        api_key, base_url, model = _get_llm_settings()
        client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        r = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": classify_system},
                {"role": "user", "content": text},
            ],
            max_tokens=5,
        )
        intent = r.choices[0].message.content.strip().lower()
        return intent if intent in ("code", "food", "book", "direct") else "direct"
    except Exception:
        return "direct"
