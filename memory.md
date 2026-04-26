# memory.md — Session memory for Glance

Persistent context I want any agent (Claude, Cursor, Codex) to remember when
resuming work on this repo.

## Identity

- **Product:** Glance — "What you Glance on the screen."
- **Origin:** Built on top of the existing Deep Focus scaffolding in this repo.
  Package names and code identifiers remain `deep-focus` / `deepFocus`
  intentionally — we are not doing a churny rename mid-hackathon.
- **Venue:** LAHacks (36-hour build window).

## The pitch (do not dilute)

> Circle, highlight, point at, or draw on anything on your laptop screen.
> Glance instantly **understands**, **acts**, **helps you discover**,
> **creates**, or **connects to your tools** — all without breaking flow.

The killer demo is four scenes in 90 seconds:

1. Sushi photo → recipe card + nearest restaurant.
2. IDE bug → code-fix artifact with one-click apply.
3. Handwritten to-do list → calendar events.
4. Amazon product → price comparison + Reddit reviews summary.

## Capability inventory — the "artifact" taxonomy

Every capture (text, image, or both) can route to one of these actions. Each
returns a typed artifact the UI renders as a rich card, not prose.

### Understand
- `translate`           — text → {detected_lang, target_lang, translation, notes[]}
- `solve_math`          — equation/problem → {problem, answer, steps[], latex?}
- `explain_chart`       — chart → {headline, key_points[], caveats[]}
- `critique_ui`         — UI/UX → {strengths[], issues[], suggestions[]}
- `explain_code`        — code → {language, summary, walkthrough[], complexity?}
- `diagnose_error`      — error msg/trace → {likely_cause, fix_steps[], snippets?}
- `identify`            — person/landmark/plant/animal/logo/product → {name, category, facts[], links[]}

### Act
- `rewrite`             — text → {variants: [{tone, text}, …]}  (formal/casual/shorter/translate)
- `tasks_to_calendar`   — checklist → {events: [{title, when, duration_min, notes}]}
- `sketch_to_code`      — mockup image → {framework, code, preview_hint}
- `diagram_to_mermaid`  — diagram image → {mermaid, notes?}
- `draft_reply`         — email text/image → {subject?, body, tone}
- `autofill_form`       — form → {fields: [{label, suggested_value, confidence}]}
- `run_code`            — code → defer; return {safe: bool, language, command, explanation}

### Discover
- `recipe`              — food photo → {dish, ingredients[], steps[], where_to_buy_query}
- `product`             — product → {name, summary, price_range?, review_bullets[], search_queries}
- `media_lookup`        — movie/book → {title, summary, where_to_{stream,buy}, cast_or_authors[]}
- `travel`              — landmark/building → {name, history, map_query}
- `fashion`             — apparel → {style_tags[], similar_queries[]}
- `company`             — logo → {name, funding?, news_queries}

### Create
- `image_from_sketch`   — sketch → uses existing `/image` route
- `moodboard_more`      — image → prompt fed into `/image`
- `regenerate_chart`    — chart → "prettier" prompt → image

### Connect (multi-step, needs explicit consent)
- `book_reservation`    — placeholder (returns search links for MVP)
- `price_track`         — placeholder
- `email_person`        — draft via `draft_reply`
- `job_autofill`        — placeholder
- `grocery_list`        — derived from `recipe`

## Interaction modes

- **Point**   hover + hotkey (partial today via selected-text + active-window)
- **Highlight** drag-select (live)
- **Region**  rectangular drag (live: `Cmd+Ctrl+S`)
- **Circle**  freehand loop (post-MVP SVG overlay)
- **Draw**    sketch → intent (post-MVP)
- **Voice+gesture** capture then speak the verb (ElevenLabs hook, post-MVP)

## What's live before the Glance pivot

- Electron menu-bar app, three global hotkeys, no dock icon.
- FastAPI sidecar on `127.0.0.1:8765`, provider abstraction for xAI/OpenAI/mock.
- Streaming SSE chat (`/chat`), multimodal vision (`/chat/vision`), image gen (`/image`).
- Five preset chips (Simplify · Analogy · Visual · Fun facts · Intuition).
- Session memory (14-day purge), history window, settings window with
  hotkey rebinding and `safeStorage`-backed API keys.

## The pivot — what we're building now

1. **Backend `POST /artifact`** — accepts `{action, text?, image_data_url?,
   window_context?, session_id?}`, dispatches to an action-specific system
   prompt that demands strict JSON, returns `{artifact: {...}, meta: {...}}`.
   Mock mode returns plausible canned artifacts so the full UX demoes
   offline.
2. **Frontend artifact renderers** — React components per artifact kind;
   degrade to a "generic" card for unknown types. Each renderer exposes
   action buttons (copy, open maps, export .ics, apply patch, etc.).
3. **Action bar** — when there's pending context (selection or captured
   region), the panel shows category-grouped action chips (Understand /
   Act / Discover / Create / Connect). Clicking a chip calls `/artifact`
   with the right action and drops the artifact into the chat stream as
   an assistant turn.
4. **Minimal rebrand** — the visible UI says "Glance"; code identifiers stay
   `deep-focus` to avoid breaking hotkey bindings, IPC channels, settings,
   and Electron bundle paths during the hack.

## Non-goals (this milestone)

- No real connector integrations (OpenTable, Google Calendar). We stub with
  clean-looking artifacts + search links.
- No circle-gesture overlay yet — rectangular region capture stays primary.
- No voice layer yet — ElevenLabs integration lives behind a feature flag.
- No SQLite migration — in-memory session store is enough for the demo.

## Hard-won details to not forget

- `ELECTRON_RUN_AS_NODE` must be unset when running from Cursor/VS Code
  terminal; `pnpm dev:desktop` scrubs it via `cross-env`.
- macOS asks for Accessibility (first `Cmd+Ctrl+J`) and Screen Recording
  (first `Cmd+Ctrl+S`). Sentinels like `__needs_accessibility__` flow
  through the panel open payload.
- Selected-text capture: AppleScript on macOS, PowerShell keystrokes on
  Windows, xdotool/wtype on Linux. Always restore the clipboard.
- Provider auto-fallback is chat→xai first; vision→openai first (grok vision
  needs allow-listed models); image→openai first.
- The renderer only speaks to `127.0.0.1:8765` — never directly to xAI/OpenAI.

## Open questions (park here)

- Do we ship the circle gesture before the demo or leave it as Vaporware™?
- How much do we lean on Grok vs GPT-4o for vision-based artifacts? Mock
  mode first, then measure after keys are wired.
- ElevenLabs — is the voice replay on assistant text enough for the prize,
  or do we also need voice input for the verb?
