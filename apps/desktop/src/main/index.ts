import { app } from "electron";

import { createTray, destroyTray } from "./tray";
import { registerHotkeys, unregisterHotkeys } from "./hotkeys";
import { registerIpc } from "./ipc";
import { getSettings, setSettings } from "./settings";
import { createPanelWindow, showPanel, getPanelWindow } from "./windows/panel";

// Electron on macOS will keep the app alive via the tray. Hide the dock icon
// so Deep Focus feels like a system service instead of an app window.
if (process.platform === "darwin") {
  app.dock?.hide();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  const panel = getPanelWindow();
  if (panel) {
    showPanel({ mode: "just-ask", explicit: true });
  }
});

app.whenReady().then(async () => {
  await createPanelWindow();
  createTray();
  registerIpc();
  registerHotkeys();
  syncLoginItemState();

  app.on("window-all-closed", () => {
    // intentional no-op: tray keeps us alive
  });

  // Always show the idle orb on startup so users have a visible entry point.
  // The renderer starts in the collapsed "orb" state by default, so this just
  // positions the transparent window in the bottom-right and makes it visible.
  showPanel({ mode: "just-ask" });

  const settings = getSettings();
  if (!settings.onboardingComplete) {
    setSettings({ onboardingComplete: true });
  }
});

app.on("will-quit", () => {
  unregisterHotkeys();
  destroyTray();
});

function syncLoginItemState() {
  // setLoginItemSettings requires a signed, packaged .app bundle on macOS.
  // Skip silently in dev mode to avoid the "Operation not permitted" error.
  if (!app.isPackaged) return;
  const { launchOnStartup } = getSettings();
  if (process.platform === "darwin" || process.platform === "win32") {
    app.setLoginItemSettings({ openAtLogin: launchOnStartup });
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection", reason);
});
