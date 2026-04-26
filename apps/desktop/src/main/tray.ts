import { app, Menu, Tray, nativeImage, NativeImage } from "electron";

import { startRegionCapture } from "./capture/region";
import { getSettings } from "./settings";
import { openHistoryWindow } from "./windows/history";
import { openSettingsWindow } from "./windows/settings";
import { showPanel } from "./windows/panel";

let tray: Tray | null = null;

/**
 * Start with an empty native image and pair it with a visible text title.
 * This guarantees the tray is always findable on the menu bar, even before
 * we ship a proper .icns asset.
 */
function buildInlineTrayIcon(): NativeImage {
  const icon = nativeImage.createEmpty();
  if (process.platform === "darwin") {
    icon.setTemplateImage(true);
  }
  return icon;
}

export function createTray() {
  if (tray) return tray;
  tray = new Tray(buildInlineTrayIcon());
  tray.setToolTip("Deep Focus — Cmd+Ctrl+J to ask");
  // Visible text label next to the (empty) icon — makes the tray
  // impossible to miss on a crowded menu bar.
  if (process.platform === "darwin") {
    tray.setTitle(" DF");
  }

  const rebuildMenu = () => {
    if (!tray) return;
    const settings = getSettings();
    const { justAsk, regionCapture } = settings.hotkeys;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: `Ask / Explain Selection  (${justAsk})`,
          click: () => showPanel({ mode: "just-ask" }),
        },
        {
          label: `Capture Region  (${regionCapture})`,
          click: () => {
            void startRegionCapture();
          },
        },
        { type: "separator" },
        {
          label: "Session History…",
          click: () => {
            void openHistoryWindow();
          },
        },
        {
          label: "Settings…",
          click: () => {
            void openSettingsWindow();
          },
        },
        { type: "separator" },
        {
          label: "About Deep Focus",
          click: () => app.setAboutPanelOptions({ applicationName: "Deep Focus" }),
        },
        { role: "quit", label: "Quit Deep Focus" },
      ]),
    );
  };

  // Clicking the tray icon itself surfaces the panel in just-ask mode.
  tray.on("click", () => showPanel({ mode: "just-ask" }));
  rebuildMenu();
  return tray;
}

export function destroyTray() {
  tray?.destroy();
  tray = null;
}
