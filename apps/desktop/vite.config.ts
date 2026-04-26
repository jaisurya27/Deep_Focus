import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import electronRenderer from "vite-plugin-electron-renderer";

export default defineConfig(({ command }) => ({
  root: "src/renderer",
  base: command === "build" ? "./" : "/",
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "src/renderer"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        panel: resolve(__dirname, "src/renderer/panel.html"),
        overlay: resolve(__dirname, "src/renderer/overlay.html"),
        history: resolve(__dirname, "src/renderer/history.html"),
        settings: resolve(__dirname, "src/renderer/settings.html"),
      },
    },
  },
  plugins: [
    react(),
    electron([
      {
        entry: resolve(__dirname, "src/main/index.ts"),
        vite: {
          build: {
            outDir: resolve(__dirname, "dist-electron/main"),
            rollupOptions: {
              external: ["electron", "electron-store"],
            },
          },
        },
      },
      {
        entry: resolve(__dirname, "src/preload/index.ts"),
        onstart({ reload }) {
          reload();
        },
        vite: {
          build: {
            outDir: resolve(__dirname, "dist-electron/preload"),
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
}));
