import { globalShortcut, screen } from "electron";

import { IPC } from "../shared/ipc";
import { fetchSelectedText, hasAccessibilityPermission } from "./capture/selection";
import { startRegionCapture } from "./capture/region";
import { getActiveWindowContext } from "./context/active-window";
import { getSettings } from "./settings";
import { showPanel, getPanelWindow } from "./windows/panel";

const registered: string[] = [];
const failures: string[] = [];

/** Returns the list of accelerators Electron refused to bind on the last call. */
export function getHotkeyFailures(): string[] {
  return [...failures];
}

export function registerHotkeys() {
  unregisterHotkeys();
  failures.splice(0);

  const { hotkeys } = getSettings();
  console.info("[hotkeys] registering with accelerators:", hotkeys);

  // Smart "just ask / explain selection" — one hotkey, context-aware.
  // If text is selected in the foreground app, opens in selection mode;
  // otherwise falls back to the plain empty panel.
  register(hotkeys.justAsk, async () => {
    console.info("[hotkeys] justAsk handler entered");
    const anchor = screen.getCursorScreenPoint();

    // If accessibility permission is absent on macOS, isTrustedAccessibilityClient
    // already popped the system prompt. Open the panel in just-ask mode with a
    // hint so the user knows what to do next.
    if (!hasAccessibilityPermission()) {
      showPanel({
        mode: "just-ask",
        selectionText: null,
        windowContext: null,
        sourceApp: "__needs_accessibility__",
        explicit: true,
      });
      return;
    }

    // Brief stealth-hide: macOS won't release the "key window" to Chrome while
    // our always-on-top Electron window holds focus (the composer focus() call
    // from a prior open activates it). Without the hide, AppleScript's
    // "tell Chrome to activate" + Cmd+C fights the existing key window and
    // the clipboard doesn't change on subsequent presses.
    //
    // 120 ms: short enough to feel instant, long enough for macOS to hand
    // the key window to Chrome after hide() (50 ms was flaky after the user
    // had interacted with the Glance window).
    const panel = getPanelWindow();
    const wasVisible = !!(panel && panel.isVisible());
    if (wasVisible) {
      panel!.hide();
      await new Promise((r) => setTimeout(r, 120));
    }

    const [selection, windowContext] = await Promise.all([
      fetchSelectedText().catch((err) => {
        console.warn("[hotkeys] fetchSelectedText threw:", err);
        return null;
      }),
      getActiveWindowContext().catch(() => null),
    ]);
    const chars = selection?.length ?? 0;
    console.info(
      `[hotkeys] justAsk fired — selection=${chars} chars, app=${windowContext?.appName ?? "?"}`,
    );
    if (selection) {
      showPanel({
        mode: "selection",
        anchor,
        selectionText: selection,
        windowContext,
        sourceApp: windowContext?.appName ?? null,
        explicit: true,
      });
    } else {
      showPanel({ mode: "just-ask", windowContext, explicit: true });
    }
  });

  register(hotkeys.togglePanel, () => {
    console.info("[hotkeys] togglePanel handler entered");
    const panel = getPanelWindow();
    if (!panel) {
      showPanel({ mode: "just-ask" });
      return;
    }
    if (panel.isVisible()) {
      // Tell the renderer to collapse to orb *before* hiding the window.
      // This ensures the window comes back as the orb — not the expanded
      // composer — when the user toggles it on again.
      panel.webContents.send(IPC.PANEL_MINIMIZE);
      panel.hide();
    } else {
      // Show without explicit so the renderer stays in orb mode.
      showPanel({ mode: "just-ask" });
    }
  });

  register(hotkeys.regionCapture, async () => {
    console.info("[hotkeys] regionCapture handler entered");
    const windowContext = await getActiveWindowContext().catch(() => null);
    await startRegionCapture({ windowContext });
  });

  console.info(
    `[hotkeys] done — registered=[${registered.join(", ")}] failed=[${failures.join(", ")}]`,
  );
}

function register(accel: string, handler: () => void | Promise<void>) {
  let ok = false;
  try {
    ok = globalShortcut.register(accel, () => {
      void handler();
    });
  } catch (err) {
    console.warn("[hotkeys] threw while registering:", accel, err);
  }
  if (ok) {
    registered.push(accel);
  } else {
    failures.push(accel);
    console.warn(
      `[hotkeys] failed to register "${accel}" — ` +
        "either it's not a valid Electron accelerator, or another app owns it globally.",
    );
  }
}

export function unregisterHotkeys() {
  for (const accel of registered.splice(0)) {
    globalShortcut.unregister(accel);
  }
}
