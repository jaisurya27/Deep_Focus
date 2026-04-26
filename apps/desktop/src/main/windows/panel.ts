import { BrowserWindow, screen } from "electron";
import path from "node:path";

import { IPC, type PanelOpenPayload } from "../../shared/ipc";

// When vite-plugin-electron builds everything into dist-electron/, the main
// process lives at dist-electron/main/index.js and the preload at
// dist-electron/preload/index.js. We resolve relative to this module's dir
// so the same code path works in dev and packaged builds.
const PRELOAD_PATH = path.resolve(__dirname, "../preload/index.js");

// In dev, Vite serves the renderer at http://localhost:5173. In prod, we load
// the built HTML from dist/renderer.
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

const PANEL_WIDTH = 480;
const PANEL_MARGIN = 16;

let panel: BrowserWindow | null = null;

export function getPanelWindow(): BrowserWindow | null {
  return panel;
}

export async function createPanelWindow(): Promise<BrowserWindow> {
  if (panel && !panel.isDestroyed()) return panel;

  const { workArea } = screen.getPrimaryDisplay();
  const maxHeight = Math.min(720, Math.floor(workArea.height * 0.85));

  panel = new BrowserWindow({
    width: PANEL_WIDTH,
    height: maxHeight,
    minWidth: 360,
    minHeight: 240,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    vibrancy: process.platform === "darwin" ? "under-window" : undefined,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Float above full-screen apps on macOS.
  panel.setAlwaysOnTop(true, "screen-saver");
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (DEV_URL) {
    // Vite dev server serves the renderer at this base URL.
    const sep = DEV_URL.endsWith("/") ? "" : "/";
    await panel.loadURL(`${DEV_URL}${sep}panel.html`);
  } else {
    // Packaged: dist-electron/main/index.js → ../../dist/renderer/panel.html
    const prodHtml = path.resolve(__dirname, "../../dist/renderer/panel.html");
    await panel.loadFile(prodHtml);
  }

  panel.on("closed", () => {
    panel = null;
  });

  panel.on("blur", () => {
    // Intentionally leave the panel visible on blur — users want it to stay
    // while they read the source doc. Esc or click-outside-to-dismiss is
    // opt-in (handled by the renderer).
  });

  return panel;
}

function anchorPanelToCursor(win: BrowserWindow, anchor?: { x: number; y: number }) {
  const point = anchor ?? screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const [w, h] = win.getSize();

  let x: number;
  let y: number;

  if (anchor) {
    // Anchor near the selection if provided.
    x = Math.min(point.x + PANEL_MARGIN, display.workArea.x + display.workArea.width - w - PANEL_MARGIN);
    y = Math.min(point.y + PANEL_MARGIN, display.workArea.y + display.workArea.height - h - PANEL_MARGIN);
  } else {
    // Otherwise dock to the right edge of the active display.
    x = display.workArea.x + display.workArea.width - w - PANEL_MARGIN;
    y = display.workArea.y + PANEL_MARGIN;
  }

  win.setPosition(Math.round(x), Math.round(y));
}

export async function showPanel(payload: PanelOpenPayload) {
  const win = await createPanelWindow();
  anchorPanelToCursor(win, payload.anchor);

  const fire = () => win.webContents.send(IPC.PANEL_OPEN, payload);

  // `showInactive` keeps keyboard focus on the source app until the user
  // explicitly clicks into the panel — per the UX spec.
  if (!win.isVisible()) {
    win.showInactive();
  } else {
    win.moveTop();
  }

  // Send once immediately (handles the "already loaded" case) and again
  // after the next paint (handles the "first launch, renderer still booting"
  // case where the message would otherwise land before the listener is set).
  fire();
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", fire);
  }
}

export function hidePanel() {
  if (panel && !panel.isDestroyed()) {
    panel.hide();
  }
}
