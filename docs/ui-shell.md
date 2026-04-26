# UI shell — Glance panel

This doc covers `apps/desktop/src/renderer/shell/GlanceShell.tsx`,
`apps/desktop/src/main/windows/panel.ts`, and `apps/desktop/src/renderer/styles.css`.
These files together implement the floating-orb experience that is the
defining visual of Glance.

## The two states (+ stacked surfaces)

| State | Visual | Trigger |
| --- | --- | --- |
| **Collapsed** | 36px emerald orb with breathing gradient and halo | default; after `minimizeShell` (composer ×, Esc) |
| **Expanded** | Stack of glass surfaces at 520px wide: drag-grip · (optional notice banner) · (optional context chip) · (smart crumbs OR streaming surface) · composer OR inline-thinking | click the orb, `showPanel({ explicit: true })`, or new context from a hotkey |

Transitions: `popIn` for the composer, `riseIn` for the answer / artifact
card, `orbJelly` wobbles the orb on hover, `orbSquish` squishes it on click,
`slideDown` for the drag grip / context chip / notice / crumbs,
`aurora-breathe` + `aurora-spin` + `aurora-pulse` for the thinking bead.

### Streaming surfaces

While a turn is in flight, the expanded panel shows, top to bottom:

1. **Context chip** — stays visible so the user can see which selection /
   image the turn is about.
2. **`FloatingAnswer`** — plain-text assistant output. Rendered as a
   scrollable card (`whitespace-pre-wrap`, max-h 360px) that autoscrolls to
   the newest token. While `streaming` is true it wears a traveling
   conic-gradient border (`.glance-streaming-border` + `@property --angle`
   animation) and a blinking emerald caret (`.glance-caret`).
3. **`StreamingShimmer`** — 3 pulsing bars. Shown only in the beat between
   request-sent and first-token (when `FloatingAnswer` has nothing yet).
4. **`InlineThinking`** — replaces the composer while streaming. `aurora-bead`
   (30px sphere with a conic halo + multi-radial pulse + breathe) + live
   label + char counter + `Stop` button (Esc also aborts).

When a plain-text answer finishes, `FloatingAnswer` stays and the composer
comes back with placeholder "Ask a follow-up…". Artifact replies (structured
JSON) are rendered by `FloatingArtifact` instead and take precedence over
`FloatingAnswer`.

### Smart crumbs (context-aware quick prompts)

`SmartCrumbs` replaces the earlier category-grouped `ActionChips`. Given a
pending selection and/or image, it produces 3–5 one-tap prompts via heuristic:

- Code-ish selection (by `sourceApp` or content signal: `{};`, `=>`,
  `function`, `def`, `Traceback`, `error:`, …) → "Explain this code",
  "Diagnose error" (on error-looking text) or "Find bugs", "Improve".
- Prose selection → "Explain", "TL;DR" (if long), "What does this mean?",
  "Translate → English" (on non-ASCII), "Simplify", "Summarize link" (if URL).
- Image → "Describe", "Extract text", "Translate → English", "Explain",
  "What should I do?".

A crumb click fills the composer draft and auto-sends via `sendText()`. No
backend schema change — crumbs just emit free-form text prompts.

## Window geometry — content-driven sizing

The Electron window is transparent, and the window's own rectangle *clips*
box-shadows. So the BrowserWindow must be exactly `content + halo` at all
times. How:

1. `Stage` wraps the visible UI in a `pointer-events: none` container with
   `width: fit-content` and an inline `margin: HALO_MARGIN`.
2. A `ResizeObserver` on that container fires whenever children change size.
3. On each observer tick, renderer calls
   `window.deepFocus.panel.setContentSize(w + HALO*2, h + HALO*2)`.
4. Main's `IPC.PANEL_SET_CONTENT_SIZE` handler calls `panel.setContentSize(...)`.

Direct consequences:

- There is **no invisible click-trap** around the UI. The window is never
  larger than needed.
- `HALO_MARGIN = 72` (in `GlanceShell.tsx`) — must be ≥ the largest
  `box-shadow` reach of any floating surface, otherwise shadows clip.
- `pointer-events: none` on the Stage (with `pointer-events: auto` on direct
  children via `[&>*]:pointer-events-auto`) means the halo around each child
  doesn't swallow clicks on the app underneath.

## Dragging

`-webkit-app-region: drag` is NOT used. It clashes with hover animations and
makes click-vs-drag unreliable on a draggable-and-clickable target.

Instead, `DraggableOrb` and the expanded wrapper use `useWindowDragHandlers`:

1. `pointerdown` → store start position + `IPC.PANEL_DRAG_START(mouseX, mouseY)`.
2. `pointermove` → if traveled > threshold, fire `IPC.PANEL_DRAG_MOVE(mx, my)`.
3. `pointerup` → if never crossed threshold, treat as a click (open/close).

Main side (`panel.ts`):

- `beginPanelDrag(mx, my)` captures the window's current `(winX, winY)`.
- `updatePanelDrag(mx, my)` moves the window by the mouse delta.
- On every move, `schedulePositionSave(x, y)` debounces a 300ms write to
  `electron-store` at `settings.panelPosition`.

## Position persistence

- **Save:** every drag move & every user-anchored content resize, debounced.
- **Restore:** on `createPanelWindow`, reads `getSettings().panelPosition`.
  If present, clamps to nearest display work area (`clampToDisplay`) so an
  offscreen position can't strand the orb, and sets `userRepositioned = true`.
- **Sticky:** `showPanel(...)` only auto-anchors to bottom-right on *first
  ever* launch. Once `userRepositioned` is true (drag OR restore), the window
  keeps its position across show/hide cycles.
- **Resize while anchored:** `resizePanelContent` grows/shrinks the window
  around the bottom-right corner so the user's chosen resting spot stays
  where they put it.

## Chromeless transparent window (macOS)

`BrowserWindow` options on macOS:

```ts
frame: false,
transparent: true,
hasShadow: false,
resizable: false,       // kills macOS's subtle resize-chrome outline
thickFrame: false,      // Windows hint, harmless on mac
roundedCorners: false,  // kill the subtle mac auto-rounded window outline
backgroundColor: "#00000000",
```

These flags together guarantee nothing paints except our own surfaces. Without
`roundedCorners: false`, macOS draws a faint rounded rectangle even on fully
transparent windows, and box-shadows clip visibly at that outline.

**Do not add `vibrancy: "under-window"`** — it paints a frosted fill across the
entire transparent window, breaking the floating-orb look.

## Acrylic material

`styles.css` defines three tiers of frosted surface:

| Class | Where | Spec |
| --- | --- | --- |
| `.glass` | composer pill, context chip, action chips, drag grip | `blur(40px) saturate(180%)` + `rgba(8,12,22, 0.82)` + top highlight + bottom bevel + drop shadow |
| `.glass-quiet` | artifact cards | `blur(36px) saturate(170%)` + `rgba(8,12,22, 0.72)` + softer bevel + longer shadow |
| `.ghost-btn` | floating action buttons under artifacts | `blur(28px) saturate(170%)` + `rgba(8,12,22, 0.8)` + pill shape |
| `.acrylic` (utility) | reserved for extra-frosty cards | `.glass` base + SVG noise grain overlay at 35% opacity overlay blend |

Design rules:

- **No `brightness(>100%)`.** It washes surfaces to light gray on white
  backgrounds. The dark tint alone handles contrast.
- **Tint opacity ≥ 0.72.** Below that, readability dies on light desktops.
- **Inner top highlight (+1px white 0.08).** Makes the surface catch "light".
- **Inner bottom shadow (-1px black 0.3).** Subtle bevel, sells it as solid.
- **Drop shadow** is what makes the pill feel *floating*. Its reach dictates
  `HALO_MARGIN`. If you change the drop shadow's blur/offset, bump halo too.

## Shell anatomy (expanded state)

Stack, top-down:

1. **Header row** — a single horizontal ribbon above everything. Left
   slot: `ArtifactActionRail` (Copy / Follow-up / Full chat / Dismiss),
   rendered only when an artifact is on screen. Right slot: the `TopBar`
   (drag handle + ×), always present. All seven pills are `h-6 w-6`
   glass pills with 14px SVGs — a whisper-quiet row, not a toolbar. Each
   action button expands to reveal an uppercase label on hover/focus.
   The × calls `minimizeShell` which aborts any in-flight turn, calls
   `clearOutput()`, then collapses. Works mid-stream.
2. **Optional banners** — `healthWarning`, `panelNotice`.
3. **Optional context chip** — selection/image preview (hidden once an
   artifact is on screen).
4. **Smart crumbs** — heuristic one-tap prompts for the current context.
5. **Output slot** — `FloatingArtifact` (structured) or `FloatingAnswer`
   (text); only one at a time. The artifact body is just the card now;
   its actions live in the header row above.
6. **Composer** — always rendered. Doubles as the thinking surface during a
   turn (see below).

There is no separate "thinking" blob / aurora surface anymore. The
composer IS the thinking surface — streaming === traveling emerald border
+ disabled textarea + Send→Stop button swap.

## Dismiss gestures (two tiers + one hard reset)

We used to have one universal `minimizeShell` wired to every ×. Problem: the
artifact's "Dismiss" button *felt* like "get rid of this answer" but actually
just collapsed the shell, and the answer came right back when the user
tapped the orb again. The taxonomy is now:

**1. Minimize the shell (collapse to orb).** Aborts any in-flight turn,
clears current output, collapses. Session id + provider label persist.

- `×` on the `TopBar` (always available, including mid-stream).
- `Esc` key (if not currently streaming; during stream, Esc = Stop then
  another Esc = collapse).

**2. Clear the output (keeps session id, keeps shell open).** Drops
`messages`, `pendingSelection`, `pendingImage` from the store via
`clearOutput()`. Shell stays expanded with a blank composer.

- Composer `×` when there's output on screen and the draft is empty.
- Composer `×` when the draft is non-empty clears the *draft*, not the
  output — tap again to clear the output.
- `×` ("Dismiss") on `FloatingArtifact`.
- `×` on `FloatingAnswer` (hidden while streaming).
- Automatically fired from the `onOpen` IPC handler on every new selection
  or region capture, so a fresh capture never shows the previous turn's
  output.

**3. Stop (abort an in-flight turn).** Composer's Send button morphs into a
rose Stop button while `streaming === true`. Calls `abortRef.current.abort()`.
Same thing Esc does mid-stream.

**4. Hard reset (`Cmd+K`).** `useSession.getState().clear()` — wipes messages,
session id, pending context, panel notice. Use this when you want a truly
new conversation.

The auto-expand `useEffect` does NOT expand on `hasContext` alone; it only
expands on explicit triggers (`explicit: true` from IPC, a `panelNotice`, or
a streaming start). This is what lets a minimized-with-context panel actually
stay minimized.

## Notice banners

When main wants to tell the user something went wrong (today: missing
Screen-Recording permission; soon: rate-limit / backend-down), it opens the
panel with a `notice` in `PanelOpenPayload`:

```ts
notice: {
  tone: "info" | "warn" | "error",
  title: string,
  body?: string,
  action?: { label: string; href: string },  // renderer maps to shell.openExternal
}
```

The renderer stores it in `panelNotice`, renders `NoticeBanner` at the top of
the stack, and dismisses it only via `minimizeShell`. Don't add a per-banner
close button — that re-introduces the "four different dismiss gestures"
problem we just fixed.

## Smart-context auto-fulfill loop

Free-form prompts like "what am I looking at?" used to land as a generic
`answer` with the model apologizing for not being able to see the screen.
The composer now runs `runAuto(...)` through a two-sided loop that can
automatically collect missing signals on the user's behalf.

**Fast path.** Before every submit, `GlanceShell` runs the prompt through
`VISUAL_INTENT_RE` (kept in sync with the backend's heuristic). If it
matches and no image is attached yet, we call
`window.deepFocus.capture.fullscreen()` *before* shipping the turn and
attach the result as `pendingImage`. No round-trip, no visible flicker
beyond the ~60 ms panel-hide during the grab.

**Slow path.** After any `runArtifact` response, if
`artifact.kind === "needs_context"` (a meta-artifact emitted by the
backend router when it decides it needs more signal to answer), the
shell:

1. Fulfills each declared `need` — currently `"screenshot"`, with
   `"selection"` / `"active_window"` reserved for future hooks.
2. Calls `removeMessages([userMsg.id, assistantMsg.id])` to drop the
   placeholder turn so the transcript doesn't accumulate
   "thinking…"→"needs_context"→"thinking again…" pairs.
3. Re-enters `runAuto(retryInstruction, { preferImageDataUrl, _retryDepth: 1 })`
   with the freshly captured signal.

Retries are capped at depth 1 — a misbehaving model that keeps asking
for context gets its `needs_context` artifact rendered as a
`NeedsContextCard` instead, with a clean explanation of what's still
missing. The same card is shown if we can't fulfill (permission denied):
the shell also surfaces the Screen-Recording `NoticeBanner` with a deep
link to System Settings.

Extending the loop to new signals is a three-touch change: (1) teach
`captureFullScreen` (or add a sibling helper) to produce the signal,
(2) add a case in `GlanceShell`'s `needs.has(...)` block to attach it,
(3) teach the backend router when to request it. The shared artifact
type (`NeedsContextArtifact` in `apps/desktop/src/shared/artifacts.ts`)
already allows arbitrary `needs[]` strings.

## Key files

- `apps/desktop/src/renderer/shell/GlanceShell.tsx`
- `apps/desktop/src/main/capture/fullscreen.ts`
- `apps/desktop/src/main/windows/panel.ts`
- `apps/desktop/src/main/ipc.ts` (handlers for `PANEL_SET_CONTENT_SIZE`,
  `PANEL_DRAG_START`, `PANEL_DRAG_MOVE`)
- `apps/desktop/src/preload/index.ts` (exposes `setContentSize`, `dragStart`,
  `dragMove`)
- `apps/desktop/src/shared/ipc.ts` (channel enum + `Settings.panelPosition`)
- `apps/desktop/src/renderer/styles.css`
