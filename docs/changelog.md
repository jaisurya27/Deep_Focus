# Changelog — current working branch

Chronological record of changes on top of the `Refactor: Deep Focus → Glance`
commit (110830b). When the branch ships, squash or re-organize into a proper
changelog.

## 2026-04-25

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
