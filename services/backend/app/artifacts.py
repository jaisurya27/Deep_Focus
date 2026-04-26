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
        "diagnose_error, explain_chart, identify, rewrite, "
        "tasks_to_calendar, draft_reply, diagram_to_mermaid, recipe, product, "
        "media_lookup, travel, answer, map, shopping, food_order, weather, "
        "restaurant_booking, flight_track, email_compose, job_apply, "
        "grocery_list — ALSO include at the top level:\n"
        '"suggested_action": {"id": "<action id>", "reason": "one short sentence"}\n'
        "Only include it when the mismatch is obvious; otherwise omit the field."
    )


# --- Specs ----------------------------------------------------------------


ACTIONS: dict[str, ActionSpec] = {
    # --- Smart-context escape hatch --------------------------------------
    #
    # Not a real user-facing artifact: emitted when we realize the model
    # can't answer without more signal (typically a screenshot). The
    # frontend auto-fulfills the declared `needs` and re-runs the same
    # instruction, so this produces a seamless "oh wait, let me look at
    # your screen" loop instead of a confused "I can't see your screen"
    # answer. The artifact route short-circuits for this action — no LLM
    # call, just a deterministic JSON payload.
    "needs_context": ActionSpec(
        id="needs_context",
        category="understand",
        label="Needs context",
        blurb=(
            "The user asked about something visual/contextual on their "
            "screen but didn't attach an image. Frontend should capture "
            "the declared signal and retry."
        ),
        needs_text=False,
        accepts_image=False,
        system_prompt="",  # never used — route short-circuits
        mock=lambda t: {
            "kind": "needs_context",
            "needs": ["screenshot"],
            "reason": "Looks like a question about on-screen content.",
            "retry_instruction": (t or "").strip() or None,
        },
    ),
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
        blurb="Rewrite the captured text in a single chosen tone.",
        system_prompt=_json_contract(
            """Rewrite the captured text in the SINGLE tone the user asked for
(look at the user instruction — e.g. "formal", "casual", "shorter",
"friendlier", "simpler", "more concise"). Default to "neutral" if no
explicit tone is given. Return ONE rewrite only — never multiple
variants. Preserve meaning; do not add new claims.

Shape:
{
  "kind": "rewrite",
  "original": "source text (verbatim, may be truncated)",
  "tone": "the tone you used (one word, lowercase)",
  "text": "the rewritten passage"
}"""
        ),
        mock=lambda t: {
            "kind": "rewrite",
            "original": t or "",
            "tone": "neutral",
            "text": "[mock] A neutral rewrite of the captured passage.",
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
  "mermaid": "full valid mermaid source — wrap any label that contains parentheses, slashes, or special chars in double-quotes, e.g. A[\"Oxaloacetate (4C)\"] --> B[\"Citrate (6C)\"]",
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
    # --- Discover (new) ---------------------------------------------------
    "map": ActionSpec(
        id="map",
        category="discover",
        label="Map",
        blurb="Show a location, directions, or address on a map.",
        needs_text=False,
        system_prompt=_json_contract(
            """{
  "kind": "map",
  "title": "Place or location name",
  "address": "Full address if known, else null",
  "description": "1–2 sentences about the place",
  "map_query": "Google Maps search query",
  "directions_from": null,
  "place_type": "restaurant | landmark | store | address | other",
  "links": [{"label": "Street View", "query": "search query"}]
}"""
        ),
        mock=lambda t: {
            "kind": "map",
            "title": t or "[mock] Eiffel Tower",
            "address": "Champ de Mars, 5 Av. Anatole France, 75007 Paris, France",
            "description": "Iconic iron lattice tower on the Champ de Mars in Paris, France.",
            "map_query": t or "Eiffel Tower Paris",
            "directions_from": None,
            "place_type": "landmark",
            "links": [{"label": "Street View", "query": "Eiffel Tower Paris street view"}],
        },
    ),
    "shopping": ActionSpec(
        id="shopping",
        category="discover",
        label="Shop",
        blurb="Find a product with prices and buy links for Amazon, Walmart, and more.",
        system_prompt=_json_contract(
            """{
  "kind": "shopping",
  "product_name": "Product name",
  "description": "One-sentence description",
  "price_range": "$XX–$XX USD",
  "image_search": "Image search query for the product",
  "items": [
    {
      "retailer": "Amazon",
      "price": "$XX.XX or null if unknown",
      "url": "https://www.amazon.com/s?k=ENCODED_QUERY",
      "add_to_cart": true
    },
    {
      "retailer": "Walmart",
      "price": null,
      "url": "https://www.walmart.com/search?q=ENCODED_QUERY",
      "add_to_cart": false
    },
    {
      "retailer": "Best Buy",
      "price": null,
      "url": "https://www.bestbuy.com/site/searchpage.jsp?st=ENCODED_QUERY",
      "add_to_cart": false
    }
  ]
}"""
        ),
        mock=lambda t: {
            "kind": "shopping",
            "product_name": t or "[mock] Sony WH-1000XM5",
            "description": "Industry-leading noise canceling wireless headphones.",
            "price_range": "$279–$350",
            "image_search": t or "Sony WH-1000XM5 headphones",
            "items": [
                {
                    "retailer": "Amazon",
                    "price": "$279.99",
                    "url": "https://www.amazon.com/s?k=Sony+WH-1000XM5",
                    "add_to_cart": True,
                },
                {
                    "retailer": "Walmart",
                    "price": "$299.00",
                    "url": "https://www.walmart.com/search?q=Sony+WH-1000XM5",
                    "add_to_cart": False,
                },
                {
                    "retailer": "Best Buy",
                    "price": "$279.99",
                    "url": "https://www.bestbuy.com/site/searchpage.jsp?st=Sony+WH-1000XM5",
                    "add_to_cart": False,
                },
            ],
        },
    ),
    "food_order": ActionSpec(
        id="food_order",
        category="discover",
        label="Food & Order",
        blurb="Recipe + order via DoorDash / Uber Eats when food is circled or described.",
        needs_text=False,
        needs_image=False,
        system_prompt=_json_contract(
            """{
  "kind": "food_order",
  "dish": "Dish name",
  "cuisine": "Cuisine type",
  "recipe": {
    "ingredients": ["item with qty"],
    "steps": ["step 1", "step 2"],
    "time_min": 30
  },
  "order_options": [
    {
      "platform": "DoorDash",
      "search_query": "dish name near me",
      "url": "https://www.doordash.com/search/store/DISH/"
    },
    {
      "platform": "Uber Eats",
      "search_query": "dish name",
      "url": "https://www.ubereats.com/search?q=DISH"
    },
    {
      "platform": "Grubhub",
      "search_query": "dish name",
      "url": "https://www.grubhub.com/search?queryText=DISH"
    }
  ],
  "nearby_query": "dish name restaurant near me"
}"""
        ),
        mock=lambda _t: {
            "kind": "food_order",
            "dish": "[mock] Sushi Burrito",
            "cuisine": "Japanese-Fusion",
            "recipe": {
                "ingredients": [
                    "2 sheets nori",
                    "2 cups sushi rice (seasoned)",
                    "200g salmon sashimi",
                    "1 ripe avocado, sliced",
                    "Sriracha mayo to taste",
                ],
                "steps": [
                    "Cook sushi rice and season with rice vinegar, sugar, and salt.",
                    "Lay a nori sheet flat and spread rice edge-to-edge, leaving 1\" at the top.",
                    "Add salmon strips and avocado down the center. Drizzle sriracha mayo.",
                    "Roll tightly into a burrito shape. Slice in half and serve.",
                ],
                "time_min": 35,
            },
            "order_options": [
                {
                    "platform": "DoorDash",
                    "search_query": "sushi burrito near me",
                    "url": "https://www.doordash.com/search/store/sushi%20burrito/",
                },
                {
                    "platform": "Uber Eats",
                    "search_query": "sushi burrito",
                    "url": "https://www.ubereats.com/search?q=sushi+burrito",
                },
                {
                    "platform": "Grubhub",
                    "search_query": "sushi burrito",
                    "url": "https://www.grubhub.com/search?queryText=sushi+burrito",
                },
            ],
            "nearby_query": "sushi burrito restaurant near me",
        },
    ),
    "weather": ActionSpec(
        id="weather",
        category="discover",
        label="Weather",
        blurb="Current conditions and 5-day forecast for a location.",
        needs_text=False,
        system_prompt=_json_contract(
            """{
  "kind": "weather",
  "location": "City, State/Country",
  "condition": "Sunny | Partly Cloudy | Cloudy | Rainy | Stormy | Snowy | Foggy | Windy",
  "temperature_f": 72,
  "temperature_c": 22,
  "feels_like_f": 70,
  "humidity": 65,
  "wind_mph": 8,
  "wind_direction": "SW",
  "forecast": [
    {"day": "Today", "high_f": 74, "low_f": 58, "condition": "Sunny"},
    {"day": "Sat",   "high_f": 70, "low_f": 55, "condition": "Partly Cloudy"},
    {"day": "Sun",   "high_f": 68, "low_f": 52, "condition": "Cloudy"},
    {"day": "Mon",   "high_f": 65, "low_f": 50, "condition": "Rainy"},
    {"day": "Tue",   "high_f": 72, "low_f": 56, "condition": "Sunny"}
  ],
  "weather_query": "weather in city"
}"""
        ),
        mock=lambda t: {
            "kind": "weather",
            "location": t or "San Francisco, CA",
            "condition": "Partly Cloudy",
            "temperature_f": 64,
            "temperature_c": 18,
            "feels_like_f": 61,
            "humidity": 78,
            "wind_mph": 14,
            "wind_direction": "W",
            "forecast": [
                {"day": "Today", "high_f": 66, "low_f": 54, "condition": "Partly Cloudy"},
                {"day": "Sat",   "high_f": 70, "low_f": 56, "condition": "Sunny"},
                {"day": "Sun",   "high_f": 65, "low_f": 52, "condition": "Foggy"},
                {"day": "Mon",   "high_f": 61, "low_f": 50, "condition": "Rainy"},
                {"day": "Tue",   "high_f": 68, "low_f": 55, "condition": "Sunny"},
            ],
            "weather_query": "weather in " + (t or "San Francisco"),
        },
    ),
    # --- Connect ----------------------------------------------------------
    "restaurant_booking": ActionSpec(
        id="restaurant_booking",
        category="connect",
        label="Book table",
        blurb="3 restaurant options + reserve via OpenTable (0.10 FET).",
        system_prompt=_json_contract(
            """{
  "kind": "restaurant_booking",
  "restaurants": [
    {
      "name": "Restaurant name",
      "cuisine": "Cuisine type",
      "address": "Full address (city at minimum)",
      "rating": 4.5,
      "price_level": "$ | $$ | $$$ | $$$$",
      "description": "One sentence about why this place stands out",
      "opentable_query": "restaurant name city",
      "opentable_url": "https://www.opentable.com/s/?term=RESTAURANT+CITY",
      "phone": "+1 xxx-xxx-xxxx or null",
      "map_query": "restaurant name address for Google Maps",
      "hours": "hours string or null"
    }
  ]
}
Return exactly 3 distinct restaurants that match the request, ordered best-first."""
        ),
        mock=lambda t: {
            "kind": "restaurant_booking",
            "restaurants": [
                {
                    "name": "[mock] Nobu Los Angeles",
                    "cuisine": "Japanese",
                    "address": "903 N La Cienega Blvd, Los Angeles, CA 90069",
                    "rating": 4.7,
                    "price_level": "$$$$",
                    "description": "Nobu Matsuhisa's flagship LA restaurant, famous for black cod miso.",
                    "opentable_query": "Nobu Los Angeles",
                    "opentable_url": "https://www.opentable.com/s/?term=Nobu+Los+Angeles",
                    "phone": "+1 310-657-5711",
                    "map_query": "Nobu Restaurant Los Angeles",
                    "hours": "Mon–Sun: 5:30pm–10:30pm",
                },
                {
                    "name": "[mock] Sushi Gen",
                    "cuisine": "Japanese/Sushi",
                    "address": "422 E 2nd St, Los Angeles, CA 90012",
                    "rating": 4.5,
                    "price_level": "$$$",
                    "description": "A downtown LA institution known for pristine sashimi at honest prices.",
                    "opentable_query": "Sushi Gen Los Angeles",
                    "opentable_url": "https://www.opentable.com/s/?term=Sushi+Gen+Los+Angeles",
                    "phone": "+1 213-617-0552",
                    "map_query": "Sushi Gen Los Angeles",
                    "hours": "Mon–Sat: 11:30am–2pm, 5:30pm–9:30pm",
                },
                {
                    "name": "[mock] Otium",
                    "cuisine": "American/Modern",
                    "address": "222 S Hope St, Los Angeles, CA 90012",
                    "rating": 4.3,
                    "price_level": "$$$",
                    "description": "Contemporary American cuisine next to The Broad museum with a stunning patio.",
                    "opentable_query": "Otium Los Angeles",
                    "opentable_url": "https://www.opentable.com/s/?term=Otium+Los+Angeles",
                    "phone": "+1 213-935-8500",
                    "map_query": "Otium Restaurant Los Angeles",
                    "hours": "Tue–Sun: 11:30am–10pm",
                },
            ],
        },
    ),
    "flight_track": ActionSpec(
        id="flight_track",
        category="connect",
        label="Track flight",
        blurb="Flight price, trend, and links to track or set a price alert.",
        system_prompt=_json_contract(
            """{
  "kind": "flight_track",
  "route": "LAX → JFK",
  "origin": "Origin city (IATA code)",
  "destination": "Destination city (IATA code)",
  "current_price": "$XXX or null",
  "airline": "Airline name or null",
  "flight_number": "UA 281 or null",
  "departure_date": "YYYY-MM-DD or 'flexible'",
  "duration": "Xh Xm or null",
  "typical_price_range": "$XXX–$XXX or null",
  "price_trend": "rising | falling | stable",
  "google_flights_url": "https://www.google.com/travel/flights",
  "kayak_url": "https://www.kayak.com/flights/ORG-DST/DATE"
}"""
        ),
        mock=lambda t: {
            "kind": "flight_track",
            "route": t or "LAX → JFK",
            "origin": "Los Angeles (LAX)",
            "destination": "New York (JFK)",
            "current_price": "$245",
            "airline": "United Airlines",
            "flight_number": "UA 281",
            "departure_date": "2026-05-15",
            "duration": "5h 25m",
            "typical_price_range": "$200–$450",
            "price_trend": "rising",
            "google_flights_url": "https://www.google.com/travel/flights",
            "kayak_url": "https://www.kayak.com/flights/LAX-JFK/2026-05-15",
        },
    ),
    "email_compose": ActionSpec(
        id="email_compose",
        category="connect",
        label="Email person",
        blurb="Draft an email to a person you've circled or named — ready to send.",
        system_prompt=_json_contract(
            """{
  "kind": "email_compose",
  "to_name": "Recipient name",
  "to_email": "email@example.com or null if unknown",
  "subject": "Email subject line",
  "body": "Full email body (ready to send)",
  "tone": "professional | friendly | formal | casual",
  "cc": null
}"""
        ),
        mock=lambda t: {
            "kind": "email_compose",
            "to_name": t or "the recipient",
            "to_email": None,
            "subject": "Following up",
            "body": (
                "Hi " + (t or "there") + ",\n\n"
                "I wanted to follow up on our recent conversation. "
                "Please let me know if you have any questions or need anything from my side.\n\n"
                "Looking forward to hearing from you.\n\nBest regards,"
            ),
            "tone": "professional",
            "cc": None,
        },
    ),
    "job_apply": ActionSpec(
        id="job_apply",
        category="connect",
        label="Apply to job",
        blurb="Auto-fill hints and direct apply links for a job posting.",
        system_prompt=_json_contract(
            """{
  "kind": "job_apply",
  "company": "Company name",
  "role": "Job title",
  "location": "City, State or Remote",
  "salary_range": "$XXXk–$XXXk or null",
  "requirements": ["key requirement 1", "key requirement 2"],
  "key_skills": ["Skill 1", "Skill 2", "Skill 3"],
  "application_url": "Direct application URL if visible, else null",
  "linkedin_easy_apply": false,
  "notes": ["Cover letter required", "Referral preferred"]
}"""
        ),
        mock=lambda t: {
            "kind": "job_apply",
            "company": "[mock] Anthropic",
            "role": t or "Senior Software Engineer",
            "location": "San Francisco, CA / Remote",
            "salary_range": "$200k–$300k",
            "requirements": [
                "5+ years software engineering experience",
                "Experience building ML or AI systems",
                "Strong Python and distributed systems background",
            ],
            "key_skills": ["Python", "Machine Learning", "Distributed Systems", "CUDA"],
            "application_url": "https://boards.greenhouse.io/anthropic",
            "linkedin_easy_apply": False,
            "notes": ["Portfolio of work required", "Cover letter strongly recommended"],
        },
    ),
    "grocery_list": ActionSpec(
        id="grocery_list",
        category="connect",
        label="Grocery list",
        blurb="Turn a recipe into a checkable grocery list with delivery links.",
        system_prompt=_json_contract(
            """{
  "kind": "grocery_list",
  "recipe_name": "Recipe name",
  "servings": 4,
  "items": [
    {
      "name": "Ingredient name",
      "quantity": "amount + unit",
      "category": "produce | dairy | meat | bakery | pantry | frozen | other"
    }
  ],
  "instacart_query": "recipe name ingredients",
  "walmart_grocery_query": "ingredient keywords for walmart grocery"
}"""
        ),
        mock=lambda t: {
            "kind": "grocery_list",
            "recipe_name": t or "[mock] Chocolate Lava Cake",
            "servings": 4,
            "items": [
                {"name": "Dark chocolate 70%", "quantity": "200g", "category": "pantry"},
                {"name": "Unsalted butter", "quantity": "100g", "category": "dairy"},
                {"name": "Eggs", "quantity": "4 large", "category": "dairy"},
                {"name": "Granulated sugar", "quantity": "80g", "category": "pantry"},
                {"name": "All-purpose flour", "quantity": "2 tbsp", "category": "pantry"},
                {"name": "Vanilla extract", "quantity": "1 tsp", "category": "pantry"},
            ],
            "instacart_query": t or "chocolate lava cake ingredients",
            "walmart_grocery_query": t or "chocolate lava cake ingredients",
        },
    ),
    "price_comparison": ActionSpec(
        id="price_comparison",
        category="discover",
        label="Compare prices",
        blurb="Circle a product — 3 Fetch.ai agents check Amazon, Reddit, and Google Shopping in parallel.",
        needs_image=False,
        needs_text=False,
        system_prompt="",  # handled entirely by the Agentverse bridge
        mock=lambda t: {
            "kind": "price_comparison",
            "product": t or "[mock] Sony WH-1000XM5",
            "fetch_parallel_ms": 612,
            "sources": [
                {
                    "platform": "Amazon",
                    "product": t or "Sony WH-1000XM5",
                    "price": "$279.99",
                    "rating": 4.7,
                    "review_count": 28431,
                    "prime": True,
                    "delivery": "FREE delivery tomorrow",
                    "seller": "Sold by Amazon",
                    "url": "https://www.amazon.com/s?k=Sony+WH-1000XM5",
                    "verdict": "Best value with Prime",
                    "highlights": ["Prime eligible", "30-day return", "1-year warranty"],
                },
                {
                    "platform": "Reddit",
                    "product": t or "Sony WH-1000XM5",
                    "sentiment": "positive",
                    "score": 0.89,
                    "summary": "Community consistently rates these the best ANC headphones under $300. Battery life and noise cancellation praised universally.",
                    "top_comment": "Bought these last year, still the best purchase I've made. ANC is insane.",
                    "concerns": ["USB-C flap can loosen over time", "No IP rating"],
                    "subreddits": ["r/headphones", "r/BuyItForLife", "r/SonyHeadphones"],
                    "url": "https://www.reddit.com/search/?q=Sony+WH-1000XM5+review&sort=top",
                },
                {
                    "platform": "Google Shopping",
                    "product": t or "Sony WH-1000XM5",
                    "price": "$279.99",
                    "lowest_price": "$249.00",
                    "lowest_seller": "B&H Photo",
                    "typical_range": "$249 – $350",
                    "in_stock": True,
                    "price_trend": "falling",
                    "url": "https://www.google.com/search?tbm=shop&q=Sony+WH-1000XM5",
                    "tip": "Price has dropped 12% over the past month — good time to buy.",
                },
            ],
        },
    ),
    "debate": ActionSpec(
        id="debate",
        category="understand",
        label="Debate",
        blurb="Two Fetch.ai agents argue for and against, a third synthesises the verdict.",
        needs_image=False,
        needs_text=False,
        system_prompt="",  # handled by bridge /debate
        mock=lambda t: {
            "kind": "debate",
            "topic": t or "[mock] Should I switch to a standing desk?",
            "fetch_agents": 3,
            "fetch_parallel_ms": 834,
            "total_paid_fet": 0.03,
            "agent_payments": [
                {"from": "GlanceOrchestrator", "to": "GlanceOptimistAgent", "amount": 0.01, "currency": "FET"},
                {"from": "GlanceOrchestrator", "to": "GlancePessimistAgent", "amount": 0.01, "currency": "FET"},
                {"from": "GlanceOrchestrator", "to": "GlanceSynthesisAgent", "amount": 0.01, "currency": "FET"},
            ],
            "pro": {
                "agent": "GlanceOptimistAgent",
                "stance": "Yes — invest in your health",
                "confidence": 78,
                "arguments": [
                    "Reduces lower-back pain in 80% of users within 4 weeks",
                    "Increases afternoon energy and focus",
                    "Long-term healthcare savings outweigh the cost",
                ],
                "key_quote": "Sitting is the new smoking — standing desks are preventive medicine.",
            },
            "con": {
                "agent": "GlancePessimistAgent",
                "stance": "Not without proper ergonomics",
                "confidence": 65,
                "arguments": [
                    "Standing all day causes varicose veins and foot pain",
                    "Most people revert to sitting within 3 months",
                    "A good chair + movement breaks is cheaper and more effective",
                ],
                "key_quote": "The desk won't save you if you don't move — habits matter more than furniture.",
            },
            "synthesis": {
                "agent": "GlanceSynthesisAgent",
                "verdict": "Sit-stand, not stand",
                "lean": "pro",
                "recommendation": (
                    "A height-adjustable desk with a 60/40 sit-stand split is optimal. "
                    "Pair it with an anti-fatigue mat and a timer to alternate every 45 minutes. "
                    "Budget desks ($300–500) deliver most of the benefit — premium models add little."
                ),
                "factors": [
                    "Current back pain level",
                    "Willingness to build a routine",
                    "Budget vs. quality trade-off",
                ],
            },
        },
    ),
    "price_monitor": ActionSpec(
        id="price_monitor",
        category="connect",
        label="Watch price",
        blurb="Autonomous Fetch.ai agent monitors a product and alerts you when the price drops.",
        needs_image=False,
        needs_text=False,
        system_prompt="",  # handled entirely by the Agentverse bridge
        mock=lambda t: {
            "kind": "price_monitor",
            "product": t or "[mock] Sony WH-1000XM5",
            "target_price": 249.00,
            "monitor_id": "demo1234",
            "status": "watching",
        },
    ),
    # --- Create -----------------------------------------------------------
    "generate_image": ActionSpec(
        id="generate_image",
        category="create",
        label="Generate image",
        blurb="Create a visual from the user's description or selected context.",
        needs_text=False,
        system_prompt=(
            "You are Glance's image-generation planner. The user wants to CREATE "
            "or VISUALIZE something as an image. Using the captured text, "
            "session context, and any user instruction as inspiration, write "
            "the BEST possible image-generation prompt for a diffusion model.\n\n"
            "Rules:\n"
            "- Describe the subject, style, lighting, perspective, and mood.\n"
            "- Keep the prompt under 300 words — dense and concrete beats vague.\n"
            "- Incorporate specific details from the captured text / history "
            "  (names, numbers, colours, relationships) so the image is "
            "  directly relevant to what the user asked about.\n"
            "- Never include people's real names or sensitive personal data.\n\n"
            "Respond with ONLY a JSON object, no prose, no code fences:\n"
            "{\n"
            '  "kind": "generate_image",\n'
            '  "title": "short human-readable title (≤ 8 words)",\n'
            '  "prompt": "the full image-generation prompt"\n'
            "}"
        ),
        mock=lambda t: {
            "kind": "generate_image",
            "title": "Mock visualization",
            "prompt": f"A vivid illustration of: {t or 'the captured context'}",
            "data_url": None,
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
