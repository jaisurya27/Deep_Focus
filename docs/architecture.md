# Architecture

## Process topology

```
┌─────────────────────────────────────────────────────────┐
│  Electron main (Node)                                   │
│  apps/desktop/src/main/                                 │
│                                                         │
│   ┌─ tray.ts            menu-bar icon                   │
│   ┌─ hotkeys.ts         global shortcuts                │
│   ┌─ ipc.ts             IPC registry                    │
│   ┌─ settings.ts        electron-store + safeStorage    │
│   ┌─ windows/                                           │
│   │    panel.ts         THE orb/panel window            │
│   │    overlay.ts       region capture                  │
│   │    history.ts       chat log window                 │
│   │    settings.ts      settings window                 │
│   └─ capture/, context/ shellout helpers                │
│                                                         │
└────────────┬──────────────────────────┬─────────────────┘
             │ contextBridge            │ child_process.fork
             ▼                          ▼
┌───────────────────────────┐   ┌─────────────────────────┐
│ Renderer (Chromium)       │   │ FastAPI sidecar          │
│ apps/desktop/src/renderer │   │ services/backend         │
│                           │   │ 127.0.0.1:8765           │
│  panel.html  → GlanceShell│   │                          │
│  history.html→ history    │   │  /chat          SSE text │
│  settings.html→ settings  │   │  /chat/vision   SSE mm   │
│  overlay.html → overlay   │   │  /image         JSON     │
│                           │   │  /artifact      SSE JSON │
│  window.deepFocus.*  ◄────┼───┤  /session       list/get │
│  (preload exposes API)    │   │  /health                 │
└───────────┬───────────────┘   └─────────┬───────────────┘
            │ fetch /SSE                   │ httpx
            └───────► 127.0.0.1:8765 ◄─────┘
                                           │
                                           ▼
                              xAI / OpenAI / mock (provider)
```

Three processes:

1. **Electron main** — manages windows, hotkeys, the tray, IPC, settings,
   and spawns the backend on start.
2. **Renderer** — four independent React trees, one per HTML entry
   (`panel`, `history`, `settings`, `overlay`). They communicate with main
   only through `window.deepFocus.*` (preload bridge).
3. **FastAPI sidecar** — the only thing that talks to xAI/OpenAI. The
   renderer *never* speaks to model APIs directly; keys never enter the
   renderer process.

## Data flow: a typical artifact request

1. User triggers a hotkey or clicks the orb.
2. Main collects context (selected text + active-window info) and fires
   `IPC.PANEL_OPEN` with payload `{explicit, selection, image_data_url, …}`.
3. Renderer (`GlanceShell.tsx`) receives payload via
   `window.deepFocus.panel.onOpen(...)`, shows the composer, and seeds
   `pendingSelection` / `pendingImage` in the Zustand store.
4. User picks an action (or types text + hits send).
5. `runArtifact(...)` in `lib/api.ts` POSTs to `127.0.0.1:8765/artifact` and
   parses an SSE stream (`meta`, `progress`, `artifact`, `error`, `done`).
6. Backend `routes/artifact.py` picks a system prompt from `app/artifacts.py`
   and streams from the active provider with JSON-mode enabled
   (`response_format: {"type": "json_object"}`).
7. Renderer appends the artifact as an assistant message and pops a
   `FloatingArtifact` above the composer. Stage's `ResizeObserver` tells
   main to grow the BrowserWindow to fit the new content.

## Module responsibilities

### Electron main

- **`index.ts`** — boot sequence. Unconditionally shows the orb on launch
  (`showPanel({mode: "just-ask"})`).
- **`windows/panel.ts`** — the only window with non-trivial logic:
  - transparent, frameless, no native chrome on macOS
  - dynamic content-size driven by renderer IPC
  - manual drag via pointer-event IPCs
  - position persistence via `electron-store`, clamped to current display
- **`ipc.ts`** — thin router of handlers, delegates to modules in
  `main/capture/`, `main/context/`, `main/windows/*`.
- **`hotkeys.ts` / `tray.ts`** — every `showPanel` call passes
  `explicit: true` so the orb expands into the composer.

### Renderer

- **`shell/GlanceShell.tsx`** — state machine for collapsed / thinking /
  expanded; contains `Stage` (ResizeObserver → IPC window sizing),
  `DraggableOrb` (pointer → IPC window drag), `FloatingComposer`, and
  `FloatingArtifact`.
- **`artifacts/ArtifactCard.tsx`** — per-kind renderers with a generic
  fallback card.
- **`stores/session.ts`** — Zustand store holding `messages[]`,
  `pendingSelection`, `pendingImage`, `isStreaming`, `activeArtifact`.
- **`lib/api.ts`** — fetch + SSE wrappers; `postSse` is the workhorse.

### Backend

- **`routes/*`** — FastAPI routers; `artifact.py` is the interesting one
  (SSE, JSON-mode streaming, schema selection).
- **`providers/*`** — implement Protocols in `base.py`. `_openai_compat.py`
  is the shared SSE helper; it accepts an `extra_payload` to flip JSON mode on.
- **`artifacts.py`** — action taxonomy, system-prompt templates, and the
  JSON schemas that the renderer types mirror.
- **`store/memory.py`** — trivial in-memory session store, 14-day purge.
