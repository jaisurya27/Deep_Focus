import { getSettings } from "./settings";

/**
 * Ask the backend to drop all session history. Used from the Settings UI
 * and the Reset Everything power-user path.
 */
export async function clearAllSessionsRemote(): Promise<void> {
  const base = getSettings().backendUrl.replace(/\/$/, "");
  try {
    await fetch(`${base}/session`, { method: "DELETE" });
  } catch (err) {
    console.warn("[history] clear-all failed:", err);
  }
}
