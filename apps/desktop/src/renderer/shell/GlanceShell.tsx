import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ActionSummary } from "../../shared/artifacts";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "../../shared/artifacts";
import {
  checkHealth,
  listActions,
  runArtifact,
  streamChat,
  streamVision,
  type WireMessage,
} from "../lib/api";
import {
  makeMessageId,
  useSession,
  type AttachedImage,
  type AttachedSelection,
  type ChatMessage,
} from "../stores/session";
import { FloatingArtifact } from "./FloatingArtifact";
import {
  CloseIcon,
  GearIcon,
  MicIcon,
  SendIcon,
  SparkleIcon,
} from "./icons";

/**
 * Glance shell — single morphing element anchored to the bottom-right of
 * the window. States: collapsed (orb) → composer → thinking → artifact.
 */
export function GlanceShell() {
  const messages = useSession((s) => s.messages);
  const isStreaming = useSession((s) => s.isStreaming);
  const pendingSelection = useSession((s) => s.pendingSelection);
  const pendingImage = useSession((s) => s.pendingImage);
  const mode = useSession((s) => s.mode);
  const providerLabel = useSession((s) => s.providerLabel);

  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [healthWarning, setHealthWarning] = useState<string | null>(null);
  const [artifactProgress, setArtifactProgress] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const lastArtifactMsg = useMemo(
    () =>
      [...messages].reverse().find(
        (m) => m.role === "assistant" && !!m.artifact,
      ) ?? null,
    [messages],
  );

  const hasContext = !!pendingSelection?.text || !!pendingImage?.dataUrl;

  // Auto-expand when context arrives or a turn is in flight.
  useEffect(() => {
    if (hasContext || isStreaming || lastArtifactMsg) setExpanded(true);
  }, [hasContext, isStreaming, lastArtifactMsg]);

  // --- Wire up panel open / health -----------------------------------

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
      }
      setExpanded(true);
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
      if (!h) {
        setHealthWarning(
          "Backend offline. Run `pnpm dev:backend` in another terminal.",
        );
      } else if (h.active_error) {
        setHealthWarning(h.active_error);
      } else if (h.active_provider && h.active_model) {
        useSession
          .getState()
          .setProviderLabel(`${h.active_provider} · ${h.active_model}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Esc to collapse, Cmd+K to clear -------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isStreaming) {
          abortRef.current?.abort();
          return;
        }
        collapseShell();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useSession.getState().clear();
        setDraft("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isStreaming]);

  const collapseShell = useCallback(() => {
    setExpanded(false);
    setDraft("");
    const store = useSession.getState();
    store.setPendingSelection(null);
    store.setPendingImage(null);
    // Keep message history in the store so "full chat" still has it.
  }, []);

  // --- Send text turn ------------------------------------------------

  const sendText = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;
      const store = useSession.getState();
      const selection = store.pendingSelection;
      const image = store.pendingImage;

      const userMsg: ChatMessage = {
        id: makeMessageId(),
        role: "user",
        content: text,
        source: store.mode,
        selection: selection ?? null,
        image: image ?? null,
      };
      const assistantMsg: ChatMessage = {
        id: makeMessageId(),
        role: "assistant",
        content: "",
        streaming: true,
        source: store.mode,
      };
      store.appendMessage(userMsg);
      store.appendMessage(assistantMsg);
      store.setStreaming(true);
      setDraft("");
      store.setPendingSelection(null);
      store.setPendingImage(null);

      const controller = new AbortController();
      abortRef.current = controller;

      const wire: WireMessage[] = [{ role: "user", content: text }];
      const handlers = {
        sessionId: store.sessionId,
        preset: null,
        source: store.mode,
        sourceText: selection?.text ?? null,
        windowContext: store.windowContext,
        onMeta: (meta: { provider: string; model: string }) =>
          useSession.getState().setProviderLabel(`${meta.provider} · ${meta.model}`),
        onToken: (delta: string) =>
          useSession.getState().appendToken(assistantMsg.id, delta),
        onDone: ({ sessionId }: { sessionId: string }) => {
          if (sessionId) useSession.getState().setSessionId(sessionId);
          useSession.getState().finalizeMessage(assistantMsg.id);
          useSession.getState().setStreaming(false);
        },
        onError: (msg: string) =>
          useSession.getState().failMessage(assistantMsg.id, msg),
        signal: controller.signal,
        messages: wire,
      };

      try {
        if (image?.dataUrl) {
          await streamVision({ ...handlers, imageDataUrl: image.dataUrl });
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

  // --- Run an artifact action ---------------------------------------

  const runAction = useCallback(
    async (action: ActionSummary) => {
      if (isStreaming) return;
      const store = useSession.getState();
      const sel = store.pendingSelection;
      const img = store.pendingImage;
      const hasText = !!sel?.text?.trim();
      const hasImg = !!img?.dataUrl;
      if (action.needs_image && !hasImg) return;
      if (action.needs_text && !hasText && !hasImg) return;

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
      setArtifactProgress(0);

      try {
        const res = await runArtifact({
          action: action.id,
          text: sel?.text ?? null,
          imageDataUrl: img?.dataUrl ?? null,
          sessionId: store.sessionId,
          windowContext: store.windowContext,
          signal: controller.signal,
          onMeta: (meta) => {
            useSession
              .getState()
              .setProviderLabel(`${meta.provider} · ${meta.model}`);
          },
          onProgress: (chars) => setArtifactProgress(chars),
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
        setArtifactProgress(0);
      }
    },
    [isStreaming],
  );

  // --- Follow-up + redo on the last artifact --------------------------

  const followUp = useCallback(() => {
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const dismissArtifact = useCallback(() => {
    const store = useSession.getState();
    store.clear();
    setDraft("");
    setExpanded(false);
  }, []);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  // Collapsed: just the orb.
  if (!expanded && !isStreaming && !lastArtifactMsg) {
    return (
      <Stage>
        <button
          aria-label="Open Glance"
          className="orb pop-in"
          onClick={() => {
            setExpanded(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      </Stage>
    );
  }

  // Expanded states — context chip + artifact (if any) + composer (if no artifact).
  return (
    <Stage>
      <div className="flex w-full max-w-[520px] flex-col items-end gap-2.5">
        {healthWarning ? (
          <div className="slide-down rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-200">
            {healthWarning}
          </div>
        ) : null}

        {hasContext && !lastArtifactMsg ? (
          <ContextChip
            selection={pendingSelection}
            image={pendingImage}
            onClear={() => {
              useSession.getState().setPendingSelection(null);
              useSession.getState().setPendingImage(null);
            }}
          />
        ) : null}

        {hasContext && !lastArtifactMsg && !isStreaming ? (
          <ActionChips
            hasText={!!pendingSelection?.text}
            hasImage={!!pendingImage?.dataUrl}
            disabled={isStreaming}
            onPick={(a) => void runAction(a)}
          />
        ) : null}

        {isStreaming ? (
          <div className="rise-in flex flex-col items-end gap-2">
            <div className="thinking" />
            <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-slate-400">
              {artifactProgress > 0
                ? `Streaming · ${artifactProgress.toLocaleString()} chars`
                : "Thinking…"}
            </div>
          </div>
        ) : lastArtifactMsg?.artifact ? (
          <FloatingArtifact
            artifact={lastArtifactMsg.artifact}
            onClose={dismissArtifact}
            onFollowUp={followUp}
            onOpenChat={() => window.deepFocus?.history?.open?.()}
          />
        ) : null}

        {/* Composer stays visible when we're not showing an artifact,
            and also when the user explicitly asked for a follow-up. */}
        {!isStreaming ? (
          <FloatingComposer
            ref={inputRef}
            value={draft}
            onChange={setDraft}
            onSend={() => {
              const text = draft.trim();
              if (!text) return;
              void sendText(text);
            }}
            onMic={() => {
              /* TODO: wire ElevenLabs STT */
            }}
            placeholder={
              hasContext
                ? "Ask anything about the attached context…"
                : mode === "region"
                  ? "Ask about the captured region…"
                  : "Ask anything…"
            }
            providerLabel={providerLabel}
            onClose={collapseShell}
          />
        ) : null}
      </div>
    </Stage>
  );
}

// ---------------------------------------------------------------------
// Stage: anchors everything to the bottom-right of the transparent window.
// ---------------------------------------------------------------------

function Stage({ children }: { children: React.ReactNode }) {
  const setPassthrough = (on: boolean) =>
    window.deepFocus?.panel?.setClickThrough?.(on);
  return (
    <div className="pointer-events-none fixed inset-0 flex items-end justify-end p-4">
      <div
        className="pointer-events-auto flex max-h-full flex-col items-end justify-end"
        onMouseEnter={() => setPassthrough(false)}
        onMouseLeave={() => setPassthrough(true)}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Context chip — small, floating, auto-shows selection or image preview
// ---------------------------------------------------------------------

function ContextChip({
  selection,
  image,
  onClear,
}: {
  selection: AttachedSelection | null;
  image: AttachedImage | null;
  onClear: () => void;
}) {
  return (
    <div className="slide-down glass flex max-w-[440px] items-center gap-2 rounded-2xl px-2.5 py-1.5">
      {image?.dataUrl ? (
        <img
          src={image.dataUrl}
          alt="region"
          className="h-7 w-10 rounded-md border border-white/10 object-cover"
        />
      ) : (
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-300">
          <SparkleIcon />
        </div>
      )}
      <div className="min-w-0 flex-1 truncate text-[11.5px] text-slate-200">
        {selection?.text
          ? selection.text.replace(/\s+/g, " ").slice(0, 80)
          : image?.dataUrl
            ? "Captured region"
            : ""}
      </div>
      {selection?.sourceApp ? (
        <span className="shrink-0 rounded-full bg-white/5 px-1.5 py-[1px] text-[9.5px] font-mono uppercase tracking-wider text-slate-400">
          {selection.sourceApp}
        </span>
      ) : null}
      <button
        aria-label="Clear context"
        onClick={onClear}
        className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Action chips — small category-grouped, for artifact actions
// ---------------------------------------------------------------------

function ActionChips({
  hasText,
  hasImage,
  disabled,
  onPick,
}: {
  hasText: boolean;
  hasImage: boolean;
  disabled: boolean;
  onPick: (a: ActionSummary) => void;
}) {
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [category, setCategory] = useState<string>("understand");

  useEffect(() => {
    let cancelled = false;
    listActions().then((list) => {
      if (!cancelled) setActions(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const available = useMemo(
    () =>
      actions.filter((a) => {
        if (a.needs_image && !hasImage) return false;
        if (a.needs_text && !hasText && !hasImage) return false;
        return true;
      }),
    [actions, hasImage, hasText],
  );

  const grouped = useMemo(() => {
    const g: Record<string, ActionSummary[]> = {};
    for (const a of available) (g[a.category] ??= []).push(a);
    return g;
  }, [available]);

  const cats = useMemo(
    () => CATEGORY_ORDER.filter((c) => grouped[c]?.length),
    [grouped],
  );

  useEffect(() => {
    if (cats.length && !cats.includes(category as never)) setCategory(cats[0]);
  }, [cats, category]);

  if (!cats.length) return null;
  const chips = grouped[category] ?? [];

  return (
    <div className="slide-down flex w-full flex-col items-end gap-1.5">
      <div className="flex gap-1">
        {cats.map((c) => {
          const active = c === category;
          return (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={
                "rounded-full px-2 py-[2px] text-[10px] font-mono uppercase tracking-[0.14em] transition " +
                (active
                  ? "bg-emerald-500/15 text-emerald-200"
                  : "text-slate-500 hover:text-slate-300")
              }
            >
              {CATEGORY_LABELS[c]}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-end gap-1.5">
        {chips.map((a) => (
          <button
            key={a.id}
            disabled={disabled}
            onClick={() => onPick(a)}
            title={a.blurb}
            className="rounded-full border border-white/8 bg-slate-900/60 px-3 py-[5px] text-[11.5px] text-slate-200 backdrop-blur-md transition hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Composer pill — mic + text + send
// ---------------------------------------------------------------------

type ComposerProps = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onMic: () => void;
  placeholder: string;
  providerLabel: string | null;
  onClose: () => void;
};

const FloatingComposer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  function FloatingComposer(
    { value, onChange, onSend, onMic, placeholder, providerLabel, onClose },
    ref,
  ) {
    return (
      <div className="pop-in glass flex w-full items-end gap-1.5 rounded-[22px] pl-2 pr-1.5 py-1.5">
        <button
          onClick={onMic}
          aria-label="Voice input"
          title="Voice input (coming soon)"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/5 hover:text-emerald-200"
        >
          <MicIcon />
        </button>
        <textarea
          ref={ref}
          value={value}
          rows={1}
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder}
          className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-[14px] text-slate-100 outline-none placeholder:text-slate-500"
        />
        <div className="flex flex-col items-end gap-0.5">
          {providerLabel ? (
            <div
              className="truncate px-1 font-mono text-[9px] uppercase tracking-widest text-slate-500"
              title={providerLabel}
            >
              {providerLabel}
            </div>
          ) : null}
          <div className="flex items-center gap-1">
            <button
              onClick={() => window.deepFocus?.settings?.open?.()}
              aria-label="Settings"
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
            >
              <GearIcon />
            </button>
            <button
              onClick={onClose}
              aria-label="Collapse"
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
            >
              <CloseIcon />
            </button>
            <button
              onClick={onSend}
              aria-label="Send"
              disabled={!value.trim()}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-slate-950 transition enabled:hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-500"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    );
  },
);
