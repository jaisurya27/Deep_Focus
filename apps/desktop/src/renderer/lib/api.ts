import type { DeepFocusAPI } from "../../preload/index";
import type {
  ActionSummary,
  ArtifactResponse,
} from "../../shared/artifacts";
import type { WindowContext } from "../../shared/ipc";
import { postSse } from "./sse";

declare global {
  interface Window {
    deepFocus: DeepFocusAPI;
  }
}

let cachedBackendUrl: string | null = null;

export async function getBackendUrl(): Promise<string> {
  if (cachedBackendUrl) return cachedBackendUrl;
  const fromBridge = await window.deepFocus?.backend
    ?.url()
    .catch(() => null as string | null);
  cachedBackendUrl = fromBridge ?? "http://127.0.0.1:8765";
  return cachedBackendUrl;
}

export type WireMessage = { role: "user" | "assistant" | "system"; content: string };

export type StreamChatOptions = {
  messages: WireMessage[];
  sessionId: string | null;
  preset?: string | null;
  source?: string;
  sourceText?: string | null;
  windowContext?: WindowContext | null;
  onToken: (delta: string) => void;
  onMeta?: (meta: { provider: string; model: string }) => void;
  onDone: (ctx: { sessionId: string }) => void;
  onError?: (error: string) => void;
  signal?: AbortSignal;
};

export async function streamChat(opts: StreamChatOptions): Promise<void> {
  const baseUrl = await getBackendUrl();
  const url = `${baseUrl.replace(/\/$/, "")}/chat`;
  return streamSseTurn(url, opts);
}

export type StreamVisionOptions = StreamChatOptions & {
  imageDataUrl: string;
};

export async function streamVision(opts: StreamVisionOptions): Promise<void> {
  const baseUrl = await getBackendUrl();
  const url = `${baseUrl.replace(/\/$/, "")}/chat/vision`;
  return streamSseTurn(url, opts, { image_data_url: opts.imageDataUrl });
}

async function streamSseTurn(
  url: string,
  opts: StreamChatOptions,
  extraBody: Record<string, unknown> = {},
): Promise<void> {
  let resolvedSessionId: string | null = opts.sessionId;

  await postSse(
    url,
    {
      messages: opts.messages,
      session_id: opts.sessionId,
      preset: opts.preset ?? null,
      source: opts.source ?? "just-ask",
      source_text: opts.sourceText ?? null,
      window_context: opts.windowContext ?? null,
      ...extraBody,
    },
    {
      onOpen: (response) => {
        const headerSession = response.headers.get("x-session-id");
        if (headerSession) resolvedSessionId = headerSession;
      },
      onEvent: (event) => {
        switch (event.event) {
          case "meta": {
            try {
              const parsed = JSON.parse(event.data);
              opts.onMeta?.(parsed);
            } catch {
              /* ignore malformed meta */
            }
            break;
          }
          case "token": {
            try {
              const parsed = JSON.parse(event.data) as { text?: string };
              if (typeof parsed.text === "string") opts.onToken(parsed.text);
            } catch {
              opts.onToken(event.data);
            }
            break;
          }
          case "error": {
            try {
              const parsed = JSON.parse(event.data) as { message?: string };
              opts.onError?.(parsed.message ?? event.data);
            } catch {
              opts.onError?.(event.data);
            }
            break;
          }
          case "done": {
            try {
              const parsed = JSON.parse(event.data) as { session_id?: string };
              if (parsed.session_id) resolvedSessionId = parsed.session_id;
            } catch {
              /* ignore */
            }
            opts.onDone({ sessionId: resolvedSessionId ?? "" });
            break;
          }
          default:
            break;
        }
      },
      onError: (err) => {
        opts.onError?.(err instanceof Error ? err.message : String(err));
      },
      signal: opts.signal,
    },
  );
}

export type GeneratedImage = {
  provider: string;
  model: string;
  dataUrl?: string;
  url?: string;
};

export async function generateImage(
  prompt: string,
  signal?: AbortSignal,
): Promise<GeneratedImage> {
  const baseUrl = await getBackendUrl();
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Image generation failed (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as GeneratedImage;
}

export type HealthResponse = {
  ok: boolean;
  providers: string[];
  chat_provider_setting?: string;
  active_provider?: string;
  active_model?: string;
  active_error?: string | null;
  vision_active_provider?: string | null;
  vision_active_model?: string | null;
  image_active_provider?: string | null;
};

export async function checkHealth(): Promise<HealthResponse | null> {
  try {
    const baseUrl = await getBackendUrl();
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`);
    if (!response.ok) return null;
    return (await response.json()) as HealthResponse;
  } catch {
    return null;
  }
}

export type SessionListItem = {
  id: string;
  created_at: string;
  updated_at: string;
  snippet: string;
  message_count: number;
};

export async function listSessions(query?: string): Promise<SessionListItem[]> {
  const baseUrl = await getBackendUrl();
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/session`);
  if (query) url.searchParams.set("q", query);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const body = (await res.json()) as { sessions?: SessionListItem[] };
  return body.sessions ?? [];
}

export type SessionDetail = {
  id: string;
  created_at: string;
  messages: Array<{
    role: string;
    content: string;
    created_at: string;
    source?: string | null;
    source_text?: string | null;
    source_image_path?: string | null;
    preset?: string | null;
  }>;
};

export async function getSession(id: string): Promise<SessionDetail | null> {
  const baseUrl = await getBackendUrl();
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/session/${id}`);
  if (!res.ok) return null;
  return (await res.json()) as SessionDetail;
}

// --- Artifacts (Glance pivot) --------------------------------------------

let cachedActions: ActionSummary[] | null = null;

export async function listActions(): Promise<ActionSummary[]> {
  if (cachedActions) return cachedActions;
  const baseUrl = await getBackendUrl();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/artifact/actions`);
    if (!res.ok) return [];
    const body = (await res.json()) as { actions?: ActionSummary[] };
    cachedActions = body.actions ?? [];
    return cachedActions;
  } catch {
    return [];
  }
}

export type RunArtifactOptions = {
  action: string;
  text?: string | null;
  imageDataUrl?: string | null;
  userInstruction?: string | null;
  sessionId?: string | null;
  windowContext?: WindowContext | null;
  signal?: AbortSignal;
  onMeta?: (meta: {
    provider: string;
    model: string;
    session_id?: string;
  }) => void;
  onProgress?: (chars: number) => void;
};

// Streams `/artifact` via SSE, resolves with the final ArtifactResponse.
// Progress/meta events fire live so the thinking orb can show real signal.
export async function runArtifact(
  opts: RunArtifactOptions,
): Promise<ArtifactResponse> {
  const baseUrl = await getBackendUrl();
  const url = `${baseUrl.replace(/\/$/, "")}/artifact`;

  let resolvedSessionId: string | null = opts.sessionId ?? null;
  let finalResponse: ArtifactResponse | null = null;
  let streamError: string | null = null;

  await postSse(
    url,
    {
      action: opts.action,
      text: opts.text ?? null,
      image_data_url: opts.imageDataUrl ?? null,
      user_instruction: opts.userInstruction ?? null,
      session_id: opts.sessionId ?? null,
      window_context: opts.windowContext ?? null,
    },
    {
      onOpen: (response) => {
        const headerSession = response.headers.get("x-session-id");
        if (headerSession) resolvedSessionId = headerSession;
      },
      onEvent: (event) => {
        switch (event.event) {
          case "meta": {
            try {
              const parsed = JSON.parse(event.data) as {
                provider: string;
                model: string;
                session_id?: string;
              };
              if (parsed.session_id) resolvedSessionId = parsed.session_id;
              opts.onMeta?.(parsed);
            } catch {
              /* ignore malformed meta */
            }
            break;
          }
          case "progress": {
            try {
              const parsed = JSON.parse(event.data) as { chars?: number };
              if (typeof parsed.chars === "number") {
                opts.onProgress?.(parsed.chars);
              }
            } catch {
              /* ignore */
            }
            break;
          }
          case "artifact": {
            try {
              finalResponse = JSON.parse(event.data) as ArtifactResponse;
            } catch (err) {
              streamError = `Malformed artifact payload: ${
                err instanceof Error ? err.message : String(err)
              }`;
            }
            break;
          }
          case "error": {
            try {
              const parsed = JSON.parse(event.data) as { message?: string };
              streamError = parsed.message ?? event.data;
            } catch {
              streamError = event.data;
            }
            break;
          }
          default:
            break;
        }
      },
      onError: (err) => {
        streamError = err instanceof Error ? err.message : String(err);
      },
      signal: opts.signal,
    },
  );

  if (finalResponse) {
    const r = finalResponse as ArtifactResponse;
    if (!r.meta?.session_id && resolvedSessionId) {
      r.meta = {
        provider: r.meta?.provider ?? "unknown",
        model: r.meta?.model ?? "unknown",
        session_id: resolvedSessionId,
      };
    }
    return r;
  }
  throw new Error(
    streamError ??
      `Artifact '${opts.action}' stream ended without a payload`,
  );
}

export async function clearAllSessions(): Promise<void> {
  const baseUrl = await getBackendUrl();
  await fetch(`${baseUrl.replace(/\/$/, "")}/session`, { method: "DELETE" });
}
