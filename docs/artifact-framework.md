# Artifact framework

The artifact framework is the backbone of the Glance pivot. Every capture can
be routed to one of ~25 *actions*, each of which produces a structured JSON
artifact that the renderer displays as a rich, tailored card — not prose.

## Endpoint

`POST http://127.0.0.1:8765/artifact`

Request body:

```jsonc
{
  "action": "translate",               // one of the taxonomy keys
  "text": "Bonjour le monde",          // optional
  "image_data_url": "data:image/...",  // optional
  "window_context": { "app": "Safari", "title": "…" },
  "session_id": "…",                   // optional: continue a session
  "target_lang": "es"                  // action-specific extras
}
```

Response: **Server-Sent Events** stream.

| Event | When | Data |
| --- | --- | --- |
| `meta` | first | `{ session_id, action, provider, model }` |
| `progress` | periodic | `{ chars }` — how many JSON chars streamed so far |
| `artifact` | once | `{ kind, ...fields }` — the parsed JSON artifact |
| `error` | on failure | `{ code, message }` |
| `done` | last | `{}` |

Frontend glue is `runArtifact(...)` in `apps/desktop/src/renderer/lib/api.ts`,
which resolves with `ArtifactResponse` (from `src/shared/artifacts.ts`).

## JSON-mode streaming

Every chat provider exposes `chat_stream_json` and `chat_stream_multimodal_json`
(see `providers/base.py`). Under the hood they all route to
`stream_openai_compatible_chat` with:

```py
extra_payload = { "response_format": { "type": "json_object" } }
```

Both xAI and OpenAI honor `response_format`. That guarantees the stream is a
single parseable JSON object, which lets the backend skip all the old
brittle "find-the-first-`{`, count braces" fallback parsing.

Mock provider (`providers/mock.py`) emits a plausible canned JSON payload
character-by-character, so the whole streaming UX (progress counter, late
artifact frame) works with no keys.

## Action taxonomy

Defined in `services/backend/app/artifacts.py` with per-action system prompts
and JSON schemas. The TS mirrors live in `apps/desktop/src/shared/artifacts.ts`.

Grouped by category:

- **Understand** — `translate`, `solve_math`, `explain_chart`, `critique_ui`,
  `explain_code`, `diagnose_error`, `identify`.
- **Act** — `rewrite`, `tasks_to_calendar`, `sketch_to_code`, `diagram_to_mermaid`,
  `draft_reply`, `autofill_form`, `run_code`.
- **Discover** — `recipe`, `product`, `media_lookup`, `travel`, `fashion`, `company`.
- **Create** — `image_from_sketch`, `moodboard_more`, `regenerate_chart` (these
  delegate to `/image`).
- **Connect** — stubbed for MVP (`book_reservation`, `price_track`,
  `email_person`, `job_autofill`, `grocery_list`).

Per-action system prompts demand **strict JSON** in the shape of the
corresponding schema. When the schema evolves, update both:

- `services/backend/app/artifacts.py` (prompt + schema constant)
- `apps/desktop/src/shared/artifacts.ts` (TS type)

## Renderer pattern

`apps/desktop/src/renderer/artifacts/ArtifactCard.tsx` dispatches on
`artifact.kind`. Each case renders a dedicated component. Unknown kinds fall
through to a generic key/value card.

Floating action buttons live in `FloatingArtifact.tsx` (wrapping `ArtifactCard`).
Common buttons: Copy, Save as ICS, Open maps, Apply patch, Dismiss. Each card
is free to expose kind-specific actions (e.g. `run_code` adds a "Run in terminal"
confirm step; `tasks_to_calendar` adds "Add all to Calendar").

### Planned work

- Per-artifact bespoke layouts — the user's explicit feedback is to "ditch the
  box" and make each artifact's display visually unique. The current
  `ArtifactCard` is adequate for demo but each kind should get a tailored
  floating treatment.
- Wire `Connect`-tier actions with one-click-but-confirmed flows.

## Key files

- `services/backend/app/routes/artifact.py`
- `services/backend/app/artifacts.py`
- `services/backend/app/providers/_openai_compat.py`
- `services/backend/app/providers/{xai,openai_fallback,mock}.py`
- `apps/desktop/src/renderer/lib/api.ts`
- `apps/desktop/src/renderer/artifacts/ArtifactCard.tsx`
- `apps/desktop/src/renderer/shell/FloatingArtifact.tsx`
- `apps/desktop/src/shared/artifacts.ts`
