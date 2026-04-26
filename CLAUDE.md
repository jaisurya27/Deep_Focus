# CLAUDE.md — Project brief for agents

This repo started as **Deep Focus** (menu-bar "clear-my-doubts" agent) and is
being evolved into **Glance** — a domain-agnostic on-screen copilot.

> **One-liner:** *What you Glance on the screen.* Circle, highlight, point, or
> draw at anything visible on your laptop. Glance understands it, acts on it,
> helps you discover around it, creates from it, or connects it to the rest of
> your tools — all without breaking flow.

## Product pillars

| Pillar | Examples |
| --- | --- |
| **Understand** | translate, solve math, explain chart/code, critique UI, diagnose error, identify person/landmark |
| **Act** | rewrite tone, task list → calendar, mockup → code, email → reply draft, form autofill |
| **Discover** | food → recipe + nearest restaurant, product → price/reviews, movie → trailer, plant/animal ID |
| **Create** | rough sketch → image, mood board → more like this, regenerate chart "prettier" |
| **Connect** | restaurant → OpenTable, flight → price tracker, recipe → grocery list, job posting → autofill application |

## Interaction modes (target)

- **Point** — hover + hotkey for a quick read on what's under the cursor *(partial today via selected-text hotkey + active-window context)*
- **Highlight** — drag-select text (native selection) *(live)*
- **Circle** — freehand loop anywhere *(post-MVP overlay extension)*
- **Region** — rectangular drag select *(live via `Cmd+Ctrl+S`)*
- **Draw** — sketch on screen; Glance interprets intent *(post-MVP)*
- **Voice + gesture** — capture, then speak the verb ("find this cheaper") *(ElevenLabs hook planned)*

## Demo sequence (90 seconds, judge-ready)

1. Circle a sushi photo → recipe card + "best restaurant 0.3 mi away".
2. Circle a bug in an IDE → code-fix artifact, one click to apply.
3. Circle a handwritten to-do list → calendar-event artifacts.
4. Circle a product on Amazon → price comparison + Reddit reviews summary.

## Prize targets

- Figma *Flicker to Flow* — core premise is friction → flow.
- Cognition — human-AI collaboration tooling.
- Arista — resources & routing for daily-life problems.
- ElevenLabs — voice layer on every response.
- ZETIC/ASUS — on-device vision for privacy.

## Repo map

```
apps/desktop/            Electron + React
  src/main/              tray, hotkeys, IPC, windows (panel/overlay/history/settings)
    capture/             selected-text fetch, region-capture overlay
    context/             active-window introspection
  src/renderer/          React panel, overlay, history, settings
    panels/AnswerPanel   main UI (chat, presets, context banners)
    stores/session       Zustand chat store + PRESETS
    lib/api              SSE streaming, image, health, sessions
    artifacts/           ← typed artifact renderers (Glance pivot)
  src/shared/ipc.ts      IPC channel names + Settings + types
services/backend/        FastAPI on 127.0.0.1:8765
  app/routes/
    chat.py              /chat  (SSE text)
    vision.py            /chat/vision  (SSE multimodal)
    image.py             /image (JSON image gen)
    session.py           /session (list/get/clear)
    artifact.py          ← /artifact (structured JSON per action) — Glance pivot
  app/providers/         xai · openai_fallback · mock (chat/vision/image)
  app/presets.py         system-prompt templates
  app/store/memory.py    in-memory session store, 14d purge
  app/artifacts.py       ← action taxonomy + JSON schemas — Glance pivot
```

## What's live today (Phases 1–4)

- Three hotkeys: `Cmd+Ctrl+J` (just-ask / explain selection), `Cmd+Ctrl+S`
  (region capture), `Cmd+Ctrl+H` (toggle panel).
- Streaming SSE answers; follow-up chat continues same session.
- Cross-platform selected-text fetch that preserves the clipboard.
- Multi-display Retina-aware region capture; vision via grok-2-vision / gpt-4o.
- Visual Metaphor preset routes through `/image` (xAI Imagine → gpt-image-1 fallback).
- In-memory session store; 14-day purge; history + settings windows.
- Active-window context attached as a system hint (so "this"/"here" resolve).

## What's next (Glance pivot — this branch of work)

1. **Artifact framework** — backend route returning a typed JSON artifact per
   action; frontend renders rich cards (Translate, Math w/ steps, CodeFix,
   Tasks, Product, Recipe, Identify, Diagnose, Mermaid, DraftReply, …).
2. **Action bar** — above the composer, surface category-grouped actions
   (Understand / Act / Discover / Create / Connect) whenever context is
   attached. Keep presets as a stylistic follow-up on the last reply.
3. **Visible rebrand** — the panel chrome reads "Glance". Code identifiers,
   package names, and hotkey scaffolding stay as `deep-focus` / `deepFocus`
   to avoid a churny full rename during the hackathon.
4. **Post-MVP** — circle gesture (SVG overlay), voice+gesture ("find me this
   cheaper"), connectors (OpenTable, Calendar, Gmail).

## Engineering guardrails

- **Local-first.** All model calls go through the FastAPI sidecar; the
  renderer never speaks to xAI/OpenAI directly. Keys live in
  `services/backend/.env` (gitignored) or Electron `safeStorage`.
- **Mock mode is first-class.** With no keys set, every flow (chat / vision /
  image / artifact) still renders a realistic response.
- **No native Node modules.** Active-window, selection, and capture all use
  shell-outs or Electron built-ins. Keeps `pnpm install` boring.
- **Provider switching is config.** `CHAT_PROVIDER` / `VISION_PROVIDER` /
  `IMAGE_PROVIDER` ∈ `xai | openai | mock`; auto mode falls back gracefully.
- **Tool-calling is opt-in.** Connect-tier actions (calendar, reservations)
  must never auto-fire without an explicit user confirmation step.

## Dev commands

```bash
pnpm install
cd services/backend && uv sync && cd -
cp services/backend/.env.example services/backend/.env  # paste keys
pnpm dev                    # backend + desktop, one terminal

pnpm dev:backend            # FastAPI only (127.0.0.1:8765)
pnpm dev:desktop            # Electron + Vite HMR

# Smoke tests
curl -s http://127.0.0.1:8765/health | jq
curl -s -X POST http://127.0.0.1:8765/artifact \
  -H 'Content-Type: application/json' \
  -d '{"action":"translate","text":"Bonjour le monde"}' | jq
```

Force mock mode with `CHAT_PROVIDER=mock VISION_PROVIDER=mock IMAGE_PROVIDER=mock`.
