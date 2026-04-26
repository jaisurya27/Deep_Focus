# UI shell — Glance panel

This doc covers `apps/desktop/src/renderer/shell/GlanceShell.tsx`,
`apps/desktop/src/main/windows/panel.ts`, and `apps/desktop/src/renderer/styles.css`.
These files together implement the floating-orb experience that is the
defining visual of Glance.

## The three states

| State | Visual | Trigger |
| --- | --- | --- |
| **Collapsed** | 36px emerald orb with breathing gradient and halo | default; after Esc / after dismissing an artifact |
| **Thinking** | 58px Siri-style multi-hue bloom, shows `Streaming · N chars` | during an `/artifact` or `/chat` stream |
| **Expanded** | 520px composer pill (+ optional context chip, action bar, floating artifact) | click the orb, or `showPanel({ explicit: true })` |

Transitions: `popIn` for the composer, `thinkZoomIn` scales the thinking blob
from 0.45 → 1, `orbJelly` wobbles the orb on hover, `orbSquish` squishes it
on click, `riseIn` for the artifact card.

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

## Key files

- `apps/desktop/src/renderer/shell/GlanceShell.tsx`
- `apps/desktop/src/main/windows/panel.ts`
- `apps/desktop/src/main/ipc.ts` (handlers for `PANEL_SET_CONTENT_SIZE`,
  `PANEL_DRAG_START`, `PANEL_DRAG_MOVE`)
- `apps/desktop/src/preload/index.ts` (exposes `setContentSize`, `dragStart`,
  `dragMove`)
- `apps/desktop/src/shared/ipc.ts` (channel enum + `Settings.panelPosition`)
- `apps/desktop/src/renderer/styles.css`
