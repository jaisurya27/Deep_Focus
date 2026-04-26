# Changelog — current working branch

Chronological record of changes on top of the `Refactor: Deep Focus → Glance`
commit (110830b). When the branch ships, squash or re-organize into a proper
changelog.

## 2026-04-26 — Documentation: `README.md` + `CLAUDE.md` aligned with Glance

Refreshed root docs to match the current product: Glance shell + `/artifact`
`action:auto` pipeline, `router.py`, `needs_context`, selection/region/ambient
behavior, default hotkeys (no legacy Cmd+1–5 preset table), orb bottom-right on
first launch, removed references to deleted `AnswerPanel`. See `README.md` and
`CLAUDE.md` for full detail.

## 2026-04-25 — FET payment gate for restaurant booking

`restaurant_booking` artifacts in the desktop app are now payment-gated before
the restaurant card is revealed, mirroring the Orchestrator's Payment Protocol
flow on ASI:One.

**Flow:** user asks → backend streams `restaurant_booking` artifact → GlanceShell
intercepts it → `FetPaymentGate` modal appears (0.10 FET, Fetch.ai branding) →
user clicks "Pay 0.10 FET" → 1.8s simulated testnet confirmation → success flash
→ restaurant card revealed. "Decline" dismisses the artifact entirely.

**New file:** `apps/desktop/src/renderer/shell/FetPaymentGate.tsx`

**Changed:** `GlanceShell.tsx` — added `paidMessageIds` state; artifact render
block conditionally shows `FetPaymentGate` before `FloatingArtifact` for
`restaurant_booking` until payment is confirmed.

## 2026-04-25 — Agentverse bridge: desktop artifacts route through Fetch.ai

`food_order`, `restaurant_booking`, and `fix_code` in the desktop app now
delegate to the Fetch.ai Agentverse bridge (`:8020`) instead of calling the
local LLM directly. The bridge uses the same system prompts and formatters as
the Agentverse specialist agents (DiscoverAgent / ConnectAgent / CodeAgent).

**New files:**
- `services/agentverse/bridge.py` — FastAPI HTTP bridge (port 8020), started
  by `run_all.py` alongside the agents.

**Changed files:**
- `services/agentverse/shared/config.py` — added `BRIDGE_PORT = 8020`.
- `services/agentverse/requirements.txt` — added `fastapi`, `uvicorn`.
- `services/agentverse/run_all.py` — Bridge is started first (agents depend on it being up).
- `services/backend/app/config.py` — added `agentverse_bridge_url` setting
  (env: `AGENTVERSE_BRIDGE_URL`, default `http://127.0.0.1:8020`).
- `services/backend/app/routes/artifact.py` — added `_AGENTVERSE_ACTIONS` set
  and `_agentverse_stream` coroutine; non-mock requests for those three actions
  delegate to the bridge. If the bridge is unreachable the stream emits a clear
  error message instead of silently failing.
- `services/backend/app/artifacts.py` — `food_order` changed to
  `needs_image=False` so text-only queries ("I want ramen tonight") work.

**SSE meta badge:** delegated artifacts report `provider=fetch_ai / model=agentverse`.

## 2026-04-25 — Fetch.ai Agentverse integration

Added `services/agentverse/` — a standalone multi-agent system that exposes
three Glance artifacts on Fetch.ai Agentverse, accessible via ASI:One Chat
with no custom frontend required.

**Agents (all in `services/agentverse/agents/`):**
- `GlanceOrchestratorAgent` (port 8010) — Chat Protocol + Payment Protocol
  (seller role). Classifies intent via keyword heuristics + LLM, routes to
  the appropriate specialist. Connect-tier requests (restaurant booking) are
  gated by a 0.10 FET payment via RequestPayment before dispatch.
- `GlanceCodeAgent` (port 8011) — `fix_code` artifact. Accepts both
  RoutedRequest (from Orchestrator) and direct ChatMessage from ASI:One.
- `GlanceDiscoverAgent` (port 8012) — `food_order` artifact. Same dual path.
- `GlanceConnectAgent` (port 8013) — `restaurant_booking` artifact.
  Internal only (no Chat Protocol) — only reachable after payment cleared.

**Artifacts implemented:**
- `fix_code` — diagnose + corrected snippet with changes list
- `food_order` — recipe, steps, DoorDash/Uber Eats/Grubhub links
- `restaurant_booking` — booking card + OpenTable URL, gated by 0.10 FET

**Shared modules (`services/agentverse/shared/`):**
- `config.py` — fixed seeds → deterministic addresses; ports
- `messages.py` — `RoutedRequest` / `RoutedResponse` inter-agent models
- `system_prompts.py` — same JSON contracts as `services/backend/app/artifacts.py`
- `llm.py` — async OpenAI/xAI call with JSON-mode + keyword-based classifier
- `formatters.py` — converts artifact dicts to readable Markdown for ASI:One

**To run:** see `docs/runbook.md` → Agentverse section.

**Files added:**
- `services/agentverse/requirements.txt`
- `services/agentverse/.env.example`
- `services/agentverse/shared/{__init__,config,messages,system_prompts,llm,formatters}.py`
- `services/agentverse/agents/{__init__,orchestrator,code_agent,discover_agent,connect_agent}.py`
- `services/agentverse/run_all.py`

## 2026-04-25 — Image-only capture auto-submit

Region captures (Cmd+Ctrl+S) now auto-submit to `/artifact` immediately after
the selection is made — no text input required. The backend vision router
analyzes the image and returns the most relevant artifact (recipe, food order,
identify, explain chart, etc.) without the user needing to type anything.

**What changed:**
- `GlanceShell.tsx` — added `runAutoRef` (always-fresh ref to `runAuto`) so the
  `panel.onOpen` IPC handler can call it without stale-closure issues. On
  `mode === "region"` with an `imageDataUrl`, `runAuto("")` is now scheduled via
  `setTimeout(0)` immediately after the pending image is set.
- `GlanceShell.tsx` — composer `onSend` now allows submitting with an empty draft
  when `pendingImage` is set (belt-and-suspenders for the rare case where the
  user beats the auto-submit).
- `router.py` — heuristic fallback for image-only requests now uses app/window
  context to make smarter pre-LLM picks: food apps → `food_order`, product
  retailers → `product`, code editors → `explain_code`, chart titles →
  `explain_chart` (applies only in mock mode; live providers still use the
  vision LLM router).

**Files changed:**
- `apps/desktop/src/renderer/shell/GlanceShell.tsx`
- `services/backend/app/router.py`

## 2026-04-25 — 9 new bespoke artifact types (maps, shopping, food+order, weather, restaurant booking, flight tracker, email compose, job apply, grocery list)

Added a full second wave of artifact kinds — each with a custom backend schema,
mock data for offline demo, TypeScript type, and a purpose-built React card.

**New artifact kinds:**

| Kind | Category | Card highlights |
|---|---|---|
| `map` | Discover | CSS grid map art with location pin, Google Maps + Apple Maps + Directions links |
| `shopping` | Discover | Per-retailer rows (Amazon/Walmart/Best Buy) with price, View, and Add-to-Cart buttons |
| `food_order` | Discover | Tab card: "Order" tab lists DoorDash / Uber Eats / Grubhub deep-links; "Recipe" tab shows ingredients + steps |
| `weather` | Discover | Current temp + condition hero, feels-like/humidity/wind stats row, 5-day forecast strip with weather emoji |
| `restaurant_booking` | Connect | Star rating, price level, hours, and a prominent "Book on OpenTable" CTA |
| `flight_track` | Connect | Route + price display, trend indicator (↑/↓/→), Google Flights + Kayak + price-alert links |
| `email_compose` | Connect | Email header (To/Subject) + body pre-filled and editable, "Open Gmail" and "Outlook" deeplinks |
| `job_apply` | Connect | Company, role, salary badge, skill pills, requirements list, "Apply Now →" and "LinkedIn" CTAs |
| `grocery_list` | Connect | Per-category checkable item list (state preserved in card), Instacart + Walmart Grocery order links |

**Files changed:**
- `services/backend/app/artifacts.py` — 9 new `ActionSpec` entries, updated suggested-action catalog string in `_json_contract`
- `apps/desktop/src/shared/artifacts.ts` — 9 new TS types + updated `Artifact` union
- `apps/desktop/src/renderer/artifacts/ArtifactCard.tsx` — 9 new card components, switch cases, and imports

## 2026-04-25 — smart context loop: auto-screenshot when the model needs to see the screen

"What am I looking at?" used to stump Glance: with no image attached, the
artifact router picked `answer` and the model confessed it couldn't see
the screen. Fixed by wiring a two-sided **smart-context loop** that can
auto-collect whatever signal the agent decides it's missing.

**Backend** — `services/backend/app/`:

- New meta-action `needs_context` in `artifacts.py`. Router-only (never
  user-facing). The `/artifact` route *short-circuits* for it — no LLM
  call, just a deterministic JSON payload:
  `{kind:"needs_context", needs:["screenshot"], reason, retry_instruction}`.
- `router.py` now teaches the LLM to pick `needs_context` when the user
  is clearly asking about on-screen content but nothing visual is
  attached, and the heuristic fallback does the same via a
  `_VISUAL_INTENT_RE` regex ("what am I looking at", "describe my
  screen", "read this for me", etc.). The action is filtered out of the
  catalog once an image is already attached so the router can't loop.

**Main process** — `apps/desktop/src/main/capture/fullscreen.ts`:

- `captureFullScreen()` silently snaps the display under the cursor via
  `desktopCapturer` (no overlay UI). Temporarily hides the panel for
  ~60 ms so the orb/composer don't appear inside the screenshot, then
  restores it. Returns a downscaled (max edge 1600 px) data URL.
- Bubbles a structured error envelope instead of throwing so the
  renderer can distinguish `permission` vs `failed`.
- Exposed via `ipcMain.handle(IPC.CAPTURE_FULLSCREEN)` and the preload
  bridge as `window.deepFocus.capture.fullscreen()`.

**Renderer** — `apps/desktop/src/renderer/shell/GlanceShell.tsx`:

- Fast path: before every composer submission, a `VISUAL_INTENT_RE`
  regex (kept in sync with the backend) auto-captures a screenshot when
  the prompt clearly asks about the screen and nothing visual is
  attached yet. Saves a round-trip for the common case.
- Slow path: after any `runArtifact` response, if the artifact kind is
  `needs_context`, the shell silently fulfills the declared needs
  (currently `screenshot`; `selection` / `active_window` are reserved
  for future hooks), drops the placeholder turn from the transcript,
  and re-runs the original instruction with the new signal attached.
- Retries are capped at depth 1 so a misbehaving model can't spin
  forever. If the capture fails (permission denied), we surface the
  notice banner with a deep link to System Settings and render a new
  `NeedsContextCard` (in `ArtifactCard.tsx`) so the user still sees
  *why* we're stuck.
- Store gains a small `removeMessages([ids])` action for surgically
  replacing the placeholder user/assistant pair when auto-fulfilling.

Shape of a `needs_context` artifact (shared type in
`apps/desktop/src/shared/artifacts.ts`):

```
{
  "kind": "needs_context",
  "needs": ["screenshot" | "selection" | "active_window", …],
  "reason": "one-sentence why",
  "retry_instruction": "original user question, preserved"
}
```

Extending the loop to new signals is a two-sided change only: add the
signal id to `needs`, teach the renderer how to collect it, and (if it's
genuinely new) add a capture helper in the main process.

## 2026-04-25 — `/artifact` replays session history on follow-ups

Follow-up questions through the composer were reading as cold-start asks:
the backend was persisting each turn into the session store but never
wiring prior exchanges back into the request. Only `/chat` replayed
history; `/artifact` (which every composer submission flows through as
`action=auto`) did not. So "what about option 2?" had zero memory of
option 1.

Fix in `services/backend/app/routes/artifact.py`:

- New `_history_wire(session_id)` pulls the last 8 user/assistant
  exchanges for the session and prepends them to the wire payload after
  the system/window-hint messages and before the current user turn —
  same shape as `/chat`.
- Assistant messages in this route are stored as the full artifact JSON
  (up to 8 KB). `_condense_assistant` extracts a human-readable digest
  (`body` / `answer` / `text` / `summary` / `explanation` /
  `translation`, tagged with the artifact `kind`) so the downstream
  model sees what it actually *told the user*, not a wall of braces.
  Prevents JSON-mode from being re-primed to mimic the prior shape.
- Works for both text-only and multimodal turns; prior turns always ride
  as plain-string `content`, only the current turn keeps the multimodal
  content array with the captured image.
- `MAX_CONTEXT_EXCHANGES = 8`, `REPLAY_CHAR_CAP = 1800` per message.

"Lazy context" in `CLAUDE.md` means *decide smartly whether to reuse the
last session or start fresh on a new capture* — it does NOT mean drop
all memory mid-session.

## 2026-04-25 — keep the user's request visible while streaming

Previously `runAuto`/`runAction` cleared `draft` immediately on submit,
so during streaming the composer showed the generic `Thinking…`
placeholder and the user lost sight of what they actually asked. Now:

- Composer keeps the submitted text in the (disabled) textarea while
  the turn streams, wrapped in the Siri-style glow — so the prompt
  itself *is* the loading surface.
- `runAction` (chip clicks / smart crumbs / suggestions) has no typed
  draft, so we inject a pretty version of the action label into the
  composer (e.g. "Explain code") during its stream for the same reason.
- The "clear text" X is hidden while streaming so the request can't be
  wiped mid-flight — the Stop button is the only way to cancel.
- `draft` is cleared in the `finally` of both flows so success, error,
  and abort all end on a clean composer ready for the next ask.

## 2026-04-25 — kill layout-animation overlap ("rectangle below chat")

When a turn finished and the artifact mounted its `SuggestionRow` ("Try
instead…" chips) between the artifact and the composer, the outer flex
column — annotated with `<motion.div layout>` and containing more inner
`layout` motion elements — reflowed *every* sibling via Framer's shared
layout. Mid-animation, the composer visibly slid through the suggestion
row and a ghost of the old composer (or its halo) briefly rendered below
the real composer, producing the "weird rectangle bar below the chat
once thinking is done."

Fix: dropped the `layout` prop from the outer stack wrapper, the
composer motion, the inner AnimatePresence children (health, notice,
context chip, smart crumbs, artifact/answer cards), and `SuggestionRow`.
Enter/exit animations (opacity/translate/scale) stay, so individual
elements still animate in/out nicely — we just no longer ask Framer to
animate every sibling's position when the stack's height changes. The
Stage's own `ResizeObserver` resizes the Electron window instantly, so
the layout is stable.

## 2026-04-25 — Siri-style thinking halo, no duplicate loading bar

While a turn was streaming, the shell rendered **two** pill-shaped bars:
an empty `FloatingAnswer` card above the composer (with the emerald
traveling border) and the composer itself (also with the border, showing
"Thinking…"). The top card was useless — the composer already signals
thinking — and its exit animation (`y: +6`) left a "weird bar" sliding
down past the composer the instant streaming ended.

Fixes:

- `GlanceShell`: only render `FloatingAnswer` when the assistant message
  actually has text content. An empty streaming assistant turn no longer
  mounts a placeholder card; the composer's own glow is the thinking UI.
- `styles.css`: reworked `.glance-streaming-border` into a Siri-style
  breathing halo. Dropped the clipped `::after` scanline (which could
  only live inside the pill) in favour of a multi-layer `box-shadow`
  that pulses between emerald and teal and bleeds several px outside
  the element into the transparent stage halo — so the composer looks
  like it's *glowing*, not fenced.

## 2026-04-25 — visible failures + context fallback for suggestion chips

Clicking a "Try instead" suggestion (e.g. Product lookup on an Identify
artifact) was silently 400-ing and giving the user zero feedback. Two
issues, both fixed:

1. **Lost context.** `runAction` read `pendingSelection` / `pendingImage`
   from the session store, but those slots are cleared right after every
   send. Suggestion chips therefore shipped *no* text/image and the
   backend rejected them (`action 'product' needs text context`). Fix:
   when pending slots are empty, walk back through messages and reuse
   the most recent user turn's selection/image.
2. **Silent errors.** `failMessage` stamped `⚠️ …` into the assistant
   message's `content`, but the render tree prefers the existing
   artifact over `FloatingAnswer`, so the error was hidden behind the
   old card. Fix: on any `runAuto` / `runAction` rejection we now also
   raise a `panelNotice` (error tone) so the failure surfaces as a
   visible toast above the artifact.
   - Added `humanizeBackendError` which decodes `backend 400: {"detail":…}`
     envelopes into a human sentence and detects network failures.
   - Pre-flight `needs_image` / `needs_text` misses also surface as a
     warn-tone notice now (instead of the button silently doing nothing).
   - `NoticeBanner` gained an optional `onDismiss` close button so users
     can clear errors without collapsing the shell.

Aborted turns (user hit Stop) do NOT raise the notice.

## 2026-04-25 — single header row (actions left, drag/close right)

The artifact action rail (Copy / Follow-up / Full chat / Dismiss) and the
shell's TopBar (drag + collapse) lived in two separate rows — the rail on
top of the artifact, the TopBar above everything. Visually redundant and
the rows weren't aligned.

Fix: pulled `ArtifactActionRail` out of `FloatingArtifact` as its own
export, and the shell now renders one header row at the top of the
expanded column:

```
[copy][follow-up][full chat][dismiss] ................ [drag][X]
```

- `FloatingArtifact` is now just the card body — no action rail.
- `ArtifactActionRail` is rendered by `GlanceShell` inside the TopBar row
  (left slot), only when there's an artifact to act on.
- All five action pills + drag + close are now **h-6 / w-6** (24px),
  icons are 14px SVGs in 12px square flex wrappers. Reduced from the
  previous h-7 so the row reads as a whisper-quiet ribbon, not a toolbar.
- Hover/focus on an action still springs in its uppercase label and
  expands the pill's width. Drag/close remain icon-only.

Files: `apps/desktop/src/renderer/shell/FloatingArtifact.tsx`,
`apps/desktop/src/renderer/shell/GlanceShell.tsx`.

## 2026-04-25 — artifact body gets an actual background

Artifacts were rendering as raw text on top of the transparent Electron
window — fine on a dark editor, invisible/ghostly on a white page. The
shared `Card` atom in `ArtifactCard.tsx` only drew a title row and the
content; there was no panel behind it. `AnswerCard` was the exception
because it wraps its body in `glass-quiet`.

Fix: wrap the `Card` atom itself in `.glass` + `rounded-[22px]` +
`px-4 py-3`. Every artifact kind (Identify, Product, Recipe, FixCode, …)
now has an opaque acrylic panel that stays readable on any background.
AnswerCard's inner `glass-quiet` now reads as a nested accent panel,
which looks fine.

Also deleted the dead `.aurora-bead` CSS — only the deleted
`InlineThinking` component used it, and its rotating conic-gradient
animations were showing up as HMR-leak streaks during live reload.

Files: `apps/desktop/src/renderer/artifacts/ArtifactCard.tsx`,
`apps/desktop/src/renderer/styles.css`.

## 2026-04-25 — kill the diagonal streaks (proper streaming indicator)

The `.glance-streaming-border` animation had a `transform: rotate(360deg)`
on a 1px pseudo-ring around a non-square pill. Rotating a non-square
element sweeps its four corners along arcs wider than the element itself
— which is what was painting those diagonal emerald/cyan/pink streaks
across the viewport during streaming.

Replaced the whole treatment. No rotation anywhere.

- Static emerald 1px border on the pill.
- Breathing `box-shadow` that pulses between two emerald intensities
  (`glance-streaming-pulse`, 2.4s).
- A thin (1.5px) scan line along the bottom edge that travels
  left→right via animated `background-position`
  (`glance-streaming-scan`, 1.8s).
- `overflow: hidden` on the element clips the scan line to the pill's
  border-radius so nothing paints outside.

Result: clearly "something is happening" without looking like a '90s
Winamp visualizer.

File: `apps/desktop/src/renderer/styles.css`.

## 2026-04-25 — readability & artifact rail polish

### Icon-first artifact rail (expand on hover)
- `FloatingArtifact`'s action bar was five separate "COPY / REDO / ASK
  FOLLOW-UP / FULL CHAT / DISMISS" pills floating loose below the artifact.
  Consumed a ton of horizontal space and read as "other UI", not chrome
  belonging to the artifact.
- Replaced with a single glass pill containing icon-only buttons
  (`IconAction`). Each button shows just its icon at rest; on hover/focus,
  the label slides in with a width-animated spring. The pill tucks up
  against the artifact (`-mt-2`) so it looks attached, not orphaned.

### Suggestion pills readable on any background
- `SuggestionRow` ("Try instead → …") and `SmartCrumbs` previously used
  `bg-emerald-500/10 border-emerald-500/30` — essentially transparent. On
  a white desktop background (Chrome tab, Figma canvas) they disappeared.
- Both now use the opaque `.glass` base (same dark acrylic as the composer)
  with an emerald ring, a glowing emerald bullet dot on the suggestion
  pill, and bolder text. Same readability on black, white, or photographic
  backdrops.

### `AnswerCard` followups got a section label
- The non-interactive "What is Headroom? / How does Headroom compress data?"
  pills were visually colliding with the action rail. Added a "You might
  ask" caption and bumped their contrast slightly so they read as a
  secondary hint, not more buttons.

### Files
- `apps/desktop/src/renderer/shell/FloatingArtifact.tsx` (rewrite of the
  action rail + new `IconAction`).
- `apps/desktop/src/renderer/shell/GlanceShell.tsx` (`SuggestionRow`,
  `SmartCrumbs` styling).
- `apps/desktop/src/renderer/artifacts/ArtifactCard.tsx` (`AnswerCard`
  followups section).

## 2026-04-25 — night pass (killable shell, no more aurora streaks)

### The close button actually closes
- Problem: during streaming the composer was replaced by a standalone
  `InlineThinking` pill with its own Stop button but **no** ×, and the
  auto-expand effect re-fired on `isStreaming || lastArtifactMsg`, so a
  click on × bounced the shell back open a frame later. Net effect: there
  was no way to dismiss the UI once a turn was in flight.
- Fixes:
  - Removed `isStreaming` from the auto-expand dependency list. A close
    during a turn now actually sticks.
  - `minimizeShell` now `abortRef.current?.abort()`s any in-flight turn
    AND calls `clearOutput()` before collapsing, so the effect that
    re-opens on `lastArtifactMsg` can't re-trigger.
  - The collapsed-orb guard also ignores `isStreaming`.

### Dedicated TopBar (drag + close, always visible)
- Old `DragGrip` (a rail of four dots) is gone. New `TopBar` is a 2-button
  row: drag icon on the left, × on the right. Always rendered while the
  shell is expanded, including mid-stream. The × is the universal "minimize
  to orb" gesture; drag is the window-drag handle.

### Composer IS the thinking surface (no more aurora blob)
- Deleted `InlineThinking` and `StreamingShimmer`. The composer now stays
  rendered at all times and takes a `streaming` prop:
  - While streaming, the whole pill gets the `glance-streaming-border`
    traveling emerald glow, the textarea is `disabled`, and the Send
    button swaps to a rose-tinted Stop button (wired to the same abort
    controller as Esc).
  - Placeholder text becomes "Thinking…" so the state is legible without
    a bespoke surface.
- Removed the `layoutId="glance-core"` shared between orb and aurora bead
  — that was what was painting those diagonal streaks across the viewport
  during state transitions. Good riddance.

### Context-aware × inside the composer
- New composer X button with smart behavior:
  - Draft non-empty → clear the draft (keep output).
  - Draft empty + output on screen → clear the output (keep session id).
  - Neither → button hidden so the row doesn't clutter.
- Keeps the minimize-to-orb action on the TopBar separate from the
  clear-my-work action in the composer. Cmd+K stays the hard reset.

### Files
- `apps/desktop/src/renderer/shell/GlanceShell.tsx` (substantial rewrite
  of the expanded render + composer + TopBar; deleted `InlineThinking`,
  `StreamingShimmer`, `DragGrip`).
- `apps/desktop/src/renderer/shell/icons.tsx` (added `DragIcon`,
  `StopIcon`).

## 2026-04-25 — late pass (dismiss actually clears, new capture resets output)

### New capture → fresh slate
- Previously, firing `Cmd+Ctrl+S` while a prior artifact/answer was still on
  screen left the *old* output visible and only swapped the `pendingImage`.
  The shell still showed the stale card (and the context chip + smart crumbs
  were gated behind `!lastArtifactMsg`, so they never appeared).
- Added `clearOutput()` on the session store — wipes `messages`,
  `pendingSelection`, `pendingImage` while preserving `sessionId` and
  `providerLabel` (so mid-conversation follow-ups still thread on the backend
  if the user types one before capturing anything new). Called from the
  `onOpen` IPC handler on every `selection` / `region` payload so each new
  capture starts clean and immediately shows the new context chip + smart
  crumbs.

### Dismiss = clear (not just minimize)
- `FloatingArtifact`'s "Dismiss" button used to call `minimizeShell`, so the
  artifact came right back the moment the user clicked the orb again. It now
  calls `clearOutput()` — the card is really gone, composer stays open, ready
  for the next question.
- Added a matching close × on the `FloatingAnswer` text card (hidden while
  streaming to avoid racing the abort button). Tooltip points at Cmd+K for
  the hard reset.
- Minimize (composer ×, Esc) is unchanged — still collapses to orb while
  preserving state. The mental model is now: **×** on the *output* clears
  output, **×** on the *composer* tucks away, **Cmd+K** wipes everything
  including session id.
- Files: `apps/desktop/src/renderer/stores/session.ts`,
  `apps/desktop/src/renderer/shell/GlanceShell.tsx`.

## 2026-04-25 — evening pass (orb UX overhaul + region-capture fix)

### Region capture actually works now
- **Root cause of the "select region but nothing shows up" bug:** the overlay
  renderer was waiting on an `OVERLAY_START` IPC to learn its display's screen
  origin, but main sent it on `did-finish-load` *before* React's `useEffect`
  subscriber was attached. The message was missed on every single capture and
  every drag fell into a `no-overlay-info → cancel` branch.
- **Fix:** dropped the `OVERLAY_START` handshake entirely. Pointer events
  already carry `screenX`/`screenY` in global screen-space coordinates; the
  overlay now records both client and screen coords directly.
- Added a window-level `pointerup` fallback (plus `setPointerCapture`) so a
  release that happens off the root div still fires `finishDrag`.
- Lowered the min-size cancel threshold to 2px and started passing a `reason`
  string on `OVERLAY_CANCEL` so any future regression is one log line away.
- File: `apps/desktop/src/renderer/overlay.tsx`.

### Screen-Recording permission: visible feedback in the panel
- When `systemPreferences.getMediaAccessStatus("screen")` isn't `granted`, we
  no longer silently bail. We still show the native dialog, but we also call
  `showPanel({ notice: { tone, title, body, action } })` so the user sees a
  warning banner in Glance itself with an "Open System Settings" deep-link
  button — the native dialog can easily end up buried behind fullscreen apps.
- Added `notice?: { tone, title, body, action }` to `PanelOpenPayload`.
- New IPC channel `IPC.OPEN_EXTERNAL` with a small allowlist (`http(s)://`,
  `x-apple.systempreferences:`) and a `window.deepFocus.shell.openExternal`
  preload method for the banner's action button.

### One universal dismiss gesture
- The shell used to have four distinct close behaviors (composer ×, context
  chip ×, artifact ×, Esc) that all did *different* things. Replaced with a
  single `minimizeShell` that tucks the UI back to the orb and preserves ALL
  state (context chip, notice, assistant answer, streaming).
- Context-chip × and notice-banner × are gone. To drop context, start a new
  capture or hit `Cmd+K` (the only destructive action).
- Removed `collapseShell`. `dismissArtifact` is now `= minimizeShell`. Esc
  (when not streaming) also maps to `minimizeShell`.
- The orb-collapse `useEffect` no longer re-expands on `hasContext` — so a
  minimize-with-context truly minimizes. Clicking the orb restores state.

### Smart crumbs (replace category-grouped action chips)
- Removed the `ActionChips` component + its backend `listActions` call. The
  category tabs (Understand / Act / Discover) and chips (Translate, Solve
  math, Explain code, …) were cluttering the screen with context-irrelevant
  options.
- New `SmartCrumbs` produces 3–5 context-aware one-tap prompts by heuristic
  over the attached selection / image / `sourceApp`:
  - For code-ish selections (by sourceApp or content signal): Explain this
    code, Diagnose error / Find bugs, Improve.
  - For prose: Explain, TL;DR (on long text), What does this mean?,
    Translate → English (on non-English), Simplify, Summarize link (on URLs).
  - For images: Describe, Extract text, Translate → English, Explain, What
    should I do?.
- Crumbs fill the composer draft and auto-send.

### New streaming UX (ChatGPT-voice-mode-ish)
- The old 58px square "THINKING…" blob is gone from the expanded shell. In
  its place:
  - **`InlineThinking` pill** replaces the composer while streaming. Contains
    an `aurora-bead` (30px sphere with conic-gradient halo spin + multi-radial
    pulse + breathe), a live "Thinking…" label with animated dots, a
    `chars` counter, and a **Stop** button that aborts the request.
  - **`StreamingShimmer`** (3 pulsing bars) covers the beat between request
    sent and first token.
  - **`FloatingAnswer`** renders plain-text assistant turns as a scrollable
    card (`white-space: pre-wrap`, max-h 360px, autoscroll to tail). While
    streaming, it wears a conic-gradient traveling halo (`glance-streaming-border`
    + `@property --angle`) and a blinking emerald caret (`glance-caret`).
- Context chip and — when present — the answer card stay visible throughout
  streaming. Only the composer swaps for the thinking pill. Crumbs hide
  during a turn and after a turn has produced an answer.

### FIXED: "response is blank" after using a smart crumb
- The shell previously only rendered `lastArtifactMsg?.artifact`. Plain-text
  assistant turns (which is what `sendText` — and therefore every smart crumb
  and every composer submit — produces) were being written to the session
  store but never shown anywhere in the panel.
- New `lastAssistantMsg` memo finds the most recent assistant text turn (with
  content or streaming). `FloatingAnswer` renders it. Artifacts still take
  precedence when present.

### Misc
- Composer placeholder switches to "Ask a follow-up…" after an answer lands.
- `CLAUDE.md`: removed the "No native Node modules" guardrail; any
  well-maintained npm module (native or otherwise) is now fair game.
- `CLAUDE.md`: added a mandatory docs-update guardrail — every behavior change
  must land alongside an update to the right `docs/*.md` file.

## 2026-04-25 — initial Glance shell

### Acrylic material, tuned for white backgrounds
- All floating surfaces (`.glass`, `.glass-quiet`, `.ghost-btn`, plus a new
  `.acrylic` utility) use heavy blur + saturate for the frosted look.
- **`brightness(>100%)` intentionally removed** — it washed surfaces out to
  light gray on white backgrounds.
- Dark tint opacity raised to `0.82` on `.glass` / `0.72` on `.glass-quiet` /
  `0.8` on `.ghost-btn` so the pill stays readably dark regardless of what's
  behind it.
- Inner top highlight (+1px white 0.08) + bottom bevel (-1px black 0.3) give
  each surface a subtle "catching the light" feel.
- `.acrylic` utility adds an SVG noise-grain overlay at 35% opacity with
  `mix-blend-mode: overlay` for cards that want extra depth.
- Files: `apps/desktop/src/renderer/styles.css`.

### Shadow clipping — proper fix
- `HALO_MARGIN` (in `GlanceShell.tsx`) bumped `16 → 72`. This is the width of
  the transparent halo around every visible surface inside the Electron window
  — it must be ≥ the largest `box-shadow` reach, otherwise shadows clip at
  the window edge and render a sharp rectangle.
- Stage is now `pointer-events: none` with `[&>*]:pointer-events-auto`, so the
  larger halo doesn't swallow clicks on the apps underneath.

### Orb position persistence
- Added `Settings.panelPosition` + `DEFAULT_SETTINGS.panelPosition = null`.
- `panel.ts`:
  - `schedulePositionSave(x, y)` debounces (300ms) writes to `electron-store`.
  - `clampToDisplay(...)` ensures a restored position keeps at least 40px of
    the window on-screen.
  - `createPanelWindow` restores `settings.panelPosition` and sets
    `userRepositioned = true` so subsequent `showPanel(...)` calls don't
    re-anchor to bottom-right.
  - `updatePanelDrag` and content-resize both route through
    `schedulePositionSave`.
- Bug fix: `showPanel(...)` previously always called `anchorPanelToCursor` —
  now only when `!userRepositioned`. Prevents the saved/dragged position from
  being clobbered on every open.

### Chromeless transparent panel (macOS)
- `resizable: false`, `thickFrame: false`, `roundedCorners: false` added to the
  panel `BrowserWindow` options to kill the subtle native outline that was
  visible through the transparent window.
- Note: **do not re-enable `vibrancy: "under-window"`** — it paints a frosted
  fill across the full rectangular window.

### Manual dragging + window sizing
- Removed all `-webkit-app-region: drag` — it conflicts with animated /
  interactive targets.
- `pointerdown/move/up` handlers in renderer fire `PANEL_DRAG_START` /
  `PANEL_DRAG_MOVE` IPC; main translates to `win.setPosition(...)`. A small
  threshold distinguishes click from drag.
- `Stage` uses a `ResizeObserver` to push `setContentSize(w + halo*2, h +
  halo*2)` whenever content size changes. The BrowserWindow is always exactly
  as large as visible content (+ halo) — no invisible click-trap area.

### Orb-first default
- `app.whenReady()` unconditionally calls `showPanel({ mode: "just-ask" })`
  so the orb is visible on launch.
- Hotkeys, tray, and `second-instance` all pass `explicit: true` to expand
  the orb into the composer.

### Orb / thinking visuals
- Idle orb shrunk to 36px, tight halo, `orbBreathe` keyframes.
- Hover → `orbJelly` wobble + stronger halo.
- Click → `orbSquish`.
- Thinking blob: 58px with `thinkZoomIn` (0.45 → 1) entry, swirling
  multi-hue bloom, `thinkBreathe` pulse. Displays
  `Streaming · N chars` while `/artifact` streams.

### JSON-mode streaming for `/artifact`
- All chat providers got `chat_stream_json` and `chat_stream_multimodal_json`
  that pass `response_format: {"type": "json_object"}` via the shared
  `_openai_compat.stream_openai_compatible_chat(..., extra_payload=...)` hook.
- `routes/artifact.py` now returns `EventSourceResponse` with
  `meta` → `progress` → `artifact` → (`error` →) `done` events.
- Removed the legacy brace-counting fallback parser — JSON mode guarantees a
  single parseable object.
- Mock provider streams a plausible JSON shape so the full UX demoes offline.

### Renderer API
- `runArtifact(opts)` in `lib/api.ts` now uses `postSse` and exposes
  `onMeta` / `onProgress` callbacks. Resolves with `ArtifactResponse`.
- Session store gained `activeArtifact`, message kinds extended with optional
  `artifact` / `action` fields.

## Earlier work (pre-this-branch)

See commit 110830b for the initial rebrand and the baseline Phases 1–4 work
(hotkeys, SSE chat, region capture, vision, image gen, presets, session
memory, settings, history).
