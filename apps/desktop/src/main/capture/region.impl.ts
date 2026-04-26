import {
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  screen,
  shell,
  systemPreferences,
  type Display,
  type Rectangle,
} from "electron";
import path from "node:path";

import { IPC, type WindowContext } from "../../shared/ipc";
import { showPanel, getPanelWindow } from "../windows/panel";

/**
 * Region capture on macOS requires Screen Recording permission. Without it,
 * `desktopCapturer.getSources` returns an empty list and the user gets silent
 * failure. We check before opening the overlay and route the user to System
 * Settings if access hasn't been granted.
 */
function ensureScreenRecordingPermission(): boolean {
  if (process.platform !== "darwin") return true;
  const status = systemPreferences.getMediaAccessStatus("screen");
  console.info(`[region] screen recording permission status="${status}"`);
  if (status === "granted") return true;

  // Show a modal dialog explaining what to do, with a button that opens the
  // correct System Settings pane directly.
  void dialog
    .showMessageBox({
      type: "warning",
      title: "Screen Recording permission needed",
      message: "Deep Focus needs Screen Recording access to capture a region.",
      detail:
        "macOS hides every window's content from desktopCapturer until this " +
        "is granted.\n\n" +
        "1. Click 'Open System Settings' below.\n" +
        "2. Toggle 'Electron' (or 'Deep Focus') on under Screen & System Audio Recording.\n" +
        "3. Quit and relaunch Deep Focus.",
      buttons: ["Open System Settings", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    })
    .then((res) => {
      if (res.response === 0) {
        void shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        );
      }
    });
  return false;
}

const PRELOAD_PATH = path.resolve(__dirname, "../preload/index.js");
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

type Pending = {
  windows: BrowserWindow[];
  resolve: () => void;
  windowContext: WindowContext | null | undefined;
};

type StartPayload = {
  display: Electron.Rectangle;
  captureSize: { width: number; height: number };
};

let pending: Pending | null = null;
let ipcWired = false;
// Keyed by webContents id so multi-display overlays each get the right display.
const startPayloadByContents = new Map<number, StartPayload>();

/**
 * Drops a dim, transparent BrowserWindow over every display so the user can
 * drag-select a rectangle. On mouseup the overlay sends us the rect; we
 * capture the host screen via `desktopCapturer`, crop to the rect with
 * `nativeImage.crop`, and hand the PNG off to the answer panel.
 */
export async function startRegionCapture(opts?: {
  windowContext?: WindowContext | null;
}): Promise<void> {
  console.info("[region] startRegionCapture called");
  if (pending) {
    console.warn("[region] capture already in flight — ignoring");
    return;
  }

  if (!ensureScreenRecordingPermission()) {
    console.warn(
      "[region] Screen Recording permission missing — aborting capture.",
    );
    return;
  }

  wireIpcOnce();

  // If the main panel is on top, it can intercept mouse events over its area
  // even though we dim the whole screen with the overlay. Hide it briefly for
  // the duration of the region capture so the overlay is the only thing
  // receiving clicks.
  const panel = getPanelWindow();
  const panelWasVisible = !!(panel && panel.isVisible());
  if (panelWasVisible) {
    console.info("[region] hiding panel during capture");
    panel!.hide();
  }

  const displays = screen.getAllDisplays();
  console.info(`[region] opening overlay across ${displays.length} display(s)`);
  const windows: BrowserWindow[] = [];

  await Promise.all(
    displays.map(async (display) => {
      const { bounds } = display;
      const win = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        fullscreenable: false,
        hasShadow: false,
        enableLargerThanScreen: true,
        show: false,
        backgroundColor: "#00000000",
        webPreferences: {
          preload: PRELOAD_PATH,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      win.setAlwaysOnTop(true, "screen-saver");
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setIgnoreMouseEvents(false);

      // Forward the overlay's console.info/warn/error messages to the main
      // terminal so we can see what the drag UI is doing without opening the
      // renderer DevTools (which would steal focus from the overlay).
      win.webContents.on("console-message", (_event, level, message) => {
        const tag = level === 2 ? "warn" : level === 3 ? "error" : "info";
        console.info(`[overlay-console:${tag}] ${message}`);
      });

      if (DEV_URL) {
        const sep = DEV_URL.endsWith("/") ? "" : "/";
        await win.loadURL(`${DEV_URL}${sep}overlay.html`);
      } else {
        await win.loadFile(
          path.resolve(__dirname, "../../dist/renderer/overlay.html"),
        );
      }
      // Cache the start payload so the renderer can pull it on mount — this
      // is race-free vs. pushing on `did-finish-load`, which can arrive before
      // React registers its listener (especially in dev under StrictMode).
      const startPayload: StartPayload = {
        display: bounds,
        captureSize: { width: bounds.width, height: bounds.height },
      };
      // Capture the id eagerly: by the time `closed` fires `win.webContents`
      // has been destroyed and touching any property on it throws
      // "Object has been destroyed".
      const contentsId = win.webContents.id;
      startPayloadByContents.set(contentsId, startPayload);
      win.on("closed", () => {
        startPayloadByContents.delete(contentsId);
      });

      win.once("ready-to-show", () => {
        console.info("[region] overlay ready-to-show — calling win.show()");
        win.show();
        win.focus();
      });
      win.webContents.once("did-finish-load", () => {
        console.info("[region] overlay did-finish-load — sending OVERLAY_START");
        win.webContents.send(IPC.OVERLAY_START, startPayload);
      });
      windows.push(win);
    }),
  );

  await new Promise<void>((resolve) => {
    pending = {
      windows,
      resolve,
      windowContext: opts?.windowContext ?? null,
    };
  });
}

function wireIpcOnce() {
  if (ipcWired) return;
  ipcWired = true;

  ipcMain.handle(IPC.OVERLAY_REQUEST_START, (event) => {
    const payload = startPayloadByContents.get(event.sender.id);
    if (payload) {
      console.info(
        `[region] overlay pulled start payload (contentsId=${event.sender.id})`,
      );
      return payload;
    }
    console.warn(
      `[region] overlay requested start payload but none cached (contentsId=${event.sender.id})`,
    );
    return null;
  });

  ipcMain.on(IPC.OVERLAY_COMPLETE, async (_event, payload: Rectangle) => {
    console.info(
      `[region] OVERLAY_COMPLETE received — rect=${JSON.stringify(payload)}`,
    );
    if (!pending) {
      console.warn("[region] no pending capture — ignoring OVERLAY_COMPLETE");
      return;
    }
    const ctx = pending;
    closeOverlay(ctx);

    try {
      const result = await captureRectFromScreen(payload);
      console.info(
        `[region] captured ${result.width}×${result.height}, dataUrl=${result.dataUrl.length} bytes`,
      );
      showPanel({
        mode: "region",
        anchor: result.anchor,
        imageDataUrl: result.dataUrl,
        width: result.width,
        height: result.height,
        windowContext: ctx.windowContext ?? null,
      });
    } catch (err) {
      console.error("[region] capture failed:", err);
      // Surface the error so the user isn't left staring at a dismissed overlay.
      void dialog.showMessageBox({
        type: "error",
        title: "Region capture failed",
        message:
          err instanceof Error ? err.message : "Unknown error while capturing screen.",
        detail:
          "This usually means Screen Recording permission is missing or the " +
          "display changed between overlay-open and capture.",
        buttons: ["OK"],
      });
    }
  });

  ipcMain.on(IPC.OVERLAY_CANCEL, () => {
    if (!pending) return;
    closeOverlay(pending);
  });
}

function closeOverlay(ctx: Pending) {
  if (pending !== ctx) return;
  pending = null;
  for (const w of ctx.windows) {
    try {
      w.close();
    } catch {
      /* noop */
    }
  }
  ctx.resolve();
}

/**
 * Translate a rect (in screen coords) to the actual pixels on the source
 * display, then crop a single-source desktopCapturer thumbnail to that rect.
 *
 * Handles Retina / fractional scaling: thumbnails come back in physical pixels,
 * so we multiply by the display's scale factor before cropping.
 */
async function captureRectFromScreen(rect: Rectangle): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  anchor: { x: number; y: number };
}> {
  // Find which display the rect belongs to.
  const display = screen.getDisplayNearestPoint({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  });

  // Ask for thumbnails the size of the full display in physical pixels.
  const scale = display.scaleFactor || 1;
  const thumbSize = {
    width: Math.round(display.bounds.width * scale),
    height: Math.round(display.bounds.height * scale),
  };
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: thumbSize,
  });
  if (sources.length === 0) {
    throw new Error(
      "desktopCapturer returned no screen sources — Screen Recording permission is likely missing.",
    );
  }
  const source = findSourceForDisplay(sources, display);
  if (!source) {
    throw new Error(
      `could not find a screen source for display ${display.id} (got ${sources.length} sources)`,
    );
  }

  const full = source.thumbnail;
  const localRect = {
    x: Math.round((rect.x - display.bounds.x) * scale),
    y: Math.round((rect.y - display.bounds.y) * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  };

  // Guard against zero-size rects + out-of-bounds clipping.
  const size = full.getSize();
  const safe = {
    x: Math.max(0, Math.min(localRect.x, size.width - 1)),
    y: Math.max(0, Math.min(localRect.y, size.height - 1)),
    width: Math.max(1, Math.min(localRect.width, size.width - localRect.x)),
    height: Math.max(1, Math.min(localRect.height, size.height - localRect.y)),
  };
  const cropped = full.crop(safe);

  // Downscale oversized captures before turning them into a base64 blob —
  // saves both request size and vision-model input cost.
  const resized = maybeResize(cropped, 1600);
  const dataUrl = resized.toDataURL();
  const finalSize = resized.getSize();
  return {
    dataUrl,
    width: finalSize.width,
    height: finalSize.height,
    anchor: { x: rect.x + rect.width, y: rect.y + rect.height },
  };
}

function maybeResize(img: Electron.NativeImage, maxEdge: number) {
  const size = img.getSize();
  const longest = Math.max(size.width, size.height);
  if (longest <= maxEdge) return img;
  const scale = maxEdge / longest;
  return img.resize({
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
    quality: "good",
  });
}

function findSourceForDisplay(
  sources: Electron.DesktopCapturerSource[],
  display: Display,
): Electron.DesktopCapturerSource | null {
  // Newer Electron exposes `display_id` on the source; fall back to order.
  const matchById = sources.find(
    (s) => (s as unknown as { display_id?: string }).display_id === String(display.id),
  );
  if (matchById) return matchById;
  return sources[0] ?? null;
}

// Silence "nativeImage imported but unused" if we remove the import later.
void nativeImage;
