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
import { showPanel } from "../windows/panel";

/**
 * Region capture on macOS requires Screen Recording permission. Without it,
 * `desktopCapturer.getSources` returns an empty list and the user gets silent
 * failure. We check before opening the overlay and route the user to System
 * Settings if access hasn't been granted.
 */
function ensureScreenRecordingPermission(): boolean {
  if (process.platform !== "darwin") return true;
  const status = systemPreferences.getMediaAccessStatus("screen");
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

let pending: Pending | null = null;
let ipcWired = false;

/**
 * Drops a dim, transparent BrowserWindow over every display so the user can
 * drag-select a rectangle. On mouseup the overlay sends us the rect; we
 * capture the host screen via `desktopCapturer`, crop to the rect with
 * `nativeImage.crop`, and hand the PNG off to the answer panel.
 */
export async function startRegionCapture(opts?: {
  windowContext?: WindowContext | null;
}): Promise<void> {
  if (pending) return; // already in flight

  if (!ensureScreenRecordingPermission()) {
    console.warn(
      "[region] Screen Recording permission missing — aborting capture.",
    );
    return;
  }

  wireIpcOnce();

  const displays = screen.getAllDisplays();
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

      if (DEV_URL) {
        const sep = DEV_URL.endsWith("/") ? "" : "/";
        await win.loadURL(`${DEV_URL}${sep}overlay.html`);
      } else {
        await win.loadFile(
          path.resolve(__dirname, "../../dist/renderer/overlay.html"),
        );
      }
      win.once("ready-to-show", () => win.show());
      win.webContents.once("did-finish-load", () => {
        win.webContents.send(IPC.OVERLAY_START, {
          display: bounds,
          captureSize: { width: bounds.width, height: bounds.height },
        });
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
