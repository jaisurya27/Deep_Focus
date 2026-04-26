import { BrowserWindow } from "electron";
import path from "node:path";

const PRELOAD_PATH = path.resolve(__dirname, "../preload/index.js");
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

let win: BrowserWindow | null = null;

export async function openHistoryWindow(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return win;
  }
  win = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 520,
    minHeight: 360,
    title: "Deep Focus — History",
    backgroundColor: "#020617",
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (DEV_URL) {
    const sep = DEV_URL.endsWith("/") ? "" : "/";
    await win.loadURL(`${DEV_URL}${sep}history.html`);
  } else {
    await win.loadFile(path.resolve(__dirname, "../../dist/renderer/history.html"));
  }
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });
  return win;
}
