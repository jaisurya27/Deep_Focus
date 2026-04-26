# Glance — engineering docs

Deep-dive documents meant to bring a new agent (or a future-you) up to speed
without re-reading the whole codebase. For the one-paragraph summary and dev
commands, start at the root `CLAUDE.md` and `memory.md`.

| Doc | What's inside |
| --- | --- |
| [`architecture.md`](./architecture.md) | Process topology, data flow, module map |
| [`ui-shell.md`](./ui-shell.md) | Orb → thinking → composer → artifact UX, window sizing, drag, position persistence, acrylic material |
| [`artifact-framework.md`](./artifact-framework.md) | `/artifact` endpoint, JSON-mode streaming, taxonomy, renderer pattern |
| [`providers.md`](./providers.md) | Chat/Vision/Image provider abstraction, xAI / OpenAI / mock |
| [`ipc.md`](./ipc.md) | IPC channel catalog + preload API surface |
| [`changelog.md`](./changelog.md) | Chronological record of changes in the current branch of work |
| [`gotchas.md`](./gotchas.md) | Hard-won details, anti-patterns, "don't undo this" |
| [`runbook.md`](./runbook.md) | Local dev, smoke tests, troubleshooting |

## Reading order for a new agent

1. **`CLAUDE.md`** (root) — what we're building and why.
2. **`memory.md`** (root) — taxonomy + guardrails.
3. **`docs/architecture.md`** — the 10,000ft view of the system.
4. **`docs/ui-shell.md`** — understand the floating-orb shell before touching it.
5. **`docs/changelog.md`** — what just changed and why.
6. Everything else as needed.
