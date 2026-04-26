# Deep Focus

> A menu-bar personal agent that clears your doubts about anything on your screen — browser tabs, PDFs, code, papers, anywhere. Hit a hotkey, point at what's confusing, get a streaming answer with follow-up chat.

Phases 1–4 are live. Three hotkeys, three flows, follow-up chat, presets, region capture with vision, session history, and a settings window. Everything runs locally against a FastAPI sidecar; model calls go directly from that sidecar to xAI Grok (primary) or OpenAI (fallback).

## Repo layout

```
Deep_Focus/
├─ apps/
│  └─ desktop/                  Electron shell + React panel
│     ├─ src/main/              Tray, hotkeys, IPC, windows
│     │  ├─ capture/            Selected-text fetch + region-capture overlay
│     │  ├─ context/            Active-window introspection (no native deps)
│     │  └─ windows/            panel / overlay / history / settings windows
│     ├─ src/preload/           contextBridge between main and renderer
│     ├─ src/renderer/          React + Tailwind — panel, overlay, history, settings
│     └─ src/shared/            Types shared across processes
└─ services/
   └─ backend/                  FastAPI on 127.0.0.1:8765
      └─ app/
         ├─ main.py             App + CORS + /health
         ├─ routes/             /chat (SSE) · /chat/vision (SSE) · /image · /session
         ├─ providers/          xAI Grok + OpenAI fallback + mock (chat/vision/image)
         ├─ store/              In-memory session store (auto-purged after 14 days)
         └─ presets.py          System-prompt templates (Simplify / Analogy / …)
```

## Prerequisites

- **Node 20+**
- **pnpm 10+** (`npm i -g pnpm` if you don't have it)
- **Python 3.11+** and **uv** (`brew install uv` or <https://docs.astral.sh/uv/>)
- macOS, Windows, or Linux

## Setup

```bash
pnpm install
cd services/backend && uv sync && cd -

cp services/backend/.env.example services/backend/.env
# Paste your key(s) into services/backend/.env:
#   XAI_API_KEY=xai-...
#   OPENAI_API_KEY=sk-...     # optional fallback for chat / vision / images
# With no keys set, the backend boots in mock mode — still fully usable
# to demo the UX end-to-end (text, vision, and image generation).
```

## Run

```bash
pnpm dev
```

One terminal, two services:

- **backend** on `http://127.0.0.1:8765` (FastAPI + uv)
- **desktop** Electron app with Vite HMR

A green dot appears in your menu bar — no dock icon, by design. Hit a hotkey from anywhere.

## Hotkeys

| Keys | What happens |
| --- | --- |
| `Cmd+Ctrl+J` | **Ask / Explain selection** — if text is selected in the foreground app, attaches it as a quoted block and explains it; otherwise opens an empty panel. |
| `Cmd+Ctrl+S` | **Capture region** — dim overlay over every display; drag a rectangle; the cropped image becomes the context for your next message. |
| `Cmd+Ctrl+H` | Show / hide the panel. |
| `Cmd/Ctrl+1 … 5` | Apply a preset to the last turn (Simplify · Analogy · Visual metaphor · Fun facts · Intuition). Auto-regenerates. |
| `Cmd/Ctrl+R` | Regenerate last reply with the current preset. |
| `Cmd/Ctrl+K` | Start a new thread. |
| `Esc` | Hide the panel. |

Rebinding is available in **Settings → Shortcuts**.

## What works today

### Phase 1 — Just ask (baseline)
- Global hotkey → floating panel, stays on top, doesn't steal focus.
- Streaming answers via SSE. Follow-ups continue the same session.
- Tray menu; no dock icon; health indicator inside the panel header.

### Phase 2 — Selected text
- Cross-platform selected-text fetch that saves, copies, reads, and restores the clipboard (macOS: `osascript`; Windows: PowerShell keystrokes; Linux: `xdotool` / `wtype`).
- Selection renders as a collapsible quoted block above the first assistant reply.
- Five preset chips below the composer: **Simplify · Analogy · Visual metaphor · Fun facts · Intuition**. Clicking a chip regenerates the last turn with that system-prompt template. `Cmd+1..5` from the keyboard.

### Phase 3 — Region capture + vision
- `Cmd/Ctrl+Shift+S` opens a fullscreen transparent overlay on **every** display (Retina-aware, scaled correctly). Drag a rectangle to select.
- The region is captured via `desktopCapturer` + `nativeImage.crop`, downscaled if large, and becomes the attached image for the next message.
- Vision requests go to `POST /chat/vision` (OpenAI-compatible multimodal payload) — `grok-2-vision-latest` by default, with `gpt-4o` as an automatic fallback.
- The **Visual metaphor** preset switches to `POST /image` and streams the generated image inline (xAI Imagine → `gpt-image-1.5` fallback).
- Cropped thumbnails appear in the panel header; click to expand.

### Phase 4 — Polish, memory, history
- In-memory session store that auto-purges anything older than 14 days on every backend boot.
- Active-window context (foreground app + title + URL for browsers) is attached as a system hint, so "this" and "here" resolve meaningfully. Implemented with pure shell-outs — no native Node modules, so no build-time `node-gyp` pain.
- **Session history** window (tray → *Session history*): searchable list of past sessions with the source text preserved alongside the conversation.
- **Settings** window (tray → *Settings*): rebind hotkeys, paste API keys (encrypted at rest via Electron `safeStorage`), toggle launch-on-startup, clear all history, check provider health.
- First-launch welcome card with a quick hotkey tour.

## One-off development commands

```bash
# Backend only
pnpm dev:backend

# Desktop only (needs backend running)
pnpm dev:desktop

# Type-check the desktop app
pnpm --filter @deep-focus/desktop typecheck

# Smoke test: streams an SSE response
curl -N -X POST http://127.0.0.1:8765/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"what is a monad?"}],"preset":"analogy"}'

# Smoke test vision (any tiny base64 PNG works)
curl -N -X POST http://127.0.0.1:8765/chat/vision \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"what is this?"}],"image_data_url":"data:image/png;base64,iVBORw0KGgo="}'

# Smoke test image generation
curl -X POST http://127.0.0.1:8765/image \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"a cozy cabin in winter"}'
```

Force mock mode (no API keys needed) by exporting `CHAT_PROVIDER=mock`, `VISION_PROVIDER=mock`, `IMAGE_PROVIDER=mock` before starting the backend.

## Roadmap

- Phase 5 — Focus mode (optional webcam-based attention nudge).
- Phase 6 — Browser extension for first-class page context.
- Swap the in-memory store for SQLite so sessions survive backend restarts.

## Notes / caveats

- **`ELECTRON_RUN_AS_NODE`** — if you run `pnpm dev` from a Cursor/VS Code integrated terminal, Electron may inherit this env var and refuse to start a full GUI. The `pnpm dev:desktop` script clears it via `cross-env`; if you invoke Vite/Electron manually, either `unset ELECTRON_RUN_AS_NODE` first or use a plain system terminal.
- **macOS permissions** — the first time you use `Cmd+Shift+I` macOS will ask for **Accessibility** (to synthesize the copy keystroke), and `Cmd+Shift+S` will ask for **Screen Recording**. One-time prompts.
- **API keys never leave the sidecar.** The renderer only speaks to `127.0.0.1:8765`. Keys live either in `services/backend/.env` (gitignored) or — for per-user keys set in the Settings window — in Electron `safeStorage`, which is OS-keychain-backed.
- **Provider selection.** `CHAT_PROVIDER` / `VISION_PROVIDER` / `IMAGE_PROVIDER` can each be one of `xai | openai | mock`. Set to `xai` (default) and the backend will transparently fall back to OpenAI if the xAI key is missing or the call errors; set to `openai` to force a single backend.

## License

MIT for now. Private project.
