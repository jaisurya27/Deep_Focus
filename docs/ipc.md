# IPC & preload bridge

The renderer is strictly sandboxed; it talks to main only through
`window.deepFocus.*` (exposed by `apps/desktop/src/preload/index.ts`). Channel
names and payload shapes live in `apps/desktop/src/shared/ipc.ts`.

## Channel catalog

| Channel | Direction | Payload | Purpose |
| --- | --- | --- | --- |
| `IPC.PANEL_OPEN` | main → renderer | `PanelOpenPayload { mode, explicit?, selection?, image_data_url?, window_context?, anchor?, … }` | Seed the panel when a hotkey/tray/open-from-code request arrives. `explicit: true` expands the orb into the composer. |
| `IPC.PANEL_HIDE` | renderer → main | — | Hide the panel window (does not destroy). |
| `IPC.PANEL_SET_CONTENT_SIZE` | renderer → main | `{ width, height }` | Resize the BrowserWindow to match visible content + halo. Fired continuously by `Stage`'s `ResizeObserver`. |
| `IPC.PANEL_DRAG_START` | renderer → main | `{ mouseX, mouseY }` (screen coords) | Begin a manual window drag. Main captures the current window position. |
| `IPC.PANEL_DRAG_MOVE` | renderer → main | `{ mouseX, mouseY }` (screen coords) | Move window by mouse delta; debounced-save to `electron-store`. |
| `IPC.CONTEXT_GET` | renderer → main | — | Returns active-window `{ app, title, url?, bundle_id? }`. |
| `IPC.CONTEXT_SELECTION` | renderer → main | — | Returns currently selected text (AppleScript / PowerShell / xdotool). |
| `IPC.CAPTURE_REGION_START` | renderer → main | — | Opens the capture overlay. |
| `IPC.SETTINGS_GET` / `IPC.SETTINGS_SET` | renderer ↔ main | `Partial<Settings>` | Read/write persisted settings (hotkeys, providers, `panelPosition`, …). |
| `IPC.SECRETS_SET` / `IPC.SECRETS_GET` | renderer ↔ main | — | `safeStorage`-backed API keys. |
| `IPC.OPEN_HISTORY` / `IPC.OPEN_SETTINGS` | renderer → main | — | Open the respective windows. |

## Preload API surface

```ts
window.deepFocus = {
  panel: {
    onOpen(cb),                         // subscribe to PANEL_OPEN
    hide(),                             // hide panel
    setContentSize(w, h),               // PANEL_SET_CONTENT_SIZE
    dragStart(mx, my),                  // PANEL_DRAG_START
    dragMove(mx, my),                   // PANEL_DRAG_MOVE
  },
  context: {
    getActiveWindow(), getSelection(),
  },
  capture: { startRegion() },
  settings: { get(), set(partial) },
  secrets: { get(name), set(name, val) },
  openHistory(), openSettings(),
};
```

(Exact shape in `apps/desktop/src/preload/index.ts` — keep it small and typed.)

## Settings schema

```ts
// apps/desktop/src/shared/ipc.ts
export type Settings = {
  hotkeys: { justAsk: string; captureRegion: string; togglePanel: string };
  chatProvider: "auto" | "xai" | "openai" | "mock";
  visionProvider: "auto" | "xai" | "openai" | "mock";
  imageProvider: "auto" | "xai" | "openai" | "mock";
  panelPosition: { x: number; y: number } | null;
};

export const DEFAULT_SETTINGS: Settings = {
  hotkeys: { justAsk: "CommandOrControl+Ctrl+J", … },
  chatProvider: "auto", visionProvider: "auto", imageProvider: "auto",
  panelPosition: null,
};
```

Persisted via `electron-store` in `apps/desktop/src/main/settings.ts`. Secrets
(`OPENAI_API_KEY`, `XAI_API_KEY`) go through `safeStorage`.
