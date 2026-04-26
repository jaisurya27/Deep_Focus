# memory.md — Session memory for Glance

Persistent context any agent (Claude, Cursor, Codex) should remember when
resuming work on this repo.

## Identity

- **Product:** Glance — "What you Glance on the screen."
- **Origin:** Built on top of the existing Deep Focus scaffolding in this repo.
- **Code identifiers remain `deep-focus` / `deepFocus`** — intentional, not a
  rename-TODO. IPC channels, preload namespace, Electron bundle paths, and
  persisted settings keys all depend on it. Only the *visible* UI says Glance.
- **Venue:** LAHacks (36-hour build window).

## The pitch (do not dilute)

> Circle, highlight, point at, or draw on anything on your laptop screen.
> Glance instantly **understands**, **acts**, **helps you discover**,
> **creates**, or **connects to your tools** — all without breaking flow.

Killer demo = four scenes in 90 seconds:

1. Sushi photo → recipe card + nearest restaurant.
2. IDE bug → code-fix artifact, one-click apply.
3. Handwritten to-do list → calendar events.
4. Amazon product → price comparison + Reddit review summary.

## Capability inventory — the "artifact" taxonomy

Every capture (text, image, or both) can route to one of these actions. Each
returns a typed artifact that the UI renders as a rich card, not prose.
Schemas live in `services/backend/app/artifacts.py` and `apps/desktop/src/shared/artifacts.ts`.

### Understand
- `translate`           — text → {detected_lang, target_lang, translation, notes[]}
- `solve_math`          — equation/problem → {problem, answer, steps[], latex?}
- `explain_chart`       — chart → {headline, key_points[], caveats[]}
- `critique_ui`         — UI/UX → {strengths[], issues[], suggestions[]}
- `explain_code`        — code → {language, summary, walkthrough[], complexity?}
- `diagnose_error`      — error msg/trace → {likely_cause, fix_steps[], snippets?}
- `identify`            — person/landmark/plant/animal/logo/product → {name, category, facts[], links[]}

### Act
- `rewrite`             — text → {variants: [{tone, text}, …]}
- `tasks_to_calendar`   — checklist → {events: [{title, when, duration_min, notes}]}
- `sketch_to_code`      — mockup image → {framework, code, preview_hint}
- `diagram_to_mermaid`  — diagram image → {mermaid, notes?}
- `draft_reply`         — email → {subject?, body, tone}
- `autofill_form`       — form → {fields: [{label, suggested_value, confidence}]}
- `run_code`            — code → {safe: bool, language, command, explanation}

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

### Connect (stubbed for MVP)
- `book_reservation`, `price_track`, `email_person`, `job_autofill`, `grocery_list`.

## Interaction modes

- **Point**   hover + hotkey *(partial today via selected-text + active-window)*
- **Highlight** drag-select *(live)*
- **Region**  rectangular drag *(live: `Cmd+Ctrl+S`)*
- **Circle**  freehand loop *(post-MVP)*
- **Draw**    sketch → intent *(post-MVP)*
- **Voice+gesture** capture then speak the verb *(ElevenLabs hook, post-MVP)*

## What is live today (as of the current working branch)

### Backend
- FastAPI on `127.0.0.1:8765`, provider abstraction for xAI/OpenAI/mock.
- `/chat` SSE, `/chat/vision` SSE, `/image` JSON, `/session`, `/artifact` SSE.
- `/artifact` uses **OpenAI-compatible JSON mode** (`response_format:
  {"type": "json_object"}`) — guaranteed parseable JSON artifacts.
- Mock provider streams a realistic-shaped JSON payload so the full UX works
  with zero keys.
- Session store in memory, 14-day purge.

### Desktop shell (Glance UI)
- **Orb by default at app launch** (36px, breathing gradient, emerald halo).
- Click the orb → slides/pops the composer pill (520px wide, glass acrylic).
- While streaming → orb becomes a "thinking" Siri-style blob that shows
  `Streaming · N chars`.
- Artifact render → floating card above the composer with action buttons.
- **Manual drag via pointer events** (no `-webkit-app-region`). Threshold
  distinguishes click vs. drag.
- **Position persisted** to `electron-store` (`settings.panelPosition`) with
  300ms debounce; restored on boot, clamped to nearest display.
- **Content-driven window sizing**: `ResizeObserver` on the Stage wrapper →
  `IPC.PANEL_SET_CONTENT_SIZE` → `setContentSize` in main. Window is never
  bigger than content + 72px transparent halo (halo = shadow fade room).
- **Chromeless transparent window on macOS**: `resizable: false`,
  `thickFrame: false`, `roundedCorners: false` — kills the faint macOS window
  outline that was clipping box-shadows.
- **Acrylic material** for all surfaces:
  - `.glass` and `.glass-quiet`: heavy blur (40 / 36px), saturate 180 / 170%,
    opaque-enough dark tint (`rgba(8,12,22, 0.82 / 0.72)`), soft inner top
    highlight + bottom shadow bevel, strong drop shadow.
  - `.acrylic` utility: same base + SVG noise grain overlay for extra depth.
  - `brightness(...)` is intentionally NOT used — it washes the surface out on
    white backgrounds.
- **Hotkeys**: `Cmd+Ctrl+J` (just-ask), `Cmd+Ctrl+S` (region), `Cmd+Ctrl+H`
  (toggle). All flag `explicit: true` so the orb expands; otherwise the panel
  opens in orb form.
- **Backend health / provider-error warnings** surface in the panel if
  `/health` shows problems.

## Non-goals (this milestone)

- No real connector integrations. Stub with clean-looking artifacts + search links.
- No circle-gesture overlay — rectangular region capture stays primary.
- No voice layer wired — ElevenLabs lives behind a feature flag.
- No SQLite migration — in-memory session store is enough.

## Hard-won details to not forget

- `ELECTRON_RUN_AS_NODE` must be unset when running from Cursor/VS Code
  terminal; `pnpm dev:desktop` scrubs it via `cross-env`.
- macOS asks for Accessibility (first `Cmd+Ctrl+J`) and Screen Recording
  (first `Cmd+Ctrl+S`). Sentinels like `__needs_accessibility__` flow through
  the panel open payload.
- Selected-text capture: AppleScript on macOS, PowerShell keystrokes on
  Windows, xdotool/wtype on Linux. Always restore the clipboard.
- Provider auto-fallback is chat→xai first; vision→openai first; image→openai first.
- Renderer only speaks to `127.0.0.1:8765`.
- **Do not mass-rename `deep-focus` → `glance`** in code — IPC, preload, and
  settings keys depend on it.
- **Do not re-enable `vibrancy: "under-window"`** on the panel BrowserWindow —
  it paints a frosted background over the entire transparent window
  (rectangular), breaking the floating-orb look.
- **Do not restore `-webkit-app-region: drag`** — it clashes with hover
  animations and makes click-vs-drag unreliable. Manual pointer events win.
- **Do not toggle `setIgnoreMouseEvents`** on hover. The dynamic-window-sizing
  approach replaces it.
- `HALO_MARGIN` in `GlanceShell.tsx` (currently 72) must stay ≥ the largest
  `box-shadow` reach of any floating surface, otherwise shadows clip.
- Acrylic surfaces must NOT use `backdrop-filter: brightness(>100%)` — it
  looks fine on dark backgrounds but washes white backgrounds to light gray.

## Open questions (park here)

- Do we ship circle-gesture before the demo or leave it Vaporware™?
- Grok vs GPT-4o weighting for vision artifacts? Mock first, measure later.
- ElevenLabs: voice replay on assistant text enough for the prize, or do we
  need voice *input* for the verb too?
- Per-artifact bespoke layouts vs. current generic-ish `ArtifactCard`. User
  wants artifacts "floating" with tailored UI per kind.
