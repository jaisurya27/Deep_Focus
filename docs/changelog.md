# Changelog — current working branch

Chronological record of changes on top of the `Refactor: Deep Focus → Glance`
commit (110830b). When the branch ships, squash or re-organize into a proper
changelog.

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
