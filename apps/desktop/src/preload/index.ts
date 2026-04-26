import { contextBridge, ipcRenderer } from "electron";

import {
  IPC,
  type PanelOpenPayload,
  type Settings,
  type WindowContext,
} from "../shared/ipc";

/**
 * Minimal, typed surface the renderer can use. Everything the renderer can
 * touch in the main process goes through this bridge — no nodeIntegration.
 */
const api = {
  panel: {
    onOpen(listener: (payload: PanelOpenPayload) => void) {
      const wrapped = (_e: unknown, payload: PanelOpenPayload) =>
        listener(payload);
      ipcRenderer.on(IPC.PANEL_OPEN, wrapped);
      return () => ipcRenderer.removeListener(IPC.PANEL_OPEN, wrapped);
    },
    hide() {
      ipcRenderer.send(IPC.PANEL_HIDE);
    },
    setClickThrough(passthrough: boolean) {
      ipcRenderer.send(IPC.PANEL_CLICK_THROUGH, passthrough);
    },
    setContentSize(width: number, height: number) {
      ipcRenderer.send(IPC.PANEL_SET_CONTENT_SIZE, { width, height });
    },
    dragStart(mouseX: number, mouseY: number) {
      ipcRenderer.send(IPC.PANEL_DRAG_START, { mouseX, mouseY });
    },
    dragMove(mouseX: number, mouseY: number) {
      ipcRenderer.send(IPC.PANEL_DRAG_MOVE, { mouseX, mouseY });
    },
  },
  overlay: {
    onStart(listener: (payload: { display: Electron.Rectangle; captureSize: { width: number; height: number } }) => void) {
      const wrapped = (_e: unknown, payload: Parameters<typeof listener>[0]) =>
        listener(payload);
      ipcRenderer.on(IPC.OVERLAY_START, wrapped);
      return () => ipcRenderer.removeListener(IPC.OVERLAY_START, wrapped);
    },
    complete(rect: { x: number; y: number; width: number; height: number }) {
      ipcRenderer.send(IPC.OVERLAY_COMPLETE, rect);
    },
    cancel(reason?: string) {
      ipcRenderer.send(IPC.OVERLAY_CANCEL, reason ?? null);
    },
  },
  history: {
    open() {
      ipcRenderer.send(IPC.HISTORY_OPEN);
    },
    onData(listener: (data: unknown) => void) {
      const wrapped = (_e: unknown, payload: unknown) => listener(payload);
      ipcRenderer.on(IPC.HISTORY_DATA, wrapped);
      return () => ipcRenderer.removeListener(IPC.HISTORY_DATA, wrapped);
    },
  },
  settings: {
    open() {
      ipcRenderer.send(IPC.SETTINGS_OPEN);
    },
    async get(): Promise<Settings> {
      return ipcRenderer.invoke(IPC.SETTINGS_GET);
    },
    async set(partial: Partial<Settings>): Promise<Settings> {
      return ipcRenderer.invoke(IPC.SETTINGS_SET, partial);
    },
    async saveApiKey(provider: "xai" | "openai", key: string): Promise<boolean> {
      return ipcRenderer.invoke(IPC.SETTINGS_SAVE_API_KEY, { provider, key });
    },
    async getApiKeyState(): Promise<{ xai: boolean; openai: boolean }> {
      return ipcRenderer.invoke(IPC.SETTINGS_GET_API_KEY_STATE);
    },
    async clearHistory(): Promise<void> {
      return ipcRenderer.invoke(IPC.SETTINGS_CLEAR_HISTORY);
    },
  },
  backend: {
    async url(): Promise<string> {
      return ipcRenderer.invoke(IPC.BACKEND_URL_GET);
    },
  },
  context: {
    async window(): Promise<WindowContext | null> {
      return ipcRenderer.invoke(IPC.WINDOW_CONTEXT_GET);
    },
  },
  capture: {
    /**
     * Grab the active display's current pixels (panel hidden from frame) and
     * return a downscaled data URL. Returns null if capture failed (permission
     * missing, desktopCapturer returned nothing, etc.) — callers should fall
     * back to a text-only request in that case.
     */
    async fullscreen(): Promise<
      | { dataUrl: string; width: number; height: number }
      | null
    > {
      return ipcRenderer.invoke(IPC.CAPTURE_FULLSCREEN);
    },
  },
  shell: {
    openExternal(href: string) {
      ipcRenderer.send(IPC.OPEN_EXTERNAL, href);
    },
  },
};

contextBridge.exposeInMainWorld("deepFocus", api);

export type DeepFocusAPI = typeof api;
