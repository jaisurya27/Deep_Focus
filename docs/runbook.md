# Runbook

## First-time setup

```bash
# Node + pnpm (pnpm ≥ 9)
pnpm install

# Python backend (uv)
cd services/backend && uv sync && cd -

# Secrets (optional — mock mode works without)
cp services/backend/.env.example services/backend/.env
# then edit and paste:
#   XAI_API_KEY=...
#   OPENAI_API_KEY=...
```

## Daily dev

```bash
# One terminal. Runs FastAPI + Electron with HMR concurrently.
pnpm dev

# Or split:
pnpm dev:backend    # FastAPI on 127.0.0.1:8765
pnpm dev:desktop    # Electron + Vite HMR
```

On first launch:

- macOS will ask for Accessibility (for selected-text capture) on the first
  `Cmd+Ctrl+J`.
- macOS will ask for Screen Recording (for region capture) on the first
  `Cmd+Ctrl+S`. Grant and retry. If permission is missing, the Glance panel
  itself will also pop open with a warning banner + "Open System Settings"
  button (which deep-links to the right pane via `x-apple.systempreferences:`).
  After toggling Screen Recording, **quit and relaunch the app** — macOS
  does not re-check the permission within a running process.

## Smoke tests

```bash
curl -s http://127.0.0.1:8765/health | jq

# Artifact streaming (SSE)
curl -s -N -X POST http://127.0.0.1:8765/artifact \
  -H 'Content-Type: application/json' \
  -d '{"action":"translate","text":"Bonjour le monde","target_lang":"es"}'

# Chat streaming
curl -s -N -X POST http://127.0.0.1:8765/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hello"}]}'
```

## Force offline / mock mode

```bash
CHAT_PROVIDER=mock VISION_PROVIDER=mock IMAGE_PROVIDER=mock pnpm dev:backend
```

Or leave all `*_PROVIDER` unset and remove keys from `.env`. Provider auto-mode
will fall through to mock on each call that can't find keys.

## Typecheck / lint

```bash
pnpm -C apps/desktop typecheck

# Backend (if configured)
cd services/backend && uv run ruff check . && uv run mypy app
```

## Rebuilding the Electron main process

Vite handles HMR for the renderer. The *main* process rebuilds through
`vite-plugin-electron`. When you edit anything in `apps/desktop/src/main/` or
`apps/desktop/src/preload/`, you'll see:

```
[desktop] build started...
[desktop] ✓ 1 modules transformed.
[desktop] ../../dist-electron/main/index-XXXX.js …
[desktop] built in 30ms.
```

If main doesn't rebuild after a change, check for a TS error in the terminal.

## Common failures

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Orb not visible on start | Main didn't rebuild, or `showPanel(..)` never reached `showInactive` | restart `pnpm dev`; check main terminal for errors |
| "Backend offline" banner | FastAPI not running on 8765 | `pnpm dev:backend` or free the port |
| "API key not set" in panel | `.env` empty and providers set to `xai`/`openai` | switch to `auto` or `mock`, or paste keys |
| Artifact never renders | Provider returned invalid JSON | should never happen with JSON mode; check the backend terminal for the raw stream; file a bug |
| Orb position drifts on restart | `settings.panelPosition` corrupted | delete `electron-store`'s `config.json` in the user-data dir |
| Shadows clipped into a rectangle | `HALO_MARGIN` too small OR `roundedCorners: true` reintroduced | see `docs/ui-shell.md` |
| Orb washed out on white bg | `brightness(>100%)` added back to an acrylic class | see `docs/gotchas.md` |
| Orb can't be dragged | `-webkit-app-region` reintroduced | delete it; rely on `pointerdown/move/up` flow |
| `Cmd+Ctrl+S` shows the overlay but chat stays empty | overlay bailed with a `no-overlay-info` / `too-small` cancel reason (see main terminal) | inspect the `[region] OVERLAY_CANCEL received — reason=…` log; don't re-introduce an `OVERLAY_START` handshake (see `docs/gotchas.md`) |
| Region capture does nothing, no overlay | Screen Recording permission missing | grant in System Settings → Privacy & Security → Screen Recording, then quit + relaunch |
| Composer × cleared my selection | you're on an old build — modern shell uses `minimizeShell` which preserves context. Only `Cmd+K` is destructive | rebuild; see `docs/ui-shell.md` |

## Fetch.ai Agentverse agents

### First-time setup

```bash
cd services/agentverse
uv venv
uv pip install -r requirements.txt
cp .env.example .env
# Edit .env — set OPENAI_API_KEY or XAI_API_KEY (at least one required)
```

### Run all agents + bridge

```bash
cd services/agentverse
.venv/bin/python run_all.py
```

`run_all.py` starts five processes: the HTTP bridge (port 8020) first, then the
four uagents (ConnectAgent, DiscoverAgent, CodeAgent, Orchestrator on ports
8013–8010). Once the bridge is up, the main FastAPI backend at `:8765` will
automatically route `food_order`, `restaurant_booking`, and `fix_code` through
it instead of calling the LLM directly.

On startup each agent prints its Agentverse address, e.g.:
```
ConnectAgent  address: agent1qwt4ftn6hm5wrm5j25v7ulrcn25vnkc6zej9uer2u0rrkujnasmlw4dcjqf
DiscoverAgent address: agent1qf9tjtrt3ar7y80yqexhheeh7gypt553f2gg0yp85nxzhh6p43w6ctmd8nu
CodeAgent     address: agent1qfynx2v5z4kju5cwurv990gxdtrh243f0yxxyqnmste4eptnsdmm6zmwjw2
Orchestrator  address: agent1q0j7r8723g7nnntgz2k3xwwfx7yyjqpvge2radl5fx5s04gapqxws2wvw5x
```

These addresses are **deterministic** (derived from fixed seeds) — they won't
change between restarts.

### Register on Agentverse (for ASI:One discovery)

1. Set `AGENTVERSE_API_KEY` in `.env` (get from https://agentverse.ai/settings).
2. Run `run_all.py` — the `mailbox=True` flag will auto-register each agent.
3. In the terminal, click the Inspector URL that appears and connect a mailbox
   for each agent.
4. Set a name and description on each agent's Agentverse profile so ASI:One
   can discover it semantically.

### Demo flows via ASI:One

| User says | Routes to | Artifact | Cost |
|---|---|---|---|
| Paste buggy code | CodeAgent | `fix_code` | Free |
| "I want to make ramen tonight" | DiscoverAgent | `food_order` | Free |
| "Find me a sushi restaurant to book downtown LA" | ConnectAgent | `restaurant_booking` | 0.10 FET |

### Smoke test without Agentverse

Run a single agent directly to verify LLM connectivity:

```bash
cd services/agentverse
.venv/bin/python agents/code_agent.py
# In another terminal:
# Then use the Inspector URL to send a test ChatMessage
```

## Packaging (post-hack)

Not configured for this branch. When we ship, we'll wire `electron-builder`
and notarization. For the demo, dev mode is fine.
