# IPC & preload bridge

The renderer is strictly sandboxed; it talks to main only through
`window.deepFocus.*` (exposed by `apps/desktop/src/preload/index.ts`). Channel
names and payload shapes live in `apps/desktop/src/shared/ipc.ts`.

## Channel catalog

| Channel | Direction | Payload | Purpose |
| --- | --- | --- | --- |
| `IPC.PANEL_OPEN` | main → renderer | `PanelOpenPayload { mode, explicit?, selection?, image_data_url?, window_context?, anchor?, notice?, … }` | Seed the panel when a hotkey/tray/open-from-code request arrives. `explicit: true` expands the orb into the composer. `notice` surfaces a warning/error banner (see below). |
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
| `IPC.OPEN_EXTERNAL` | renderer → main | `href: string` | Open a URL via Electron's `shell.openExternal`. Main allowlists `http://`, `https://`, and `x-apple.systempreferences:` — anything else is dropped. Used by `NoticeBanner`'s action button (e.g. deep-link to the Screen-Recording pane in System Settings). |
| `IPC.CAPTURE_OVERLAY_CANCEL` | renderer → main | `reason?: string` | Sent when the capture overlay bails (Esc, too-small, pointer-cancel). `reason` is logged by main to diagnose future regressions. |
| `IPC.CAPTURE_FULLSCREEN` | renderer → main (invoke) | — | Silently snaps the display under the cursor (no overlay UI). Main temporarily hides the panel window so the orb/composer don't appear inside the shot, then restores it. Returns `{ok:true, value:{dataUrl,width,height}}` or `{ok:false, error:{kind:"permission"\|"no-sources"\|"failed", …}}`. Used by the smart-context auto-fulfill loop — see `docs/changelog.md` 2026-04-25 entry. |

### `PanelOpenPayload.notice`

```ts
notice?: {
  tone: "info" | "warn" | "error";
  title: string;
  body?: string;
  action?: { label: string; href: string };   // href is handed to OPEN_EXTERNAL
} | null;
```

Today's only producer is `capture/region.impl.ts` when Screen Recording
permission is missing or a capture throws; future producers should funnel
backend-down / rate-limit warnings through the same channel instead of
adding new bespoke banners.

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
  capture: { startRegion(), fullscreen() },     // fullscreen() silently snaps the display under the cursor

  overlay: { complete(rect), cancel(reason?) },
  shell: { openExternal(href) },              // goes through OPEN_EXTERNAL allowlist
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
