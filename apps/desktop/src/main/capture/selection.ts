import { app, clipboard, systemPreferences } from "electron";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Bundle IDs / process names that are "us" — when any of these is the frontmost
 * app at the moment the hotkey fires, we know Cmd+C won't give us a meaningful
 * selection (either we'd be copying from our own panel, or nothing at all).
 * In packaged builds this is "Deep Focus"; in dev it's "Electron" (or similar).
 */
const OWN_APP_NAMES = new Set(
  [
    "Electron",
    "Electron Helper",
    "Electron Helper (Renderer)",
    "Deep Focus",
    app.getName(),
  ].filter(Boolean) as string[],
);

/** Best-effort lookup of the current frontmost app name (macOS only). */
async function frontmostAppName(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
      { timeout: 1500 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * On macOS, sending keystrokes via System Events requires Accessibility access.
 * This checks for it and, if missing, triggers the system prompt so the user
 * can grant it in System Settings → Privacy & Security → Accessibility.
 * Returns true if access is granted (or we're not on macOS).
 */
export function hasAccessibilityPermission(): boolean {
  if (process.platform !== "darwin") return true;
  // `true` = prompt the user if not already trusted
  return systemPreferences.isTrustedAccessibilityClient(true);
}

/**
 * Fetch the currently selected text from whatever app has focus.
 *
 * There is no cross-platform API for this (macOS has AX, Windows has UIA,
 * Linux has nothing universal), so we use the clipboard-hop trick:
 *   1. snapshot the current clipboard
 *   2. simulate Cmd/Ctrl+C in the frontmost app
 *   3. read the clipboard (that's our selection)
 *   4. restore the original clipboard
 *
 * Returns `null` if the user didn't actually have anything selected (the
 * clipboard didn't change) or if the OS automation call failed outright.
 */
/** Matches any sentinel we or a prior run might have left on the clipboard. */
const SENTINEL_PATTERN = /^__df_sel_\d+_[a-z0-9]+__$/;

/** Serializes fetchSelectedText calls so two hotkey presses can't race on the clipboard. */
let fetchInFlight: Promise<string | null> | null = null;

export async function fetchSelectedText(): Promise<string | null> {
  if (fetchInFlight) {
    // A prior hotkey press is still mid-copy. Piggy-back on it so we don't
    // trample its sentinel / clipboard-restore step.
    console.info("[selection] coalescing with in-flight fetch");
    return fetchInFlight;
  }
  fetchInFlight = doFetchSelectedText().finally(() => {
    fetchInFlight = null;
  });
  return fetchInFlight;
}

async function doFetchSelectedText(): Promise<string | null> {
  if (!hasAccessibilityPermission()) {
    console.warn(
      "[selection] Accessibility permission not granted. " +
        "Grant access in System Settings → Privacy & Security → Accessibility, then restart Deep Focus.",
    );
    return null;
  }

  const frontmost = await frontmostAppName();
  if (frontmost && OWN_APP_NAMES.has(frontmost)) {
    console.info(
      `[selection] frontmost app is "${frontmost}" (us) — skipping copy-hop.`,
    );
    return null;
  }

  const rawOriginal = safeRead(() => clipboard.readText());
  const originalText =
    rawOriginal && SENTINEL_PATTERN.test(rawOriginal) ? "" : rawOriginal;
  const originalImage = safeRead(() => clipboard.readImage()?.toDataURL());

  const sentinel = `__df_sel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;
  try {
    clipboard.writeText(sentinel);
  } catch {
    return null;
  }

  try {
    await triggerCopy(frontmost);
  } catch (err) {
    console.warn("[selection] OS copy trigger failed:", err);
    restoreClipboard(originalText, originalImage);
    return null;
  }

  const selection = await waitForClipboardChange(sentinel, 800);
  restoreClipboard(originalText, originalImage);

  if (selection === null) {
    console.info(
      `[selection] clipboard unchanged after copy — frontmost was "${frontmost ?? "?"}". ` +
        "Likely no selection in that app.",
    );
    return null;
  }

  // Belt-and-suspenders: if somehow a sentinel-shaped string slipped through
  // (e.g. a concurrent invocation in another process), refuse to return it.
  if (SENTINEL_PATTERN.test(selection)) {
    console.warn("[selection] polled value looked like a sentinel — rejecting.");
    return null;
  }

  const trimmed = selection.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function triggerCopy(targetAppName: string | null): Promise<void> {
  switch (process.platform) {
    case "darwin": {
      // Escape any quotes in the app name; AppleScript will otherwise choke on
      // names like "Safari Technology Preview" with weird punctuation.
      const safeName = (targetAppName ?? "").replace(/"/g, '\\"');
      // Explicitly activate the target app so our synthesized Cmd+C lands in
      // the right focused element. Without this, Chrome/Safari sometimes
      // receive the keystroke but the focused element has no selection
      // (e.g. the URL bar, or the dev-tools pane).
      const script = safeName
        ? [
            `tell application "${safeName}" to activate`,
            `delay 0.08`,
            `tell application "System Events" to keystroke "c" using command down`,
          ]
        : [`tell application "System Events" to keystroke "c" using command down`];
      const args = script.flatMap((line) => ["-e", line]);
      await execFileAsync("osascript", args, { timeout: 2500 });
      return;
    }
    case "win32": {
      // PowerShell's SendKeys simulates Ctrl+C in the frontmost app.
      const script =
        "Add-Type -AssemblyName System.Windows.Forms; " +
        "[System.Windows.Forms.SendKeys]::SendWait('^c')";
      await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script}"`,
        { timeout: 2000 },
      );
      return;
    }
    default: {
      // Linux — try X11 first, fall back to Wayland's wtype.
      try {
        await execAsync("xdotool key --clearmodifiers ctrl+c", { timeout: 1500 });
        return;
      } catch {
        await execAsync("wtype -M ctrl c -m ctrl", { timeout: 1500 });
        return;
      }
    }
  }
}

async function waitForClipboardChange(
  sentinel: string,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(20);
    const current = safeRead(() => clipboard.readText());
    if (current && current !== sentinel) {
      return current;
    }
  }
  return null;
}

function restoreClipboard(text: string | undefined, image: string | undefined): void {
  try {
    if (image) {
      // Image restoration skipped intentionally — restoring images across OSes
      // is lossy and rare. Falling back to the text clears the sentinel.
      clipboard.writeText(text ?? "");
    } else {
      clipboard.writeText(text ?? "");
    }
  } catch {
    /* best-effort */
  }
}

function safeRead<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
