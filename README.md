# Deep Focus

> A menu-bar **Glance**-style on-screen copilot: pick text, capture a region, or just ask. Model calls go through a local FastAPI sidecar (`127.0.0.1:8765`) to xAI, OpenAI, or mock. The *visible* product is **Glance**; the repo and IPC namespace still use the `deep-focus` / `deepFocus` names on purpose (see `CLAUDE.md`).

## What works (high level)

- **Glance shell** (`GlanceShell.tsx`) — floating orb, composer, and structured **artifacts** (not the legacy `AnswerPanel`: removed).
- **One pipeline:** composer sends to **`POST /artifact`** with `action: "auto"`. The backend **router** picks the right artifact; **`needs_context`** can ask the client to attach a **screenshot** and retry (e.g. “what’s on my screen?”).
- **Selected text** (`Cmd+Ctrl+J` by default) — copy-hop in the **foreground** app, selection shown in the UI, type a question or press **Enter** on an empty field for **"Explain this"** (no instant auto-send). Ambient full-screen is **not** sent when you already have selected text (avoids spurious “UI critique” style routes).
- **Region capture** (`Cmd+Ctrl+S`) — overlay + crop; can auto-run the first turn for image-only context.
- **Ambient screenshot** (when you ask **without** selection text) — silent capture with the panel hidden from the frame; needs **Screen Recording** on macOS.
- **Session history, settings, tray, hotkey rebinding**, encrypted API keys, **in-memory** session store (14d purge on backend boot).
- **Orb** starts **bottom-right of the main display** on first launch; position is **persisted** and clamped. Legacy saves near (0,0) are **healed** on startup.

## Repo layout

```
Deep_Focus/
├─ apps/
│  └─ desktop/                  Electron + React
│     ├─ src/main/              tray, hotkeys, IPC, windows, capture, context
│     ├─ src/preload/           `window.deepFocus` bridge
│     ├─ src/renderer/          `GlanceShell`, overlay, history, settings
│     └─ src/shared/            IPC + types
└─ services/
   └─ backend/                  FastAPI
      ├─ app/routes/            `/artifact`, `/chat`, `/chat/vision`, `/image`, `/session`
      ├─ app/router.py          `action: auto` routing (text vs image, `needs_context`, …)
      └─ app/artifacts.py       catalog + JSON shapes for each artifact kind
```

## Prerequisites

- **Node 20+**, **pnpm 10+**
- **Python 3.11+** and **uv** (`brew install uv` or <https://docs.astral.sh/uv/>)
- macOS, Windows, or Linux (some automation paths are OS-specific; see `docs/runbook.md`)

## Setup

```bash
pnpm install
cd services/backend && uv sync && cd -

cp services/backend/.env.example services/backend/.env
# Add keys: XAI_API_KEY, OPENAI_API_KEY, etc. No keys → mock mode still works for demos
```

## Run

```bash
pnpm dev
```

- **Backend:** `http://127.0.0.1:8765`
- **Desktop:** Electron with Vite HMI  
  Menu-bar icon; on macOS the **dock** can be hidden on purpose. The **orb** appears in the **bottom-right** of the primary display (unless a saved position exists).

## Hotkeys (defaults — rebind in Settings)

| Keys | What happens |
| --- | --- |
| `Cmd+Ctrl+J` | **Ask** — fetches **selection** in the foreground app if any; else opens the panel. Hides the panel briefly before copy for reliable macOS key-window behavior. |
| `Cmd+Ctrl+S` | **Region** — full-screen transparent overlay, drag a rectangle, image attached. |
| `Cmd+Ctrl+H` | **Show / hide** the panel. When hiding, the shell **minimizes to orb** so the next show isn’t stuck expanded. |
| `Cmd+Ctrl+L` | **Toggle focus mode** (if wired in your build). |
| `Esc` | From the panel: cancels stream or **minimizes** shell to the orb. |
| `Cmd+K` (in panel) | **Hard reset** session in the client store (see `GlanceShell`). |

Older docs mentioned **Cmd+1…5** presets and **Cmd+R** “regenerate” — that was the **legacy** chat panel. The **Glance** shell uses **router-driven artifacts** and chips / follow-ups in the **artifact** UI instead. If you still need preset-style prompts, set them in the **composer** or extend artifacts on the backend.

## Permissions (macOS)

- **Accessibility** — required for the selection copy-hop (`System Settings → Privacy & Security → Accessibility` → your Electron/Deep Focus app).
- **Screen Recording** — required for **region** capture, **ambient** screenshot, and **`needs_context`** full-screen snap.

## What works (phased roll-up)

- **Phases 1–4 (baseline):** hotkeys, SSE streaming, tray, history, settings, **active-window** hints, **region** + **vision** path, in-memory store.
- **Glance + artifacts:** `POST /artifact` JSON stream, `router.py` intent rules, new artifact UIs and types as they land on `main` / `dote` (maps, food, weather, `needs_context` cards, etc.). See `app/artifacts.py` and `docs/`.

## One-off dev commands

```bash
pnpm dev:backend
pnpm dev:desktop
pnpm --filter @deep-focus/desktop typecheck
```

**Smoke the backend**

```bash
curl -s http://127.0.0.1:8765/health | jq
```

**Smoke `/artifact`**

```bash
curl -s -N -X POST http://127.0.0.1:8765/artifact \
  -H 'Content-Type: application/json' \
  -d '{"action":"auto","text":"Hello","user_instruction":null,"session_id":null}' 
```

Set `CHAT_PROVIDER=mock` (and friends) for offline development.

## Roadmap (examples)

- Durable session store (SQLite) instead of in-memory only.
- Richer per-artifact UI polish, connectors (calendar, mail), optional browser extension.

## Notes

- **`ELECTRON_RUN_AS_NODE`:** If a terminal sets this, Electron may not start a GUI. The desktop script clears it; use a clean shell if you hit a blank app.
- **Keys** stay on the **sidecar**; the renderer only talks to `127.0.0.1` (plus optional `safeStorage` in Electron for user-provided keys in Settings).
- For **agents**, keep **`CLAUDE.md`** and **`docs/`** in sync when behavior or IPC changes (see `docs/README.md`).

## License

MIT for now. Private project.
