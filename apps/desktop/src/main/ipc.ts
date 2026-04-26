import { app, ipcMain, safeStorage, shell } from "electron";

import { IPC, type Settings } from "../shared/ipc";
import { captureFullScreen } from "./capture/fullscreen";
import { getActiveWindowContext } from "./context/active-window";
import { captureFullScreen } from "./capture/fullscreen";
import { getSettings, setSettings, getSecret, setSecret } from "./settings";
import { registerHotkeys } from "./hotkeys";
import { openHistoryWindow } from "./windows/history";
import { openSettingsWindow } from "./windows/settings";
import {
  beginPanelDrag,
  getPanelWindow,
  hidePanel,
  resizePanelContent,
  updatePanelDrag,
} from "./windows/panel";
import { clearAllSessionsRemote } from "./history";

export function registerIpc() {
  ipcMain.on(IPC.PANEL_HIDE, () => {
    hidePanel();
  });

  ipcMain.on(IPC.PANEL_CLICK_THROUGH, (_e, passthrough: boolean) => {
    const win = getPanelWindow();
    if (!win || win.isDestroyed()) return;
    if (passthrough) {
      win.setIgnoreMouseEvents(true, { forward: true });
    } else {
      win.setIgnoreMouseEvents(false);
    }
  });

  ipcMain.on(
    IPC.PANEL_SET_CONTENT_SIZE,
    (_e, payload: { width: number; height: number }) => {
      if (!payload) return;
      resizePanelContent(payload.width, payload.height);
    },
  );

  ipcMain.on(
    IPC.PANEL_DRAG_START,
    (_e, payload: { mouseX: number; mouseY: number }) => {
      if (!payload) return;
      beginPanelDrag(payload.mouseX, payload.mouseY);
    },
  );

  ipcMain.on(
    IPC.PANEL_DRAG_MOVE,
    (_e, payload: { mouseX: number; mouseY: number }) => {
      if (!payload) return;
      updatePanelDrag(payload.mouseX, payload.mouseY);
    },
  );

  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings());

  ipcMain.handle(IPC.SETTINGS_SET, (_event, partial: Partial<Settings>) => {
    const next = setSettings(partial);
    if (partial.hotkeys) registerHotkeys();
    if (
      typeof partial.launchOnStartup === "boolean" &&
      (process.platform === "darwin" || process.platform === "win32")
    ) {
      app.setLoginItemSettings({ openAtLogin: partial.launchOnStartup });
    }
    return next;
  });

  ipcMain.handle(IPC.BACKEND_URL_GET, () => getSettings().backendUrl);

  ipcMain.handle(IPC.WINDOW_CONTEXT_GET, async () => {
    return getActiveWindowContext().catch(() => null);
  });

  ipcMain.handle(IPC.CAPTURE_FULLSCREEN, async () => {
    return captureFullScreen();
  });

  ipcMain.on(IPC.HISTORY_OPEN, () => {
    void openHistoryWindow();
  });

  ipcMain.on(IPC.SETTINGS_OPEN, () => {
    void openSettingsWindow();
  });

  ipcMain.handle(
    IPC.SETTINGS_SAVE_API_KEY,
    async (_e, payload: { provider: "xai" | "openai"; key: string }) => {
      if (!payload?.provider) return false;
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn("[settings] safeStorage unavailable; API keys not persisted");
        return false;
      }
      setSecret(payload.provider, payload.key);
      return true;
    },
  );

  ipcMain.handle(IPC.SETTINGS_GET_API_KEY_STATE, async () => {
    return {
      xai: Boolean(getSecret("xai")),
      openai: Boolean(getSecret("openai")),
    };
  });

  ipcMain.handle(IPC.SETTINGS_CLEAR_HISTORY, async () => {
    await clearAllSessionsRemote();
  });

  ipcMain.handle(IPC.CAPTURE_FULLSCREEN, async () => {
    return captureFullScreen();
  });

  ipcMain.on(IPC.OPEN_EXTERNAL, (_e, href: string) => {
    if (typeof href !== "string" || !href) return;
    // Allow http(s) and macOS System Settings deep links; refuse anything else
    // so a renderer-side bug can't be coerced into launching arbitrary URIs.
    const ok =
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("x-apple.systempreferences:");
    if (!ok) return;
    void shell.openExternal(href);
  });
}
