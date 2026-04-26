import { BrowserWindow, screen } from "electron";
import path from "node:path";

import { IPC, type PanelOpenPayload } from "../../shared/ipc";
import { getSettings, setSettings } from "../settings";

// When vite-plugin-electron builds everything into dist-electron/, the main
// process lives at dist-electron/main/index.js and the preload at
// dist-electron/preload/index.js. We resolve relative to this module's dir
// so the same code path works in dev and packaged builds.
const PRELOAD_PATH = path.resolve(__dirname, "../preload/index.js");

// In dev, Vite serves the renderer at http://localhost:5173. In prod, we load
// the built HTML from dist/renderer.
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

const PANEL_WIDTH = 560;
const PANEL_MARGIN = 20;
const ORB_INITIAL_SIZE = 96; // enough for 36px orb + halo + some breathing room

let panel: BrowserWindow | null = null;
// Once the user drags the window (or we restore a saved position), we stop
// auto-anchoring to the bottom-right on every resize. They take the wheel.
let userRepositioned = false;
// Where the window was when a drag started, in screen coordinates.
let dragStart: { winX: number; winY: number; mouseX: number; mouseY: number } | null = null;
// Debounce settings writes while dragging.
let savePositionTimer: NodeJS.Timeout | null = null;

function schedulePositionSave(x: number, y: number) {
  if (savePositionTimer) clearTimeout(savePositionTimer);
  savePositionTimer = setTimeout(() => {
    savePositionTimer = null;
    setSettings({ panelPosition: { x: Math.round(x), y: Math.round(y) } });
  }, 300);
}

function clampToDisplay(x: number, y: number, w: number, h: number) {
  // Keep the WHOLE window inside the work area of the nearest display so a
  // saved or in-progress drag position can never leave the orb stranded
  // partially or fully off-screen.
  const nearest = screen.getDisplayNearestPoint({ x: x + w / 2, y: y + h / 2 });
  const wa = nearest.workArea;
  const minX = wa.x;
  const maxX = wa.x + wa.width - w;
  const minY = wa.y;
  const maxY = wa.y + wa.height - h;
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

function isFullyOnScreen(x: number, y: number, w: number, h: number) {
  const displays = screen.getAllDisplays();
  return displays.some((d) => {
    const wa = d.workArea;
    return (
      x >= wa.x &&
      y >= wa.y &&
      x + w <= wa.x + wa.width &&
      y + h <= wa.y + wa.height
    );
  });
}

/** Bottom-right of a display's work area (orb dock position). */
function bottomRightInWorkArea(
  workArea: Electron.Rectangle,
  w: number,
  h: number,
) {
  const x = workArea.x + workArea.width - w - PANEL_MARGIN;
  const y = workArea.y + workArea.height - h - PANEL_MARGIN;
  return clampToDisplay(
    Math.round(x),
    Math.round(y),
    w,
    h,
  );
}

/**
 * First-launch / no-saved-position: main monitor bottom-right, never (0,0).
 * Without explicit x,y, some Electron versions leave the window at the origin
 * until the first setPosition, which reads as a ball stuck in the top-left.
 */
function initialOrbPosition(w: number, h: number) {
  return bottomRightInWorkArea(screen.getPrimaryDisplay().workArea, w, h);
}

export function getPanelWindow(): BrowserWindow | null {
  return panel;
}

export async function createPanelWindow(): Promise<BrowserWindow> {
  if (panel && !panel.isDestroyed()) return panel;

  const { x: orbX, y: orbY } = initialOrbPosition(ORB_INITIAL_SIZE, ORB_INITIAL_SIZE);

  panel = new BrowserWindow({
    x: orbX,
    y: orbY,
    width: ORB_INITIAL_SIZE,
    height: ORB_INITIAL_SIZE,
    minWidth: 60,
    minHeight: 60,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    // `resizable: false` + `thickFrame: false` + `roundedCorners: false`
    // kill macOS's native window chrome that otherwise paints a faint
    // rounded rectangle even on fully transparent BrowserWindows. The
    // renderer handles its own rounded surfaces (glass pills, artifacts).
    resizable: false,
    thickFrame: false,
    roundedCorners: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
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

  // Forward the panel renderer's console messages to the main terminal so the
  // user can watch capture timings, provider fallbacks, IPC events, etc.
  // without opening the panel's DevTools (which steals focus from the
  // composer and from apps the user is reading behind the panel).
  panel.webContents.on("console-message", (_event, level, message) => {
    // Skip noisy devtools/vite/react infrastructure lines.
    if (
      message.startsWith("[vite]") ||
      message.includes("Download the React DevTools")
    ) {
      return;
    }
    const tag = level === 2 ? "warn" : level === 3 ? "error" : "info";
    console.info(`[panel-console:${tag}] ${message}`);
  });

  if (DEV_URL) {
    const sep = DEV_URL.endsWith("/") ? "" : "/";
    await panel.loadURL(`${DEV_URL}${sep}panel.html`);
  } else {
    const prodHtml = path.resolve(__dirname, "../../dist/renderer/panel.html");
    await panel.loadFile(prodHtml);
  }

  panel.on("closed", () => {
    panel = null;
  });

  // Always dock to the primary display's bottom-right on startup. Any saved
  // position from a previous session is overwritten — the user can still
  // drag mid-session, and that drag is persisted, but every fresh launch
  // begins anchored bottom-right so the orb can't appear stranded after a
  // monitor change, a (0,0) legacy save, or a stale off-screen position.
  const [w, h] = panel.getSize();
  const p = initialOrbPosition(w, h);
  panel.setPosition(p.x, p.y);
  setSettings({ panelPosition: { x: p.x, y: p.y } });
  userRepositioned = true;

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

  // `anchor` is kept in the signature for future "follow the cursor" UX but
  // intentionally ignored here to keep the orb in a stable resting spot.
  void anchor;

  // Glance docks to the BOTTOM-right of the display under the cursor. Clamped
  // so resizes on odd aspect ratios can’t strand the window off-screen.
  const { x, y } = bottomRightInWorkArea(display.workArea, w, h);
  win.setPosition(x, y);
}

export function resizePanelContent(width: number, height: number): void {
  if (!panel || panel.isDestroyed()) return;
  const clamped = {
    w: Math.max(60, Math.round(width)),
    h: Math.max(60, Math.round(height)),
  };

  if (userRepositioned) {
    // Grow/shrink around the window's current bottom-right corner so the
    // user's chosen position feels sticky as content changes size.
    const [curX, curY] = panel.getPosition();
    const [curW, curH] = panel.getSize();
    const rawX = Math.round(curX + (curW - clamped.w));
    const rawY = Math.round(curY + (curH - clamped.h));
    // Clamp so the orb can never be pushed fully off-screen by a resize.
    const { x: nextX, y: nextY } = clampToDisplay(rawX, rawY, clamped.w, clamped.h);
    panel.setContentSize(clamped.w, clamped.h);
    panel.setPosition(nextX, nextY);
    schedulePositionSave(nextX, nextY);
  } else {
    panel.setContentSize(clamped.w, clamped.h);
    anchorPanelToCursor(panel);
  }
}

export function beginPanelDrag(mouseX: number, mouseY: number): void {
  if (!panel || panel.isDestroyed()) return;
  const [winX, winY] = panel.getPosition();
  dragStart = { winX, winY, mouseX, mouseY };
}

export function updatePanelDrag(mouseX: number, mouseY: number): void {
  if (!panel || panel.isDestroyed() || !dragStart) return;
  const dx = mouseX - dragStart.mouseX;
  const dy = mouseY - dragStart.mouseY;
  userRepositioned = true;
  const nextX = Math.round(dragStart.winX + dx);
  const nextY = Math.round(dragStart.winY + dy);
  panel.setPosition(nextX, nextY);
  schedulePositionSave(nextX, nextY);
}

export async function showPanel(payload: PanelOpenPayload) {
  const win = await createPanelWindow();
  // Only auto-anchor to the bottom-right the first time. Once the user
  // has dragged (or we restored a saved position on boot), leave the
  // window where it is so it feels sticky across Esc/show/hide cycles.
  if (!userRepositioned) {
    anchorPanelToCursor(win, payload.anchor);
  }

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
