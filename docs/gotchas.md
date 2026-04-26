# Gotchas — don't undo these

Hard-won details. Every bullet here represents a bug that bit us or a change
that must not be reverted without a better replacement.

## Transparent window & acrylic

- **Do NOT re-enable `vibrancy: "under-window"`** on the panel BrowserWindow.
  It paints a frosted fill across the entire rectangular window, which
  completely breaks the floating-orb look (a giant hazy rectangle appears
  around everything).
- **Do NOT remove `resizable: false` / `thickFrame: false` /
  `roundedCorners: false`** on macOS. Without them, macOS draws a faint
  rounded rectangle around the "transparent" window, which visibly clips
  box-shadows.
- **Do NOT add `backdrop-filter: brightness(>100%)`** to acrylic surfaces.
  It amplifies whatever's behind the window; on a white desktop, the surface
  washes to light gray and text contrast collapses. We fixed this once,
  don't reintroduce it.
- **`HALO_MARGIN` must be ≥ the widest `box-shadow` reach** of any visible
  surface. If you crank up a drop shadow, bump halo. Currently 72px; the
  composer's shadow is `0 20px 50px -18px rgba(0,0,0,0.8)` = ~52px total reach.

## Dragging / clicks / hover

- **Do NOT use `-webkit-app-region: drag`.** We tried; it collides with hover
  animations (the cursor moves off the animating pixel and the browser
  loses the hover state, making the orb "blink"), and it's flaky for
  click-vs-drag disambiguation on a small target. Use the manual
  `pointerdown/move/up` + IPC flow.
- **Do NOT toggle `win.setIgnoreMouseEvents(true, { forward: true })`** on
  hover. It was the source of the blinking-orb bug in a prior iteration. The
  replacement is dynamic window sizing: the window is exactly content +
  halo at all times, so there's nothing to pass clicks through.
- **Stage must be `pointer-events: none`** with `pointer-events: auto` on its
  direct children. Otherwise the 72px halo swallows clicks on whatever is
  underneath Glance.

## Position persistence

- **`showPanel(...)` must not call `anchorPanelToCursor(...)` when
  `userRepositioned` is true.** Previously it always re-anchored, silently
  erasing the user's drag / restored position on every open. See
  `panel.ts:showPanel`.
- **Always clamp a restored position to the current display work area.** A
  monitor change between sessions can otherwise leave the orb stranded.

## Artifact framework

- **All providers must implement `*_json` methods.** The `/artifact` route
  depends on JSON mode and does not have a fallback brace-counter anymore.
  If you add a provider, wire JSON mode or the endpoint 500s.
- **Keep `ArtifactResponse` types in sync between backend and frontend.**
  - `services/backend/app/artifacts.py` (Python schemas + system prompts)
  - `apps/desktop/src/shared/artifacts.ts` (TS types)
  - `apps/desktop/src/renderer/artifacts/ArtifactCard.tsx` (renderer cases)

## Naming / identifiers

- **Do NOT mass-rename `deep-focus` → `glance`** in code. IPC channel names,
  the `window.deepFocus.*` preload bridge, Electron bundle paths, and
  persisted settings keys all depend on it. The rename is *visible UI only*.

## Platform specifics

- **`ELECTRON_RUN_AS_NODE`** must be unset. `pnpm dev:desktop` scrubs it via
  `cross-env` — don't invoke the dev binary without that scrub.
- **macOS permissions**: Accessibility (first `Cmd+Ctrl+J`) and Screen
  Recording (first `Cmd+Ctrl+S`). The panel flows handle these with sentinel
  values in `PanelOpenPayload`.
- **Selected-text capture preserves the clipboard.** AppleScript
  (mac) / PowerShell (win) / xdotool|wtype (linux) snapshot-paste-restore.

## Mock mode

- **Mock mode is first-class.** Every new flow must render in mock mode too.
  Don't ship a feature that only works with real keys — the live demo needs
  a fallback if the conference wifi dies.

## Everything we haven't messed with but should remember

- Session store is in-memory with 14-day purge. SQLite migration is
  explicitly deferred.
- Renderer only ever talks to `127.0.0.1:8765`. No direct xAI/OpenAI calls
  from the renderer. No exceptions.
