/**
 * IPC channel names shared between main, preload, and renderer.
 * Keeping them in one place prevents typo drift.
 */

export const IPC = {
  // main → renderer
  PANEL_OPEN: "panel:open",
  PANEL_CLEAR: "panel:clear",
  PANEL_FOCUS_INPUT: "panel:focus-input",
  OVERLAY_START: "overlay:start",
  HISTORY_DATA: "history:data",

  // renderer → main
  PANEL_HIDE: "panel:hide",
  PANEL_READY: "panel:ready",
  SETTINGS_GET: "settings:get",
  SETTINGS_SET: "settings:set",
  BACKEND_URL_GET: "backend:url:get",
  OVERLAY_COMPLETE: "overlay:complete",
  OVERLAY_CANCEL: "overlay:cancel",
  CAPTURE_FULLSCREEN: "capture:fullscreen",
  HISTORY_OPEN: "history:open",
  HISTORY_LIST: "history:list",
  SETTINGS_OPEN: "settings:open",
  SETTINGS_SAVE_API_KEY: "settings:save-api-key",
  SETTINGS_GET_API_KEY_STATE: "settings:get-api-key-state",
  SETTINGS_CLEAR_HISTORY: "settings:clear-history",
  WINDOW_CONTEXT_GET: "window-context:get",
  PANEL_CLICK_THROUGH: "panel:click-through",
  PANEL_SET_CONTENT_SIZE: "panel:set-content-size",
  PANEL_DRAG_START: "panel:drag-start",
  PANEL_DRAG_MOVE: "panel:drag-move",
  OPEN_EXTERNAL: "shell:open-external",
} as const;

export type PanelMode = "just-ask" | "selection" | "region";

export type WindowContext = {
  title?: string | null;
  url?: string | null;
  appName?: string | null;
};

export type PanelOpenPayload = {
  mode: PanelMode;
  /** Anchor coordinates (pixels, screen-relative) if we have them. */
  anchor?: { x: number; y: number };
  /** Preset id to preload (phase 2+). */
  preset?: string | null;
  /** Verbatim selected/captured text (selection mode). */
  selectionText?: string | null;
  /** Base64-encoded PNG (region mode). Prefixed with data:image/png;base64,… */
  imageDataUrl?: string | null;
  /** Saved relative path (under userData/sessions/…) for the captured image. */
  imagePath?: string | null;
  /** Captured image dimensions in screen pixels. */
  width?: number;
  height?: number;
  /** Frontmost window context, populated when available. */
  windowContext?: WindowContext | null;
  /** App that owned the selection when the hotkey fired. */
  sourceApp?: string | null;
  /**
   * User intent flag. True when the user explicitly invoked Glance (hotkey,
   * tray click, "Just ask"). False/omitted for passive nudges like startup,
   * where we want to show only the idle orb.
   */
  explicit?: boolean;
  /**
   * Optional banner message to surface in the panel — used when the main
   * process wants to tell the user something went wrong (e.g. Screen
   * Recording permission missing) rather than silently bailing.
   */
  notice?: {
    tone: "info" | "warn" | "error";
    title: string;
    body?: string;
    /** Deep link the renderer can expose as a button. */
    action?: { label: string; href: string };
  } | null;
};

export type Settings = {
  backendUrl: string;
  hotkeys: {
    /** Smart hotkey: explains selected text if any, otherwise opens empty panel. */
    justAsk: string;
    regionCapture: string;
    toggleFocusMode: string;
    togglePanel: string;
  };
  launchOnStartup: boolean;
  focusModeEnabled: boolean;
  onboardingComplete: boolean;
  visionPreferred: "openai" | "xai" | "auto";
  /** Last user-chosen panel position in screen pixels. Null = auto-anchor. */
  panelPosition: { x: number; y: number } | null;
};

export const DEFAULT_SETTINGS: Settings = {
  backendUrl: "http://127.0.0.1:8765",
  hotkeys: {
    // Cmd+Ctrl+J: Chrome uses Cmd+Shift+J (downloads) and Cmd+Opt+J (devtools
    // console), but leaves Cmd+Ctrl+J alone. macOS system has no binding for
    // this combo either — safest modifier stack on the platform.
    justAsk: "Command+Control+J",
    regionCapture: "Command+Control+S",
    toggleFocusMode: "Command+Control+L",
    togglePanel: "Command+Control+H",
  },
  launchOnStartup: false,
  focusModeEnabled: false,
  onboardingComplete: false,
  visionPreferred: "auto",
  panelPosition: null,
};
