/**
 * Full-screen capture for "share-my-screen on every turn" chat mode.
 *
 * The whole display where the cursor currently lives is turned into a
 * downscaled PNG data URL and handed back to the renderer. The Deep Focus
 * panel is excluded from the frame by fading its opacity to zero for the
 * duration of the capture — this is noticeably cheaper than `hide()/show()`,
 * keeps keyboard focus on the composer, and produces a clean image because
 * the macOS compositor composites the panel at 0% alpha (so what's behind it
 * shows through).
 */
import {
  BrowserWindow,
  desktopCapturer,
  screen,
  systemPreferences,
  type Display,
} from "electron";

import { getPanelWindow } from "../windows/panel";

export type FullScreenCapture = {
  dataUrl: string;
  width: number;
  height: number;
};

const MAX_EDGE = 1600;
// Keep the panel invisible just long enough for the OS compositor to repaint
// the display underneath. 60 Hz = 16 ms/frame; 3 frames is the sweet spot
// between "no flash for the user" and "capture is guaranteed clean".
const HIDE_MS = 50;

export async function captureFullScreen(): Promise<FullScreenCapture | null> {
  if (!hasScreenRecordingPermission()) {
    console.warn("[fullscreen] Screen Recording permission missing — skipping capture");
    return null;
  }

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);

  const panel = getPanelWindow();
  const panelWasVisible = !!(panel && panel.isVisible());
  const panelOnThisDisplay =
    panelWasVisible && panel ? isWindowOnDisplay(panel, display) : false;

  if (panelWasVisible && panel && panelOnThisDisplay) {
    // setOpacity(0) is instant and doesn't disturb focus or the window stack.
    panel.setOpacity(0);
    await new Promise((r) => setTimeout(r, HIDE_MS));
  }

  try {
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
      console.warn("[fullscreen] desktopCapturer returned no sources");
      return null;
    }
    const source = findSourceForDisplay(sources, display) ?? sources[0];
    const full = source.thumbnail;
    const resized = maybeResize(full, MAX_EDGE);
    const dataUrl = resized.toDataURL();
    const size = resized.getSize();
    return { dataUrl, width: size.width, height: size.height };
  } catch (err) {
    console.warn("[fullscreen] capture failed:", err);
    return null;
  } finally {
    if (panelWasVisible && panel && !panel.isDestroyed()) {
      panel.setOpacity(1);
    }
  }
}

function hasScreenRecordingPermission(): boolean {
  if (process.platform !== "darwin") return true;
  return systemPreferences.getMediaAccessStatus("screen") === "granted";
}

function isWindowOnDisplay(win: BrowserWindow, display: Display): boolean {
  try {
    const b = win.getBounds();
    const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const nearest = screen.getDisplayNearestPoint(center);
    return nearest.id === display.id;
  } catch {
    return false;
  }
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
  const byId = sources.find(
    (s) => (s as unknown as { display_id?: string }).display_id === String(display.id),
  );
  return byId ?? sources[0] ?? null;
}
