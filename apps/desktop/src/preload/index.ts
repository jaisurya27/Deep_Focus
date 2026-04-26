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
  },
  overlay: {
    onStart(listener: (payload: { display: Electron.Rectangle; captureSize: { width: number; height: number } }) => void) {
      const wrapped = (_e: unknown, payload: Parameters<typeof listener>[0]) =>
        listener(payload);
      ipcRenderer.on(IPC.OVERLAY_START, wrapped);
      return () => ipcRenderer.removeListener(IPC.OVERLAY_START, wrapped);
    },
    /**
     * Pull the cached start payload from main. Used on renderer mount so a
     * React StrictMode double-mount (which happens in dev) never misses the
     * push event from `OVERLAY_START`.
     */
    async requestStart(): Promise<
      | { display: Electron.Rectangle; captureSize: { width: number; height: number } }
      | null
    > {
      return ipcRenderer.invoke(IPC.OVERLAY_REQUEST_START);
    },
    complete(rect: { x: number; y: number; width: number; height: number }) {
      ipcRenderer.send(IPC.OVERLAY_COMPLETE, rect);
    },
    cancel() {
      ipcRenderer.send(IPC.OVERLAY_CANCEL);
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
};

contextBridge.exposeInMainWorld("deepFocus", api);

export type DeepFocusAPI = typeof api;
