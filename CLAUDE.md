# CLAUDE.md — Project brief for agents

This repo started as **Deep Focus** (menu-bar "clear-my-doubts" agent) and is
being evolved into **Glance** — a domain-agnostic on-screen copilot.

> **One-liner:** *What you Glance on the screen.* Circle, highlight, point, or
> draw at anything visible on your laptop. Glance understands it, acts on it,
> helps you discover around it, creates from it, or connects it to the rest of
> your tools — all without breaking flow.

**Heads up:** package names, IPC channels, preload namespace (`window.deepFocus.*`)
and storage keys remain `deep-focus` / `deepFocus` on purpose. Only the *visible*
product is "Glance". Do not mass-rename identifiers — it will break the hotkey
bindings, Electron bundle paths, and persisted settings.

---

## Product pillars

| Pillar | Examples |
| --- | --- |
| **Understand** | translate, solve math, explain chart/code, critique UI, diagnose error, identify |
| **Act** | rewrite tone, task list → calendar, mockup → code, email → reply draft, form autofill |
| **Discover** | food → recipe + nearest restaurant, product → price/reviews, movie → trailer, plant/animal ID |
| **Create** | rough sketch → image, mood board → more like this, regenerate chart "prettier" |
| **Connect** | restaurant → OpenTable, flight → price tracker, recipe → grocery list, job posting → autofill application |

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

---

## Repo map (current state)

```
apps/desktop/            Electron + React
  src/main/
    index.ts             app boot, shows the orb on startup
    hotkeys.ts           Cmd+Ctrl+J (just-ask), Cmd+Ctrl+S (region), Cmd+Ctrl+H (toggle)
    tray.ts              menu-bar icon + menu
    ipc.ts               IPC handlers: open/hide panel, content-size, drag, settings…
    settings.ts          electron-store + safeStorage for API keys, panel position
    windows/
      panel.ts           THE orb/panel window: transparent, frameless, no native
                         chrome, content-size driven, manual drag, position
                         persisted across restarts.
      overlay.ts         region-capture marching-ants overlay
      history.ts         full chat-history window
      settings.ts        settings window
    capture/             selected-text fetch, region capture
    context/             active-window introspection
  src/preload/index.ts   exposes `window.deepFocus.*` (panel, openHistory,
                         openSettings, context, etc.)
  src/renderer/          one React tree per HTML entry
    panel.html ↔ shell/GlanceShell.tsx     the orb + composer + floating artifacts
    history.html ↔ history.tsx             chat log
    settings.html ↔ settings.tsx           API keys + hotkeys + providers
    overlay.html ↔ overlay.tsx             region capture
    shell/
      GlanceShell.tsx   orchestrator. Orb → thinking → expanded composer
                        → floating artifact. Includes Stage (ResizeObserver
                        → IPC window sizing) and DraggableOrb (pointer-driven
                        window dragging).
      FloatingArtifact.tsx   dismissable wrapper around ArtifactCard
      icons.tsx         inline SVG icons
    artifacts/
      ActionBar.tsx     category-grouped action chips (Understand/Act/…)
      ArtifactCard.tsx  per-kind renderers (Translate, Math, CodeFix, Tasks, …)
    panels/AnswerPanel  LEGACY chat panel (no longer rendered in shell; kept
                        as reference while the Glance shell stabilizes)
    stores/session.ts   Zustand: messages, pendingSelection, pendingImage,
                        isStreaming, activeArtifact, …
    lib/api.ts          SSE wrappers: chat, vision, image, artifact (JSON-mode)
    styles.css          global theme + ACRYLIC material (.glass / .glass-quiet
                        / .acrylic / .ghost-btn)
  src/shared/
    ipc.ts              channel enum + Settings schema + Context/Payload types
    artifacts.ts        TS types mirroring backend artifact schemas
services/backend/        FastAPI on 127.0.0.1:8765
  app/main.py           app factory, CORS, lifespan
  app/config.py         provider selection from env
  app/routes/
    chat.py             /chat           SSE text
    vision.py           /chat/vision    SSE multimodal
    image.py            /image          JSON image gen
    session.py          /session        list/get/clear
    artifact.py         /artifact       SSE stream of structured JSON artifacts
  app/providers/
    base.py             Chat/Vision/Image provider Protocols
    xai.py              Grok via OpenAI-compatible endpoint
    openai_fallback.py  GPT-4o family
    mock.py             offline canned responses (fully streams too)
    _openai_compat.py   shared OpenAI-compatible SSE helper (supports
                        extra_payload for JSON mode)
  app/artifacts.py      action taxonomy + JSON schemas + system prompts
  app/presets.py        preset system prompts (legacy panel)
  app/store/memory.py   in-memory session store, 14d purge
```

---

## What's live today

### Phases 1–4 (pre-Glance baseline)
- Three hotkeys: `Cmd+Ctrl+J`, `Cmd+Ctrl+S`, `Cmd+Ctrl+H`.
- Streaming SSE answers; follow-up chat continues same session.
- Cross-platform selected-text fetch that preserves the clipboard.
- Multi-display Retina-aware region capture.
- Visual preset routes through `/image`.
- In-memory session store, 14d purge, history + settings windows.
- Active-window context attached as a system hint.

### Glance pivot (this branch of work)
- **`POST /artifact` streams JSON-mode artifacts** (SSE: `meta`, `progress`,
  `artifact`, `error`, `done`). Providers return guaranteed-parseable JSON via
  `response_format: {"type": "json_object"}`.
- **Orb-first shell** (`GlanceShell.tsx`): a 36px draggable orb that expands
  into a small composer pill, swaps to a "thinking" Siri-style blob while
  streaming, and pops floating artifact cards above the composer.
- **Dynamic window sizing**: the Electron window tracks its *content* size via
  a `ResizeObserver` → IPC loop. No giant invisible click-trap around the UI.
- **Manual drag + persisted position**: `pointerdown/move/up` → IPC, position
  saved to `electron-store`, restored on boot, clamped to the nearest display's
  work area so it can't end up off-screen.
- **Chromeless transparent window** on macOS (`resizable: false`,
  `thickFrame: false`, `roundedCorners: false`) — nothing paints except our own
  surfaces.
- **Acrylic material** on every floating surface — heavy blur + saturation, a
  thick opaque dark tint so it stays readable on white backgrounds, inner
  highlights for a subtle bevel, plus a `.acrylic` utility class with noise
  grain for extra depth. See `apps/desktop/src/renderer/styles.css`.
- **Action bar & artifact renderers** stubbed for Translate, Math (with steps),
  CodeFix, Tasks, Product, Recipe, Identify, Diagnose, Mermaid, DraftReply,
  plus a generic fallback card.
- **Mock mode is first-class**, including JSON-mode streaming — every flow
  demoes offline without API keys.

---

## What's next

1. **Per-artifact bespoke UIs.** The current `ArtifactCard` is good enough to
   demo, but each artifact kind deserves a custom layout with floating action
   buttons beneath it (user feedback: "display it as is. like it's floating on
   the screen").
2. **Loose-context policy.** Decide smartly whether to reuse the last session
   or start fresh, based on whether a new screen capture meaningfully relates
   to prior context.
3. **Voice layer (ElevenLabs).** Mic icon is in the composer; wire it to
   STT → verb, and optionally TTS for artifact summaries.
4. **Circle-gesture overlay** (post-MVP).
5. **Real connectors** (OpenTable, Calendar, Gmail) — currently stubbed with
   search-link artifacts.

---

## Engineering guardrails

- **Local-first.** All model calls go through the FastAPI sidecar; the renderer
  never speaks to xAI/OpenAI directly. Keys live in `services/backend/.env`
  (gitignored) or Electron `safeStorage`.
- **Mock mode is first-class.** With no keys set, every flow renders.
- **No native Node modules.** Active-window, selection, and capture all use
  shell-outs or Electron built-ins.
- **Provider switching is config.** `CHAT_PROVIDER` / `VISION_PROVIDER` /
  `IMAGE_PROVIDER` ∈ `xai | openai | mock`; auto mode falls back gracefully.
- **Tool-calling is opt-in.** Connect-tier actions must never auto-fire without
  an explicit user confirmation step.
- **Don't mass-rename `deep-focus` → `glance` in code.** IPC channels, preload
  bridge, settings keys, and bundle paths all depend on it. Only the visible UI
  says Glance.

---

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
curl -s -N -X POST http://127.0.0.1:8765/artifact \
  -H 'Content-Type: application/json' \
  -d '{"action":"translate","text":"Bonjour le monde"}'
```

Force mock mode with `CHAT_PROVIDER=mock VISION_PROVIDER=mock IMAGE_PROVIDER=mock`.

---

## See also

- `memory.md` — taxonomy, hard-won gotchas, open questions.
- `docs/` — deep-dive documents on architecture, UI shell, artifact
  framework, recent changes, and known quirks. Start with `docs/README.md`.
