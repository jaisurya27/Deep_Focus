import { globalShortcut, screen } from "electron";

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

  // Smart "just ask / explain selection" — one hotkey, context-aware.
  // If text is selected in the foreground app, opens in selection mode;
  // otherwise falls back to the plain empty panel.
  register(hotkeys.justAsk, async () => {
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

    // If the panel window has keyboard focus, the synthesized Cmd+C would
    // target our own panel (which has no useful selection). Hide the panel
    // first so focus falls back to whatever app was behind it, wait a tick,
    // then fetch the selection from that app.
    const panel = getPanelWindow();
    if (panel && panel.isVisible() && panel.isFocused()) {
      panel.hide();
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
    const panel = getPanelWindow();
    if (!panel) {
      showPanel({ mode: "just-ask", explicit: true });
      return;
    }
    if (panel.isVisible()) panel.hide();
    else showPanel({ mode: "just-ask", explicit: true });
  });

  register(hotkeys.regionCapture, async () => {
    const windowContext = await getActiveWindowContext().catch(() => null);
    await startRegionCapture({ windowContext });
  });
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
