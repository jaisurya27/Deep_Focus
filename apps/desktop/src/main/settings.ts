import { safeStorage } from "electron";
import Store from "electron-store";

import { DEFAULT_SETTINGS, type Settings } from "../shared/ipc";

/**
 * `electron-store` writes to `app.getPath('userData')`, which isn't resolved
 * until `app.whenReady()`. Importing + constructing at module load time will
 * race the Electron lifecycle, so we lazy-init on first access.
 */
type StoreShape = {
  settings: Settings;
  secrets?: Record<string, string>; // safeStorage-encrypted base64 blobs
};

let store: Store<StoreShape> | null = null;

function getStore(): Store<StoreShape> {
  if (store) return store;
  store = new Store<StoreShape>({
    name: "deep-focus-settings",
    defaults: { settings: DEFAULT_SETTINGS, secrets: {} },
  });
  return store;
}

/**
 * Hotkeys we've retired because they either (a) leaked through to the
 * foreground app (invalid Electron accelerator, e.g. `\`) or (b) clashed with
 * a common browser shortcut (Cmd+Shift+J downloads; Cmd+Shift+I DevTools).
 * When we see one of these in stored settings, we silently upgrade to the
 * current default so existing installs don't stay broken after an update.
 */
const RETIRED_HOTKEYS = new Set([
  "CommandOrControl+Shift+J",
  "CommandOrControl+Shift+I",
  "CommandOrControl+Shift+\\",
  "CommandOrControl+Shift+Space",
  "CommandOrControl+Shift+S",
  "CommandOrControl+Shift+L",
  "CommandOrControl+Shift+H",
]);

export function getSettings(): Settings {
  const stored = (getStore().get("settings") ?? {}) as Partial<Settings>;
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    hotkeys: {
      ...DEFAULT_SETTINGS.hotkeys,
      ...(stored.hotkeys ?? {}),
    },
  };

  // Heal any retired hotkey binding, and write-through so future reads are clean.
  let healed = false;
  (Object.keys(merged.hotkeys) as Array<keyof Settings["hotkeys"]>).forEach(
    (key) => {
      if (RETIRED_HOTKEYS.has(merged.hotkeys[key])) {
        merged.hotkeys[key] = DEFAULT_SETTINGS.hotkeys[key];
        healed = true;
      }
    },
  );
  if (healed) {
    getStore().set("settings", merged);
  }

  return merged;
}

export function setSettings(partial: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...partial };
  getStore().set("settings", next);
  return next;
}

export function getSecret(name: string): string | null {
  const secrets = (getStore().get("secrets") ?? {}) as Record<string, string>;
  const blob = secrets[name];
  if (!blob) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = Buffer.from(blob, "base64");
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export function setSecret(name: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  const store = getStore();
  const secrets = (store.get("secrets") ?? {}) as Record<string, string>;
  if (!value) {
    delete secrets[name];
  } else {
    const encrypted = safeStorage.encryptString(value);
    secrets[name] = encrypted.toString("base64");
  }
  store.set("secrets", secrets);
}
