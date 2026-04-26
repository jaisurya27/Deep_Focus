/**
 * Minimal POST-capable SSE client.
 *
 * The built-in `EventSource` only supports GET, so we parse the stream by
 * hand. We're targeting the local FastAPI backend which emits events like:
 *
 *     event: token
 *     data: {"text":"hi"}
 *
 *     event: done
 *     data: {"session_id":"…"}
 */

export type SseEvent = {
  event: string;
  data: string;
};

export type SseHandlers = {
  onOpen?: (response: Response) => void;
  onEvent: (event: SseEvent) => void;
  onError?: (error: unknown) => void;
  signal?: AbortSignal;
};

export async function postSse(
  url: string,
  body: unknown,
  handlers: SseHandlers,
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal: handlers.signal,
  });

  if (!response.ok || !response.body) {
    handlers.onError?.(
      new Error(`backend ${response.status}: ${await response.text().catch(() => "")}`),
    );
    return;
  }

  handlers.onOpen?.(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      // Normalize CRLF → LF so the splitter works regardless of which SSE
      // implementation is on the server. sse-starlette uses CRLF by default;
      // a hand-rolled stream might use LF; we tolerate both.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let split: number;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const parsed = parseEventBlock(rawEvent);
        if (parsed) handlers.onEvent(parsed);
      }
    }
    // Flush any trailing event the server didn't terminate with a blank line.
    const trailing = buffer.trim();
    if (trailing) {
      const parsed = parseEventBlock(trailing);
      if (parsed) handlers.onEvent(parsed);
    }
  } catch (error) {
    handlers.onError?.(error);
  }
}

function parseEventBlock(block: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (dataLines.length === 0 && event === "message") return null;
  return { event, data: dataLines.join("\n") };
}
