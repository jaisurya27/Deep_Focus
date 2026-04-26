"""Artifact taxonomy for Glance.

Each *action* (translate, solve_math, recipe, draft_reply, …) maps to:
  • a short human label + category (Understand / Act / Discover / Create / Connect)
  • a system prompt that instructs the LLM to emit strict JSON matching the schema
  • the expected top-level JSON keys (enforced softly — renderers handle extras)
  • a mock builder for offline demos

The runtime route (`/artifact`) dispatches by action id, sends the appropriate
system prompt to chat or vision, parses the JSON, and returns
`{kind, data, meta}` back to the renderer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


Category = str  # "understand" | "act" | "discover" | "create" | "connect"


@dataclass
class ActionSpec:
    id: str
    category: Category
    label: str
    blurb: str
    system_prompt: str
    needs_text: bool = True
    needs_image: bool = False
    accepts_image: bool = True  # if True and image is attached we route vision
    mock: Callable[[str | None], dict] = field(default=lambda _: {})


def _json_contract(shape_doc: str) -> str:
    return (
        "You are Glance, a concise on-screen copilot. The user has captured "
        "context (selected text and/or a screenshot region). Respond with a "
        "SINGLE JSON object, no prose before or after, no code fences. "
        "The JSON MUST follow this shape (extra keys are ignored):\n"
        f"{shape_doc}\n"
        "If a field does not apply, use null or an empty array. Keep strings "
        "tight — bullets ≤ 140 chars. Never invent facts; say so in a `notes` "
        "array if you're uncertain.\n\n"
        "If the captured content is a MUCH better fit for a different action "
        "from this catalog — translate, solve_math, explain_code, fix_code, "
        "diagnose_error, explain_chart, critique_ui, identify, rewrite, "
        "tasks_to_calendar, draft_reply, diagram_to_mermaid, recipe, product, "
        "media_lookup, travel, answer — ALSO include at the top level:\n"
        '"suggested_action": {"id": "<action id>", "reason": "one short sentence"}\n'
        "Only include it when the mismatch is obvious; otherwise omit the field."
    )


# --- Specs ----------------------------------------------------------------


ACTIONS: dict[str, ActionSpec] = {
    # --- Conversational fallback -----------------------------------------
    "answer": ActionSpec(
        id="answer",
        category="understand",
        label="Answer",
        blurb="A free-form markdown answer when no specialized artifact fits.",
        needs_text=False,
        system_prompt=_json_contract(
            """{
  "kind": "answer",
  "title": "short title (≤ 6 words) — optional",
  "body": "markdown answer — use headings/bullets/code as appropriate",
  "followups": ["optional follow-up question the user might ask"]
}"""
        ),
        mock=lambda t: {
            "kind": "answer",
            "title": "Mock answer",
            "body": (
                "**Mock mode — no API key.**\n\nHere's a placeholder answer to: "
                + (t or "(nothing)")
            ),
            "followups": ["Tell me more.", "Summarize in one line."],
        },
    ),
    # --- Understand -------------------------------------------------------
    "translate": ActionSpec(
        id="translate",
        category="understand",
        label="Translate",
        blurb="Detect language + translate to English (or a requested target).",
        system_prompt=_json_contract(
            """{
  "kind": "translate",
  "detected_lang": "ISO code or name",
  "target_lang": "en (unless the user asked for another)",
  "original": "the source text, cleaned",
  "translation": "the translation",
  "notes": ["idiomatic nuances, if any"]
}"""
        ),
        mock=lambda t: {
            "kind": "translate",
            "detected_lang": "auto",
            "target_lang": "en",
            "original": t or "(captured text)",
            "translation": "[mock] An English rendering of the captured text.",
            "notes": ["Mock mode — add XAI_API_KEY for real translation."],
        },
    ),
    "solve_math": ActionSpec(
        id="solve_math",
        category="understand",
        label="Solve math",
        blurb="Solve an equation or word problem with steps.",
        system_prompt=_json_contract(
            """{
  "kind": "solve_math",
  "problem": "what we're solving (LaTeX ok)",
  "answer": "final answer (short)",
  "latex": "optional LaTeX of the answer",
  "steps": ["step 1", "step 2", "…"],
  "notes": []
}"""
        ),
        mock=lambda t: {
            "kind": "solve_math",
            "problem": t or "2x + 4 = 10",
            "answer": "x = 3",
            "steps": [
                "Subtract 4 from both sides: 2x = 6.",
                "Divide by 2: x = 3.",
            ],
            "notes": ["Mock mode."],
        },
    ),
    "explain_code": ActionSpec(
        id="explain_code",
        category="understand",
        label="Explain code",
        blurb="Summarize what a snippet does, flag risks.",
        system_prompt=_json_contract(
            """{
  "kind": "explain_code",
  "language": "best guess",
  "summary": "one sentence",
  "walkthrough": ["key step", "key step"],
  "risks": ["bugs or smells, if any"],
  "complexity": "optional big-O hint"
}"""
        ),
        mock=lambda t: {
            "kind": "explain_code",
            "language": "unknown",
            "summary": "[mock] Walks a list and returns the count of positives.",
            "walkthrough": ["Initialize a counter.", "Loop, increment on predicate.", "Return the counter."],
            "risks": ["Edge case: empty input."],
            "complexity": "O(n)",
        },
    ),
    "fix_code": ActionSpec(
        id="fix_code",
        category="act",
        label="Fix code",
        blurb="Return a corrected snippet plus a short rationale.",
        system_prompt=_json_contract(
            """{
  "kind": "fix_code",
  "language": "best guess",
  "diagnosis": "what's wrong, in one sentence",
  "original": "the broken snippet as provided",
  "fixed": "the corrected snippet, complete and runnable",
  "changes": ["bullet each substantive change"]
}"""
        ),
        mock=lambda t: {
            "kind": "fix_code",
            "language": "python",
            "diagnosis": "[mock] Off-by-one in the loop bound.",
            "original": t or "for i in range(len(xs) - 1): use(xs[i])",
            "fixed": "for i in range(len(xs)): use(xs[i])",
            "changes": ["Inclusive upper bound."],
        },
    ),
    "diagnose_error": ActionSpec(
        id="diagnose_error",
        category="understand",
        label="Diagnose error",
        blurb="Parse an error/trace and propose fix steps.",
        system_prompt=_json_contract(
            """{
  "kind": "diagnose_error",
  "error": "the error as captured",
  "likely_cause": "most probable root cause",
  "fix_steps": ["actionable step", "…"],
  "snippets": [{"label": "optional", "code": "optional"}]
}"""
        ),
        mock=lambda t: {
            "kind": "diagnose_error",
            "error": t or "TypeError: 'NoneType' has no attribute 'x'",
            "likely_cause": "[mock] You're dereferencing a value that wasn't returned.",
            "fix_steps": ["Check the return path.", "Add a guard.", "Unit-test the edge case."],
        },
    ),
    "explain_chart": ActionSpec(
        id="explain_chart",
        category="understand",
        label="Explain chart",
        blurb="Summarize a chart or graph and flag what's notable.",
        needs_text=False,
        needs_image=True,
        system_prompt=_json_contract(
            """{
  "kind": "explain_chart",
  "headline": "the story in one sentence",
  "key_points": ["bullet", "bullet"],
  "caveats": ["any caveats about axes/scale"]
}"""
        ),
        mock=lambda _t: {
            "kind": "explain_chart",
            "headline": "[mock] Revenue climbs steadily through Q3.",
            "key_points": ["Q3 up 22% YoY", "Margins flat"],
            "caveats": ["Y-axis doesn't start at zero."],
        },
    ),
    "critique_ui": ActionSpec(
        id="critique_ui",
        category="understand",
        label="Critique UI",
        blurb="Strengths, issues, and suggestions for a UI/UX screenshot.",
        needs_text=False,
        needs_image=True,
        system_prompt=_json_contract(
            """{
  "kind": "critique_ui",
  "strengths": ["bullet"],
  "issues": ["bullet"],
  "suggestions": ["bullet"]
}"""
        ),
        mock=lambda _t: {
            "kind": "critique_ui",
            "strengths": ["Clear hierarchy.", "Readable type."],
            "issues": ["Primary CTA is low-contrast.", "Touch targets under 44px."],
            "suggestions": ["Darken CTA to WCAG AA.", "Bump tap targets."],
        },
    ),
    "identify": ActionSpec(
        id="identify",
        category="discover",
        label="Identify",
        blurb="Name + quick facts for a person, landmark, plant, animal, logo, or product.",
        needs_text=False,
        needs_image=True,
        system_prompt=_json_contract(
            """{
  "kind": "identify",
  "name": "best guess",
  "category": "person | landmark | plant | animal | logo | product | other",
  "confidence": "low | medium | high",
  "facts": ["bullet", "bullet"],
  "links": [{"label": "Wikipedia", "query": "search query"}]
}"""
        ),
        mock=lambda _t: {
            "kind": "identify",
            "name": "[mock] Unknown subject",
            "category": "other",
            "confidence": "low",
            "facts": ["Mock mode — add vision credentials for real identification."],
            "links": [{"label": "Google", "query": "captured image"}],
        },
    ),
    # --- Act --------------------------------------------------------------
    "rewrite": ActionSpec(
        id="rewrite",
        category="act",
        label="Rewrite",
        blurb="Generate formal / casual / shorter / friendlier variants.",
        system_prompt=_json_contract(
            """{
  "kind": "rewrite",
  "original": "source text",
  "variants": [
    {"tone": "formal", "text": "…"},
    {"tone": "casual", "text": "…"},
    {"tone": "shorter", "text": "…"},
    {"tone": "friendlier", "text": "…"}
  ]
}"""
        ),
        mock=lambda t: {
            "kind": "rewrite",
            "original": t or "",
            "variants": [
                {"tone": "formal", "text": "[mock] A formal rewrite."},
                {"tone": "casual", "text": "[mock] A casual rewrite."},
                {"tone": "shorter", "text": "[mock] Terser."},
                {"tone": "friendlier", "text": "[mock] Warmer."},
            ],
        },
    ),
    "tasks_to_calendar": ActionSpec(
        id="tasks_to_calendar",
        category="act",
        label="To-dos → Calendar",
        blurb="Turn a checklist into calendar-ready events.",
        system_prompt=_json_contract(
            """{
  "kind": "tasks_to_calendar",
  "events": [
    {
      "title": "short actionable title",
      "when": "ISO-ish datetime or 'tomorrow 9am' if unclear",
      "duration_min": 30,
      "notes": "optional"
    }
  ]
}"""
        ),
        mock=lambda t: {
            "kind": "tasks_to_calendar",
            "events": [
                {"title": "Draft demo script", "when": "today 7pm", "duration_min": 45},
                {"title": "Record run-through", "when": "tomorrow 10am", "duration_min": 30},
            ],
        },
    ),
    "draft_reply": ActionSpec(
        id="draft_reply",
        category="act",
        label="Draft reply",
        blurb="Write a reply to an email / message you've captured.",
        system_prompt=_json_contract(
            """{
  "kind": "draft_reply",
  "subject": "optional subject line",
  "body": "the reply (2–6 short paragraphs)",
  "tone": "the tone used"
}"""
        ),
        mock=lambda t: {
            "kind": "draft_reply",
            "subject": "Re: [mock]",
            "body": "Hi there,\n\nThanks for the note — I'll take a look and get back to you by end of day.\n\nBest,",
            "tone": "warm-professional",
        },
    ),
    "diagram_to_mermaid": ActionSpec(
        id="diagram_to_mermaid",
        category="act",
        label="Diagram → Mermaid",
        blurb="Convert a captured diagram into editable Mermaid.",
        needs_text=False,
        needs_image=True,
        system_prompt=_json_contract(
            """{
  "kind": "diagram_to_mermaid",
  "mermaid": "full mermaid source, e.g. flowchart LR\\nA-->B",
  "notes": ["ambiguity you had to resolve"]
}"""
        ),
        mock=lambda _t: {
            "kind": "diagram_to_mermaid",
            "mermaid": "flowchart LR\n  A[Capture] --> B{Action?}\n  B --> C[Understand]\n  B --> D[Act]",
            "notes": ["Mock mode."],
        },
    ),
    # --- Discover ---------------------------------------------------------
    "recipe": ActionSpec(
        id="recipe",
        category="discover",
        label="Recipe",
        blurb="Dish name, ingredients, steps, plus a search to find it near you.",
        needs_text=False,
        needs_image=True,
        system_prompt=_json_contract(
            """{
  "kind": "recipe",
  "dish": "name",
  "cuisine": "optional",
  "ingredients": ["item with qty"],
  "steps": ["step", "step"],
  "time_min": 30,
  "where_to_buy_query": "google maps query for nearest vendor"
}"""
        ),
        mock=lambda _t: {
            "kind": "recipe",
            "dish": "[mock] Salmon nigiri",
            "cuisine": "Japanese",
            "ingredients": ["Sushi rice 200g", "Salmon sashimi 150g", "Rice vinegar 1 tbsp", "Wasabi"],
            "steps": ["Cook and season rice.", "Slice salmon.", "Form ovals, top with fish."],
            "time_min": 25,
            "where_to_buy_query": "best sushi near me",
        },
    ),
    "product": ActionSpec(
        id="product",
        category="discover",
        label="Product lookup",
        blurb="Summary + rough price range + Reddit-style review bullets.",
        system_prompt=_json_contract(
            """{
  "kind": "product",
  "name": "product name",
  "summary": "one-sentence value prop",
  "price_range": "e.g. $120–$160 USD",
  "review_bullets": ["what people like", "what people complain about"],
  "search_queries": [
    {"label": "Price compare", "query": "…"},
    {"label": "Reddit reviews", "query": "site:reddit.com …"}
  ]
}"""
        ),
        mock=lambda t: {
            "kind": "product",
            "name": t or "[mock] Unknown product",
            "summary": "A capable widget in a crowded category.",
            "price_range": "$40–$80",
            "review_bullets": ["Build quality praised.", "Battery life criticized."],
            "search_queries": [
                {"label": "Price compare", "query": (t or "product") + " price"},
                {"label": "Reddit reviews", "query": "site:reddit.com " + (t or "product")},
            ],
        },
    ),
    "media_lookup": ActionSpec(
        id="media_lookup",
        category="discover",
        label="Media lookup",
        blurb="Movie/book: summary, cast/authors, where to watch/read.",
        system_prompt=_json_contract(
            """{
  "kind": "media_lookup",
  "title": "",
  "type": "movie | book | show | album | other",
  "summary": "one paragraph",
  "cast_or_authors": ["name"],
  "where_to_find": [{"label": "Netflix", "query": "search url hint"}]
}"""
        ),
        mock=lambda t: {
            "kind": "media_lookup",
            "title": t or "[mock] Title",
            "type": "movie",
            "summary": "A moody indie about X, Y, and Z.",
            "cast_or_authors": ["A. Actor", "B. Actor"],
            "where_to_find": [{"label": "JustWatch", "query": t or "title"}],
        },
    ),
    "travel": ActionSpec(
        id="travel",
        category="discover",
        label="Travel / landmark",
        blurb="History + map pin for a building or landmark.",
        system_prompt=_json_contract(
            """{
  "kind": "travel",
  "name": "",
  "history": "2–4 sentences",
  "map_query": "google maps query"
}"""
        ),
        mock=lambda t: {
            "kind": "travel",
            "name": t or "[mock] Landmark",
            "history": "Built in the 19th century…",
            "map_query": t or "landmark near me",
        },
    ),
}


# Alias set the frontend uses to show category-grouped chips.
CATEGORY_ORDER = ["understand", "act", "discover", "create", "connect"]


def list_actions() -> list[dict]:
    """Compact summary used by the frontend to render the action bar."""
    out: list[dict] = []
    for spec in ACTIONS.values():
        out.append(
            {
                "id": spec.id,
                "category": spec.category,
                "label": spec.label,
                "blurb": spec.blurb,
                "needs_text": spec.needs_text,
                "needs_image": spec.needs_image,
            }
        )
    return out


def mock_artifact(action: str, text: str | None) -> dict:
    spec = ACTIONS.get(action)
    if not spec:
        return {
            "kind": action,
            "notes": [f"Unknown action '{action}' — mock generic artifact."],
        }
    return spec.mock(text)
