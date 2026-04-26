import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ActionSummary } from "../../shared/artifacts";
import { ActionBar } from "../artifacts/ActionBar";
import { ArtifactCard } from "../artifacts/ArtifactCard";
import {
  checkHealth,
  generateImage,
  runArtifact,
  streamChat,
  streamVision,
  type HealthResponse,
  type WireMessage,
} from "../lib/api";
import { Markdown } from "../lib/markdown";
import {
  makeMessageId,
  PRESETS,
  useSession,
  type AttachedImage,
  type AttachedSelection,
  type ChatMessage,
} from "../stores/session";

const MODE_LABELS = {
  "just-ask": "Just ask",
  selection: "From selection",
  region: "From region",
} as const;

export function AnswerPanel() {
  const messages = useSession((s) => s.messages);
  const isStreaming = useSession((s) => s.isStreaming);
  const providerLabel = useSession((s) => s.providerLabel);
  const mode = useSession((s) => s.mode);
  const pendingSelection = useSession((s) => s.pendingSelection);
  const pendingImage = useSession((s) => s.pendingImage);
  const sessionId = useSession((s) => s.sessionId);
  const windowContext = useSession((s) => s.windowContext);

  const [draft, setDraft] = useState("");
  const [healthMessage, setHealthMessage] = useState<string | null>(null);
  const [needsAccessibility, setNeedsAccessibility] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // --- Wire up to the main process -----------------------------------------

  useEffect(() => {
    const off = window.deepFocus?.panel?.onOpen?.((payload) => {
      const store = useSession.getState();
      store.setMode(payload.mode);
      store.setWindowContext(payload.windowContext ?? null);

      if (payload.mode === "selection") {
        store.setPendingSelection(
          payload.selectionText
            ? { text: payload.selectionText, sourceApp: payload.sourceApp ?? null }
            : null,
        );
        store.setPendingImage(null);
      } else if (payload.mode === "region") {
        if (payload.imageDataUrl) {
          store.setPendingImage({
            dataUrl: payload.imageDataUrl,
            width: payload.width,
            height: payload.height,
            savedPath: payload.imagePath ?? null,
          });
        }
        store.setPendingSelection(null);
      } else {
        // just-ask — check for the accessibility-denied sentinel first.
        if (payload.sourceApp === "__needs_accessibility__") {
          setNeedsAccessibility(true);
        } else {
          setNeedsAccessibility(false);
        }
        // Don't nuke pending context from a prior hotkey unless the panel is fresh.
        if (store.messages.length === 0) {
          store.setPendingSelection(null);
          store.setPendingImage(null);
        }
      }

      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => {
      off?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await checkHealth();
      if (cancelled) return;
      applyHealth(h, setHealthMessage);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // --- Send a turn ---------------------------------------------------------

  const sendTurn = useCallback(
    async (options: {
      text: string;
      preset?: string | null;
      regenerateOfUserId?: string;
      selection?: AttachedSelection | null;
      image?: AttachedImage | null;
    }) => {
      const text = options.text.trim();
      if (!text || isStreaming) return;

      const store = useSession.getState();
      const activeSelection = options.selection ?? store.pendingSelection;
      const activeImage = options.image ?? store.pendingImage;
      const currentMode = store.mode;
      const preset = options.preset ?? null;

      // Visual Metaphor preset: route through /image instead of chat.
      if (preset === "visual") {
        await runVisualMetaphor({
          text,
          selection: activeSelection,
          image: activeImage,
        });
        return;
      }

      // Build (or replace) a user message for this turn.
      let userMsg: ChatMessage;
      if (options.regenerateOfUserId) {
        const existing = store.messages.find((m) => m.id === options.regenerateOfUserId);
        if (!existing) return;
        userMsg = { ...existing, preset, content: text };
        store.updateMessage(userMsg.id, {
          preset,
          // keep attached selection/image as-is for regen
        });
        store.removeLastAssistantFor(userMsg.id);
      } else {
        userMsg = {
          id: makeMessageId(),
          role: "user",
          content: text,
          source: currentMode,
          preset,
          selection: activeSelection ?? null,
          image: activeImage ?? null,
        };
        store.appendMessage(userMsg);
      }

      const assistantMsg: ChatMessage = {
        id: makeMessageId(),
        role: "assistant",
        content: "",
        streaming: true,
        source: currentMode,
        preset,
      };
      store.appendMessage(assistantMsg);
      store.setStreaming(true);
      if (!options.regenerateOfUserId) {
        setDraft("");
        // First successful send consumes pending context.
        store.setPendingSelection(null);
        store.setPendingImage(null);
      }

      const controller = new AbortController();
      abortRef.current = controller;

      const wire: WireMessage[] = [{ role: "user", content: text }];
      const handlers = {
        sessionId: store.sessionId,
        preset,
        source: currentMode,
        sourceText: activeSelection?.text ?? null,
        windowContext: store.windowContext,
        onMeta: (meta: { provider: string; model: string }) =>
          useSession.getState().setProviderLabel(`${meta.provider} · ${meta.model}`),
        onToken: (delta: string) =>
          useSession.getState().appendToken(assistantMsg.id, delta),
        onDone: ({ sessionId: next }: { sessionId: string }) => {
          if (next) useSession.getState().setSessionId(next);
          useSession.getState().finalizeMessage(assistantMsg.id);
          useSession.getState().setStreaming(false);
        },
        onError: (msg: string) =>
          useSession.getState().failMessage(assistantMsg.id, msg),
        signal: controller.signal,
        messages: wire,
      };

      // Decide which image to send along with the turn.
      //  1. If the user explicitly captured a region (Cmd+Ctrl+S), that wins —
      //     it's a targeted image the user meant to share.
      //  2. Otherwise take an ambient full-screen snapshot so the model sees
      //     what's on-screen. Skipped on regenerate (would change context
      //     between the original and the regen, which is confusing).
      //  3. On any failure (no Screen Recording permission, capture error)
      //     fall back to a text-only request — never block the user.
      let wireImage: string | null = activeImage?.dataUrl ?? null;
      if (!wireImage && !options.regenerateOfUserId) {
        try {
          const t0 = performance.now();
          const cap = await window.deepFocus?.capture?.fullscreen?.();
          const ms = Math.round(performance.now() - t0);
          if (cap?.dataUrl) {
            wireImage = cap.dataUrl;
            console.info(
              `[chat] attached ambient full-screen capture (${cap.width}×${cap.height}, ${ms}ms)`,
            );
          } else {
            console.info(
              `[chat] ambient capture unavailable (${ms}ms) — sending text-only`,
            );
          }
        } catch (err) {
          console.warn("[chat] ambient capture threw — sending text-only:", err);
        }
      }

      try {
        if (wireImage) {
          await streamVision({ ...handlers, imageDataUrl: wireImage });
        } else {
          await streamChat(handlers);
        }
      } catch (err) {
        useSession
          .getState()
          .failMessage(
            assistantMsg.id,
            err instanceof Error ? err.message : String(err),
          );
        useSession.getState().setStreaming(false);
      } finally {
        abortRef.current = null;
      }
    },
    [isStreaming],
  );

  const runVisualMetaphor = useCallback(
    async (ctx: {
      text: string;
      selection: AttachedSelection | null;
      image: AttachedImage | null;
    }) => {
      const store = useSession.getState();
      const userMsg: ChatMessage = {
        id: makeMessageId(),
        role: "user",
        content: ctx.text || "Visual metaphor for the attached material.",
        source: store.mode,
        preset: "visual",
        selection: ctx.selection ?? null,
        image: ctx.image ?? null,
      };
      const assistantMsg: ChatMessage = {
        id: makeMessageId(),
        role: "assistant",
        content: "_Generating visual metaphor…_",
        streaming: true,
        source: store.mode,
        preset: "visual",
      };
      store.appendMessage(userMsg);
      store.appendMessage(assistantMsg);
      store.setStreaming(true);
      setDraft("");
      store.setPendingSelection(null);
      store.setPendingImage(null);

      const controller = new AbortController();
      abortRef.current = controller;

      const passage =
        ctx.selection?.text ||
        (ctx.image ? "the captured screen region" : "") ||
        ctx.text;
      const prompt = passage
        ? `A single cinematic visual metaphor for: ${passage}. High detail, dramatic lighting, tasteful composition, no on-image text.`
        : ctx.text;

      try {
        const img = await generateImage(prompt, controller.signal);
        useSession.getState().updateMessage(assistantMsg.id, {
          streaming: false,
          content: "Here's a visual metaphor for the attached material.",
          generatedImage: {
            dataUrl: img.dataUrl,
            url: img.url,
            caption: prompt,
          },
        });
        useSession.getState().setStreaming(false);
      } catch (err) {
        useSession
          .getState()
          .failMessage(
            assistantMsg.id,
            err instanceof Error ? err.message : String(err),
          );
        useSession.getState().setStreaming(false);
      } finally {
        abortRef.current = null;
      }
    },
    [],
  );

  const runAction = useCallback(
    async (action: ActionSummary) => {
      if (isStreaming) return;
      const store = useSession.getState();
      const sel = store.pendingSelection;
      const img = store.pendingImage;
      const hasText = !!sel?.text?.trim();
      const hasImage = !!img?.dataUrl;
      if (action.needs_image && !hasImage) return;
      if (action.needs_text && !hasText && !hasImage) return;

      const userMsg: ChatMessage = {
        id: makeMessageId(),
        role: "user",
        content: action.label,
        source: store.mode,
        preset: `artifact:${action.id}`,
        selection: sel ?? null,
        image: img ?? null,
        action: action.id,
      };
      const assistantMsg: ChatMessage = {
        id: makeMessageId(),
        role: "assistant",
        content: "",
        streaming: true,
        source: store.mode,
        preset: `artifact:${action.id}`,
        action: action.id,
      };
      store.appendMessage(userMsg);
      store.appendMessage(assistantMsg);
      store.setStreaming(true);
      store.setPendingSelection(null);
      store.setPendingImage(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await runArtifact({
          action: action.id,
          text: sel?.text ?? null,
          imageDataUrl: img?.dataUrl ?? null,
          sessionId: store.sessionId,
          windowContext: store.windowContext,
          signal: controller.signal,
        });
        useSession.getState().updateMessage(assistantMsg.id, {
          streaming: false,
          artifact: res.artifact,
          content: "",
        });
        if (res.meta?.session_id) {
          useSession.getState().setSessionId(res.meta.session_id);
        }
        if (res.meta?.provider && res.meta?.model) {
          useSession
            .getState()
            .setProviderLabel(`${res.meta.provider} · ${res.meta.model}`);
        }
      } catch (err) {
        useSession
          .getState()
          .failMessage(
            assistantMsg.id,
            err instanceof Error ? err.message : String(err),
          );
      } finally {
        useSession.getState().setStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming],
  );

  const send = useCallback(
    (preset?: string | null) => {
      const hasContext =
        !!pendingSelection?.text || !!pendingImage?.dataUrl;
      const text = draft.trim() || defaultPrompt(preset, mode, hasContext);
      void sendTurn({ text, preset: preset ?? null });
    },
    [draft, mode, pendingImage, pendingSelection, sendTurn],
  );

  const regenerateLast = useCallback(
    (preset: string | null) => {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUser) return;
      void sendTurn({
        text: lastUser.content,
        preset,
        regenerateOfUserId: lastUser.id,
        selection: lastUser.selection ?? null,
        image: lastUser.image ?? null,
      });
    },
    [messages, sendTurn],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const applyPreset = useCallback(
    (presetId: string) => {
      // If there's already an answer in the thread, regenerate the last turn
      // with the new preset. Otherwise, this is a "send with this preset now".
      const hasAssistant = messages.some((m) => m.role === "assistant");
      if (hasAssistant && !draft.trim()) {
        regenerateLast(presetId);
      } else {
        send(presetId);
      }
    },
    [draft, messages, regenerateLast, send],
  );

  // --- Keyboard plumbing ---------------------------------------------------

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (isStreaming) cancel();
        else window.deepFocus?.panel?.hide?.();
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        send();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    },
    [cancel, isStreaming, send],
  );

  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isStreaming) {
        window.deepFocus?.panel?.hide?.();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useSession.getState().clear();
        setDraft("");
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        regenerateLast(null);
      }
      if ((e.metaKey || e.ctrlKey) && /^[1-5]$/.test(e.key)) {
        const preset = PRESETS[parseInt(e.key, 10) - 1];
        if (preset) {
          e.preventDefault();
          applyPreset(preset.id);
        }
      }
    };
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  }, [applyPreset, isStreaming, regenerateLast]);

  // --- Render --------------------------------------------------------------

  const sourceChipLabel = useMemo(() => MODE_LABELS[mode] ?? mode, [mode]);
  const hasContext = !!pendingSelection?.text || !!pendingImage?.dataUrl;

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/95 shadow-panel backdrop-blur-xl"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <Header
        sourceChipLabel={sourceChipLabel}
        providerLabel={providerLabel}
        windowContext={windowContext}
      />

      <PendingContextBanner
        selection={pendingSelection}
        image={pendingImage}
        onClear={() => {
          useSession.getState().setPendingSelection(null);
          useSession.getState().setPendingImage(null);
        }}
      />

      <ActionBar
        hasText={!!pendingSelection?.text}
        hasImage={!!pendingImage?.dataUrl}
        disabled={isStreaming}
        onPick={(action) => void runAction(action)}
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <EmptyState
            healthMessage={healthMessage}
            mode={mode}
            hasContext={hasContext}
            needsAccessibility={needsAccessibility}
          />
        ) : null}
        <div className="flex flex-col gap-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </div>
      </div>

      <PresetChipsRow
        onPick={applyPreset}
        disabled={isStreaming}
        anyAssistant={messages.some((m) => m.role === "assistant")}
      />

      <Composer
        ref={inputRef}
        value={draft}
        onChange={setDraft}
        onKeyDown={handleKeyDown}
        onSend={() => send()}
        onCancel={cancel}
        isStreaming={isStreaming}
        placeholder={placeholderFor(mode, hasContext)}
      />
    </div>
  );
}

function applyHealth(
  h: HealthResponse | null,
  setHealthMessage: (v: string | null) => void,
) {
  if (!h) {
    setHealthMessage(
      "Backend offline. Run `pnpm dev:backend` in another terminal — or `pnpm dev` from the repo root.",
    );
    return;
  }
  setHealthMessage(null);
  if (h.active_error) {
    setHealthMessage(h.active_error);
    return;
  }
  if (h.active_provider && h.active_model) {
    useSession
      .getState()
      .setProviderLabel(`${h.active_provider} · ${h.active_model}`);
  } else if (h.providers?.[0]) {
    useSession.getState().setProviderLabel(h.providers[0]);
  }
}

function defaultPrompt(
  preset: string | null | undefined,
  mode: string,
  hasContext: boolean,
): string {
  if (hasContext && mode === "selection") return "Explain this.";
  if (hasContext && mode === "region") return "What's in this region?";
  if (preset) return "Explain this.";
  return "";
}

function placeholderFor(mode: string, hasContext: boolean): string {
  if (mode === "selection" && hasContext)
    return "Press Enter to explain this, or type a question…";
  if (mode === "region" && hasContext)
    return "Press Enter to explain this, or type a question…";
  return "Ask anything…";
}

// -- Subcomponents ---------------------------------------------------------

function Header({
  sourceChipLabel,
  providerLabel,
  windowContext,
}: {
  sourceChipLabel: string;
  providerLabel: string | null;
  windowContext: { title?: string | null; url?: string | null; appName?: string | null } | null;
}) {
  const hint = windowContext?.appName
    ? `${windowContext.appName}${windowContext.title ? ` · ${windowContext.title}` : ""}`
    : null;
  return (
    <div
      className="flex items-center justify-between border-b border-slate-800/80 px-4 py-2 text-xs text-slate-400"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-200">
          Glance
        </span>
        <span className="shrink-0 rounded-full border border-slate-700/70 bg-slate-900/70 px-2 py-[2px] text-[10px] uppercase tracking-wider">
          {sourceChipLabel}
        </span>
        {hint ? (
          <span className="truncate text-[10px] text-slate-500" title={hint}>
            · {hint}
          </span>
        ) : null}
      </div>
      <div
        className="flex shrink-0 items-center gap-3"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {providerLabel ? (
          <span
            className="truncate font-mono text-[10px] text-slate-500"
            title={providerLabel}
          >
            {providerLabel}
          </span>
        ) : null}
        <button
          aria-label="History"
          title="Open session history"
          className="rounded-md px-1.5 py-0.5 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
          onClick={() => window.deepFocus?.history?.open?.()}
        >
          ⌘…
        </button>
        <button
          aria-label="Settings"
          title="Open settings"
          className="rounded-md px-1.5 py-0.5 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
          onClick={() => window.deepFocus?.settings?.open?.()}
        >
          ⚙
        </button>
        <button
          aria-label="Close"
          className="rounded-md px-2 py-0.5 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
          onClick={() => window.deepFocus?.panel?.hide?.()}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function PendingContextBanner({
  selection,
  image,
  onClear,
}: {
  selection: AttachedSelection | null;
  image: AttachedImage | null;
  onClear: () => void;
}) {
  if (!selection?.text && !image?.dataUrl) return null;

  return (
    <div className="border-b border-slate-800/80 bg-slate-900/40 px-4 py-2">
      <div className="flex items-start gap-3">
        {image?.dataUrl ? (
          <img
            src={image.dataUrl}
            alt="captured region"
            className="h-14 w-20 shrink-0 rounded-md border border-slate-700/70 object-cover"
          />
        ) : null}
        {selection?.text ? (
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-emerald-400/80">
              <span>Selection</span>
              {selection.sourceApp ? (
                <span className="text-slate-500">· {selection.sourceApp}</span>
              ) : null}
            </div>
            <div
              className="max-h-16 overflow-hidden border-l-2 border-emerald-500/60 pl-2 text-[12px] leading-snug text-slate-300"
              style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}
            >
              {selection.text}
            </div>
          </div>
        ) : null}
        {image?.dataUrl && !selection?.text ? (
          <div className="min-w-0 flex-1 text-[12px] text-slate-400">
            Captured region attached. Ask anything about it below.
          </div>
        ) : null}
        <button
          aria-label="Clear attached context"
          className="shrink-0 rounded-md px-1.5 py-0.5 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
          onClick={onClear}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function EmptyState({
  healthMessage,
  mode,
  hasContext,
  needsAccessibility,
}: {
  healthMessage: string | null;
  mode: string;
  hasContext: boolean;
  needsAccessibility: boolean;
}) {
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return localStorage.getItem("df_onboarded") !== "1";
    } catch {
      return false;
    }
  });

  const title =
    mode === "selection" && hasContext
      ? "Selection captured."
      : mode === "region" && hasContext
        ? "Region captured."
        : "Ask anything.";
  const subtitle =
    mode === "selection" && hasContext
      ? "Type a question below, or pick a preset. Enter explains it."
      : mode === "region" && hasContext
        ? "Ask about the image, or pick a preset."
        : "Type your question. ⌘⏎ or Enter to send.";

  return (
    <div className="flex h-full min-h-[180px] flex-col justify-center gap-2 text-center text-slate-400">
      {showOnboarding ? (
        <Onboarding
          onDismiss={() => {
            setShowOnboarding(false);
            try {
              localStorage.setItem("df_onboarded", "1");
            } catch {
              /* ignore */
            }
          }}
        />
      ) : (
        <>
          <div className="text-sm font-semibold text-slate-200">{title}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
          <div className="text-[11px] text-slate-500">
            <KbdKey>Esc</KbdKey> dismiss · <KbdKey>⌘K</KbdKey> new thread ·{" "}
            <KbdKey>⌘1…5</KbdKey> preset
          </div>
        </>
      )}
      {needsAccessibility ? (
        <div className="mx-auto mt-3 max-w-[360px] rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2.5 text-left text-[11.5px] text-orange-200">
          <div className="mb-1 font-semibold text-orange-300">
            Accessibility permission needed
          </div>
          macOS just opened <strong>System Settings → Privacy &amp; Security → Accessibility</strong>.
          Enable <strong>Glance</strong> there, then press the hotkey again.
        </div>
      ) : null}
      {healthMessage ? (
        <div className="mx-auto mt-2 max-w-[360px] rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          {healthMessage}
        </div>
      ) : null}
    </div>
  );
}

function Onboarding({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mx-auto max-w-[380px] rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-left">
        <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">
          Welcome to Glance
        </div>
        <button
          onClick={onDismiss}
          className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
        >
          Got it
        </button>
      </div>
      <div className="mb-2 text-[12.5px] text-slate-200">
        Hit a hotkey anywhere on your laptop:
      </div>
      <ul className="flex flex-col gap-1.5 text-[11.5px] text-slate-300">
        <HotkeyTip keys="⌘⌃J" label="Ask anything — or explain selected text if you have some" />
        <HotkeyTip keys="⌘⌃S" label="Drag a rectangle, ask about what's inside" />
        <HotkeyTip keys="⌘⌃H" label="Show/hide this panel" />
      </ul>
      <div className="mt-3 text-[11px] text-slate-500">
        Tip: after an answer, click a preset chip (or hit <KbdKey>⌘1</KbdKey>…<KbdKey>5</KbdKey>)
        to regenerate with a different style.
      </div>
      <div className="mt-2 text-[10.5px] text-slate-500">
        On macOS, the selection and capture hotkeys may ask for Accessibility
        and Screen Recording permissions the first time you use them.
      </div>
    </div>
  );
}

function HotkeyTip({ keys, label }: { keys: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <KbdKey>{keys}</KbdKey>
      <span className="text-slate-300">{label}</span>
    </li>
  );
}

function KbdKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
      {children}
    </kbd>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[90%] flex-col items-end gap-2">
          {message.selection?.text ? (
            <div className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-[12px] text-slate-300">
              <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-emerald-400/80">
                Selection
                {message.selection.sourceApp ? ` · ${message.selection.sourceApp}` : ""}
              </div>
              <div className="max-h-32 overflow-hidden whitespace-pre-wrap border-l-2 border-emerald-500/40 pl-2 leading-snug">
                {message.selection.text}
              </div>
            </div>
          ) : null}
          {message.image?.dataUrl ? (
            <img
              src={message.image.dataUrl}
              alt="region"
              className="max-h-48 rounded-lg border border-slate-800"
            />
          ) : null}
          <div className="rounded-2xl rounded-br-sm border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2 text-[14px] text-emerald-50">
            <div className="whitespace-pre-wrap">{message.content}</div>
            {message.preset ? (
              <div className="mt-1 text-right text-[10px] font-mono uppercase tracking-wider text-emerald-300/70">
                · {message.preset}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
  if (message.artifact) {
    return (
      <div className="flex justify-start">
        <div className="flex w-full max-w-[96%] flex-col gap-2">
          <ArtifactCard artifact={message.artifact} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div
        className={`flex max-w-[92%] flex-col gap-2 rounded-2xl rounded-bl-sm border border-slate-800/80 bg-slate-900/60 px-3.5 py-2.5 ${
          message.streaming ? "streaming-caret" : ""
        }`}
      >
        {message.streaming && !message.content ? (
          <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            Thinking…
          </div>
        ) : (
          <Markdown content={message.content} />
        )}
        {message.generatedImage?.dataUrl || message.generatedImage?.url ? (
          <figure className="mt-1">
            <img
              src={message.generatedImage.dataUrl || message.generatedImage.url}
              alt={message.generatedImage.caption ?? "generated"}
              className="w-full rounded-lg border border-slate-700/60"
            />
            {message.generatedImage.caption ? (
              <figcaption className="mt-1 text-[11px] italic text-slate-500">
                {message.generatedImage.caption}
              </figcaption>
            ) : null}
          </figure>
        ) : null}
      </div>
    </div>
  );
}

function PresetChipsRow({
  onPick,
  disabled,
  anyAssistant,
}: {
  onPick: (id: string) => void;
  disabled: boolean;
  anyAssistant: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-800/80 bg-slate-950/60 px-3 py-2">
      <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
        {anyAssistant ? "Regenerate" : "Preset"}
      </span>
      {PRESETS.map((p) => (
        <button
          key={p.id}
          disabled={disabled}
          onClick={() => onPick(p.id)}
          title={`${p.hint}  (⌘${p.key})`}
          className="rounded-full border border-slate-800 bg-slate-900/60 px-2.5 py-[3px] text-[11px] text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

type ComposerProps = {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onCancel: () => void;
  isStreaming: boolean;
  placeholder: string;
};

const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  { value, onChange, onKeyDown, onSend, onCancel, isStreaming, placeholder },
  ref,
) {
  return (
    <div className="border-t border-slate-800/80 bg-slate-950/80 px-3 py-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={value}
          rows={1}
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="max-h-40 min-h-[40px] flex-1 resize-none rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-[14px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
        />
        {isStreaming ? (
          <button
            onClick={onCancel}
            className="h-9 shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-[13px] font-medium text-red-300 transition hover:bg-red-500/20"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={onSend}
            className="h-9 shrink-0 rounded-lg bg-emerald-500 px-3 text-[13px] font-semibold text-slate-950 transition enabled:hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
});
