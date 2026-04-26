import { exec } from "node:child_process";
import { promisify } from "node:util";

import type { WindowContext } from "../../shared/ipc";

const execAsync = promisify(exec);

/**
 * Returns what the user was just looking at — active app, window title, and
 * (when the frontmost app is a browser we can script) the URL.
 *
 * Implemented as a tiny OS shell-out to avoid dragging in a native binary
 * dependency. Fully graceful: on failure or no permission, returns null.
 */
export async function getActiveWindowContext(): Promise<WindowContext | null> {
  try {
    switch (process.platform) {
      case "darwin":
        return await darwinContext();
      case "win32":
        return await win32Context();
      default:
        return await linuxContext();
    }
  } catch (err) {
    if (process.env.DF_DEBUG_ACTIVE_WIN) {
      console.warn("[active-window] lookup failed:", err);
    }
    return null;
  }
}

async function darwinContext(): Promise<WindowContext | null> {
  // Frontmost app + window title via System Events (requires Accessibility perm).
  const appScript = `
    tell application "System Events"
      set frontAppName to name of first application process whose frontmost is true
      try
        tell process frontAppName
          set winTitle to name of front window
        end tell
      on error
        set winTitle to ""
      end try
      return frontAppName & "||" & winTitle
    end tell
  `;
  const { stdout } = await execAsync(`osascript -e '${appScript.replace(/'/g, "'\\''")}'`, {
    timeout: 1500,
  });
  const [appName, title] = stdout.trim().split("||");
  if (!appName) return null;

  let url: string | null = null;
  // Try to grab the URL when the frontmost app is a known browser. We use
  // short timeouts and fail silently — this is best-effort.
  const browserScript = browserUrlScript(appName);
  if (browserScript) {
    try {
      const { stdout: urlOut } = await execAsync(
        `osascript -e '${browserScript.replace(/'/g, "'\\''")}'`,
        { timeout: 1200 },
      );
      url = urlOut.trim() || null;
    } catch {
      /* best-effort */
    }
  }

  return {
    appName: appName.trim() || null,
    title: (title || "").trim() || null,
    url,
  };
}

function browserUrlScript(appName: string): string | null {
  const lower = appName.toLowerCase();
  if (lower.includes("chrome") || lower.includes("brave") || lower.includes("edge") || lower.includes("arc")) {
    return `tell application "${appName}" to return URL of active tab of front window`;
  }
  if (lower === "safari") {
    return `tell application "Safari" to return URL of front document`;
  }
  if (lower === "firefox") {
    // Firefox doesn't expose AppleScript URL access; skip.
    return null;
  }
  return null;
}

async function win32Context(): Promise<WindowContext | null> {
  // PowerShell one-liner: return "<process>||<title>" for the foreground window.
  const ps =
    "$sig = '[DllImport(\"user32.dll\")]public static extern IntPtr GetForegroundWindow();" +
    "[DllImport(\"user32.dll\")]public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);" +
    "[DllImport(\"user32.dll\")]public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);'; " +
    "$a = Add-Type -MemberDefinition $sig -Name W -Namespace D -PassThru; " +
    "$h = $a::GetForegroundWindow(); " +
    "$sb = New-Object System.Text.StringBuilder(512); " +
    "$a::GetWindowText($h, $sb, 512) | Out-Null; " +
    "$pid0 = 0; $a::GetWindowThreadProcessId($h, [ref]$pid0) | Out-Null; " +
    "$p = Get-Process -Id $pid0; " +
    "\"$($p.ProcessName)||$($sb.ToString())\"";
  const { stdout } = await execAsync(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`,
    { timeout: 2000 },
  );
  const [appName, title] = stdout.trim().split("||");
  if (!appName) return null;
  return {
    appName: appName.trim() || null,
    title: (title || "").trim() || null,
    url: null,
  };
}

async function linuxContext(): Promise<WindowContext | null> {
  try {
    const { stdout: winId } = await execAsync("xdotool getactivewindow", {
      timeout: 1000,
    });
    const [nameOut, pidOut] = await Promise.all([
      execAsync(`xdotool getwindowname ${winId.trim()}`, { timeout: 1000 }),
      execAsync(`xdotool getwindowpid ${winId.trim()}`, { timeout: 1000 }),
    ]);
    let app: string | null = null;
    try {
      const { stdout } = await execAsync(
        `ps -p ${pidOut.stdout.trim()} -o comm=`,
        { timeout: 1000 },
      );
      app = stdout.trim();
    } catch {
      /* ignore */
    }
    return {
      appName: app,
      title: nameOut.stdout.trim() || null,
      url: null,
    };
  } catch {
    return null;
  }
}
