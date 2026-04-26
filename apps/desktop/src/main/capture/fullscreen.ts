/**
 * Silent fullscreen capture.
 *
 * Unlike `startRegionCapture` (which drops a marching-ants overlay), this
 * snaps the whole display under the cursor with no UI. It's used by the
 * "smart context" loop: when the user asks "what am I looking at?" the
 * backend responds with a `needs_context` artifact asking for a screenshot,
 * and the renderer calls this silently, attaches the result, and re-runs
 * the same turn.
 *
 * Important: we hide the Glance panel window for the duration of the grab
 * so the orb/composer don't end up inside the frame the vision model sees.
 */
import {
  desktopCapturer,
  screen,
  systemPreferences,
  type Display,
} from "electron";

import { getPanelWindow } from "../windows/panel";

export type FullscreenCaptureResult = {
  dataUrl: string;
  width: number;
  height: number;
};

export type FullscreenCaptureError =
  | { kind: "permission" }
  | { kind: "no-sources" }
  | { kind: "failed"; message: string };

export type FullscreenCaptureOutcome =
  | { ok: true; value: FullscreenCaptureResult }
  | { ok: false; error: FullscreenCaptureError };

export async function captureFullScreen(): Promise<FullscreenCaptureOutcome> {
  if (process.platform === "darwin") {
    const status = systemPreferences.getMediaAccessStatus("screen");
    if (status !== "granted") {
      return { ok: false, error: { kind: "permission" } };
    }
  }

  // Hide the panel so it doesn't show up in the snapshot. We restore it on
  // our way out, even if capture throws.
  const panel = getPanelWindow();
  const wasVisible = !!panel && !panel.isDestroyed() && panel.isVisible();
  if (wasVisible && panel) {
    panel.hide();
    // Give the compositor one frame to actually remove the panel from the
    // screen before we snapshot.
    await delay(60);
  }

  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const result = await snapshotDisplay(display);
    return { ok: true, value: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: "failed", message } };
  } finally {
    if (wasVisible && panel && !panel.isDestroyed()) {
      panel.showInactive();
    }
  }
}

async function snapshotDisplay(
  display: Display,
): Promise<FullscreenCaptureResult> {
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
      "desktopCapturer returned no screen sources — Screen Recording permission likely missing.",
    );
  }
  const source =
    sources.find(
      (s) =>
        (s as unknown as { display_id?: string }).display_id ===
        String(display.id),
    ) ?? sources[0];
  const img = source.thumbnail;
  // Cap the long edge so the resulting data URL stays within sane request
  // size for vision models. 1600px matches region capture.
  const sized = maybeResize(img, 1600);
  const { width, height } = sized.getSize();
  return {
    dataUrl: sized.toDataURL(),
    width,
    height,
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
