# Providers

All model calls are proxied through the FastAPI sidecar. The renderer has zero
knowledge of xAI, OpenAI, keys, or model names.

## Protocols

`services/backend/app/providers/base.py` defines three Protocols:

- `ChatProvider` — `chat_stream`, `chat_stream_json`.
- `VisionProvider` — `chat_stream_multimodal`, `chat_stream_multimodal_json`.
- `ImageProvider` — `generate_image`.

`*_json` methods turn on **JSON mode** on the underlying provider
(`response_format: {"type": "json_object"}`) so `/artifact` can trust the stream
is parseable JSON.

## Implementations

### `providers/xai.py` — xAI (Grok)

- OpenAI-compatible endpoint at `https://api.x.ai/v1/chat/completions`.
- Text model: `grok-2-1212` (configurable).
- Vision model: needs allow-listed model; default `grok-2-vision-1212`.
- Uses `stream_openai_compatible_chat(..., extra_payload=...)` to thread
  JSON-mode through to the shared SSE helper.

### `providers/openai_fallback.py` — OpenAI

- Text: `gpt-4o-mini`.
- Vision: `gpt-4o`.
- Image: `gpt-image-1`.
- JSON-mode methods behave identically to xAI's.

### `providers/mock.py` — offline dev

- Streams plausible realistic text and, for JSON-mode, a plausible-shaped
  JSON object character-by-character.
- Every flow — chat, vision, image, artifact — works with no keys.
- `_mock_json_from_messages` produces a minimal object keyed by the detected
  action, suitable for demoing the UI end-to-end.

## Routing & fallback

`services/backend/app/config.py` reads:

```bash
CHAT_PROVIDER    = xai | openai | mock    (default: xai, falls back to openai → mock)
VISION_PROVIDER  = openai | xai | mock    (default: openai, falls back)
IMAGE_PROVIDER   = openai | xai | mock    (default: openai, falls back)
```

Fallback order is hard-coded in main provider wiring — if the primary raises,
the request retries on the next provider. Mock is the terminal fallback, so
the app never fails outright.

## `_openai_compat.py` — shared SSE helper

All three OpenAI-compatible providers funnel through
`stream_openai_compatible_chat(...)`, which:

1. Streams the `POST /v1/chat/completions` SSE response.
2. Parses `data: {...}` frames into incremental text deltas.
3. Yields text pieces.
4. Accepts `extra_payload` that's merged into the request body
   (used for `response_format` today; future `tools` / `seed` etc. fit here).

## Swapping models

Model names live inside each provider module, not in env. Change them there
when we need grok-3, gpt-4.1, etc. Keep the protocol stable.

## Key files

- `services/backend/app/config.py`
- `services/backend/app/providers/base.py`
- `services/backend/app/providers/xai.py`
- `services/backend/app/providers/openai_fallback.py`
- `services/backend/app/providers/mock.py`
- `services/backend/app/providers/_openai_compat.py`
