import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";

import type { ActionSummary, SuggestedAction } from "../../shared/artifacts";
import type { PanelOpenPayload } from "../../shared/ipc";
import {
  checkHealth,
  runArtifact,
  type RoutingInfo,
} from "../lib/api";
import {
  makeMessageId,
  useSession,
  type AttachedImage,
  type AttachedSelection,
  type ChatMessage,
} from "../stores/session";
import { Markdown } from "../lib/markdown";
import { FloatingArtifact } from "./FloatingArtifact";
import {
  CloseIcon,
  GearIcon,
  MicIcon,
  SendIcon,
  SparkleIcon,
} from "./icons";

// ---------------------------------------------------------------------
// Framer Motion reusable transitions.
// We lean on a single "butter" spring everywhere so state morphs feel
// cohesive — the orb, composer, artifact, and thinking pill share a family.
// ---------------------------------------------------------------------
const SPRING = { type: "spring", stiffness: 420, damping: 36, mass: 0.9 } as const;
const SPRING_BOUNCY = { type: "spring", stiffness: 520, damping: 26, mass: 0.9 } as const;
const SPRING_SOFT = { type: "spring", stiffness: 280, damping: 30 } as const;

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
  const [panelNotice, setPanelNotice] = useState<
    NonNullable<PanelOpenPayload["notice"]> | null
  >(null);
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

  // The most recent assistant text turn — either mid-stream or finished. Used
  // to drive the FloatingAnswer card so a plain-text response (e.g. what a
  // smart crumb produces) actually shows up in the panel.
  const lastAssistantMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      if (m.artifact) return null; // artifact takes precedence
      if (m.content || m.streaming) return m;
      return null;
    }
    return null;
  }, [messages]);

  const hasContext = !!pendingSelection?.text || !!pendingImage?.dataUrl;

  // Auto-expand while a turn is streaming, when an artifact lands, or when
  // the main process surfaces a notice. Context arrival is handled by the
  // IPC onOpen handler below so the user can collapse-with-context and have
  // the orb stay collapsed until they explicitly tap it again.
  useEffect(() => {
    if (isStreaming || lastArtifactMsg || panelNotice) {
      setExpanded(true);
    }
  }, [isStreaming, lastArtifactMsg, panelNotice]);

  // --- Wire up panel open / health -----------------------------------

  useEffect(() => {
    const off = window.deepFocus?.panel?.onOpen?.((payload) => {
      const store = useSession.getState();
      store.setMode(payload.mode);
      store.setWindowContext(payload.windowContext ?? null);

      let shouldExpand = false;
      if (payload.notice) {
        setPanelNotice(payload.notice);
        shouldExpand = true;
      }
      if (payload.mode === "selection") {
        const sel = payload.selectionText
          ? { text: payload.selectionText, sourceApp: payload.sourceApp ?? null }
          : null;
        // New capture → drop prior output so the shell refocuses on this
        // context instead of showing the previous artifact/answer.
        if (sel) store.clearOutput();
        store.setPendingSelection(sel);
        store.setPendingImage(null);
        shouldExpand = !!sel;
      } else if (payload.mode === "region") {
        if (payload.imageDataUrl) {
          // New capture → drop prior output so the shell refocuses on this
          // region. The backend session id stays so follow-ups can reference
          // earlier turns if the user types one.
          store.clearOutput();
          store.setPendingImage({
            dataUrl: payload.imageDataUrl,
            width: payload.width,
            height: payload.height,
            savedPath: payload.imagePath ?? null,
          });
          shouldExpand = true;
        }
        store.setPendingSelection(null);
      } else if (payload.mode === "just-ask") {
        // Hotkey/tray/"ask a question" — open the composer immediately.
        // Startup nudge (no explicit intent) leaves us collapsed as an orb.
        shouldExpand = !!payload.explicit;
      }
      if (shouldExpand) {
        setExpanded(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
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

  // ONE universal dismiss gesture: tuck away to the orb, preserve state.
  // Context survives across minimize/reopen. To nuke everything (context +
  // chat history) use Cmd+K — that's the one explicit reset.
  const minimizeShell = useCallback(() => {
    setExpanded(false);
    setDraft("");
    setPanelNotice(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isStreaming) {
          abortRef.current?.abort();
          return;
        }
        minimizeShell();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useSession.getState().clear();
        setDraft("");
        setPanelNotice(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isStreaming, minimizeShell]);

  // Routing info for the in-flight auto turn (what the agent *picked*). This
  // lets the thinking pill show a "Routing → Explain code" breadcrumb before
  // the artifact lands, and drives the suggestion chips beside the artifact.
  const [lastRouting, setLastRouting] = useState<RoutingInfo | null>(null);

  // --- Run an auto-routed artifact (composer free-form) --------------
  //
  // Every composer submission goes through `/artifact` with action="auto"
  // — the backend's router picks the best artifact kind. Free-form prose
  // questions land as `kind: "answer"` and render in the answer card, so
  // the experience is unified: one pipeline, one output container, one
  // place for suggestions.

  const runAuto = useCallback(
    async (
      instruction: string,
      opts?: { preferText?: string | null; preferImageDataUrl?: string | null },
    ) => {
      if (isStreaming) return;
      const store = useSession.getState();
      const selection = store.pendingSelection;
      const image = store.pendingImage;
      const imageUrl = opts?.preferImageDataUrl ?? image?.dataUrl ?? null;
      const text = opts?.preferText ?? selection?.text ?? null;
      const trimmedInstr = instruction.trim();
      if (!trimmedInstr && !text && !imageUrl) return;

      const userMsg: ChatMessage = {
        id: makeMessageId(),
        role: "user",
        content: trimmedInstr || (text ? text.slice(0, 160) : "(image context)"),
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
        action: "auto",
      };
      store.appendMessage(userMsg);
      store.appendMessage(assistantMsg);
      store.setStreaming(true);
      setDraft("");
      store.setPendingSelection(null);
      store.setPendingImage(null);
      setLastRouting(null);
      setArtifactProgress(0);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await runArtifact({
          action: "auto",
          text,
          imageDataUrl: imageUrl,
          userInstruction: trimmedInstr || null,
          sessionId: store.sessionId,
          windowContext: store.windowContext,
          signal: controller.signal,
          onMeta: (meta) => {
            useSession
              .getState()
              .setProviderLabel(`${meta.provider} · ${meta.model}`);
          },
          onProgress: (chars) => setArtifactProgress(chars),
          onRouting: (routing) => {
            setLastRouting(routing);
            useSession.getState().updateMessage(assistantMsg.id, {
              action: routing.action,
            });
          },
        });
        useSession.getState().updateMessage(assistantMsg.id, {
          streaming: false,
          artifact: res.artifact,
          content: "",
          action: res.meta?.routed_action ?? assistantMsg.action ?? "auto",
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

  // Back-compat shim: any legacy caller that used sendText stays working.
  const sendText = runAuto;

  // --- Run an explicit artifact action (chip click / suggestion) ----

  const runAction = useCallback(
    async (action: ActionSummary | { id: string; label?: string; needs_image?: boolean; needs_text?: boolean }) => {
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
        content: action.label ?? action.id,
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

  // Artifact / answer "Dismiss" → actually clear the visible output so the
  // next capture (or the next question) starts on a blank slate. Backend
  // session id stays, so follow-ups still reference the same conversation
  // from the user's POV if they type one before capturing anything new.
  // The full-chat window still has the history. Cmd+K is the hard reset
  // (wipes session id too).
  const dismissArtifact = useCallback(() => {
    useSession.getState().clearOutput();
    setPanelNotice(null);
    setDraft("");
  }, []);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  // Collapsed: just the orb.
  if (!expanded && !isStreaming && !lastArtifactMsg && !panelNotice) {
    return (
      <Stage>
        <LayoutGroup id="glance-shell">
          <AnimatePresence mode="wait">
            <motion.div
              key="orb"
              layout
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.3, opacity: 0 }}
              transition={SPRING_BOUNCY}
            >
              <DraggableOrb
                onClick={() => {
                  setExpanded(true);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              />
            </motion.div>
          </AnimatePresence>
        </LayoutGroup>
      </Stage>
    );
  }

  // Expanded states — context chip + artifact (if any) + composer (if no artifact).
  const suggestedAction: SuggestedAction | null =
    (lastArtifactMsg?.artifact as unknown as { suggested_action?: SuggestedAction })?.suggested_action ?? null;
  const suggestedAlternatives: SuggestedAction[] =
    (lastArtifactMsg?.artifact as unknown as { suggested_alternatives?: SuggestedAction[] })?.suggested_alternatives ?? [];

  return (
    <Stage>
      <LayoutGroup id="glance-shell">
        <motion.div
          layout
          transition={SPRING_SOFT}
          className="flex w-[520px] flex-col items-end gap-2.5"
        >
          <DragGrip />

          <AnimatePresence initial={false}>
            {healthWarning ? (
              <motion.div
                key="health"
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={SPRING_SOFT}
                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-200"
              >
                {healthWarning}
              </motion.div>
            ) : null}

            {panelNotice ? (
              <motion.div
                key="notice"
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={SPRING_SOFT}
              >
                <NoticeBanner notice={panelNotice} />
              </motion.div>
            ) : null}

            {hasContext && !lastArtifactMsg ? (
              <motion.div
                key="context-chip"
                layout
                initial={{ opacity: 0, y: -6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.96 }}
                transition={SPRING}
              >
                <ContextChip selection={pendingSelection} image={pendingImage} />
              </motion.div>
            ) : null}

            {hasContext && !lastArtifactMsg && !lastAssistantMsg && !isStreaming ? (
              <motion.div
                key="smart-crumbs"
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <SmartCrumbs
                  selection={pendingSelection}
                  image={pendingImage}
                  disabled={isStreaming}
                  onPick={(prompt) => {
                    setDraft(prompt);
                    void sendText(prompt);
                  }}
                />
              </motion.div>
            ) : null}

            {/* Answer card / Artifact card / shimmer — in that precedence. */}
            {lastArtifactMsg?.artifact ? (
              <motion.div
                key={`artifact-${lastArtifactMsg.id}`}
                layout
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.97 }}
                transition={SPRING}
                className="w-full"
              >
                <FloatingArtifact
                  artifact={lastArtifactMsg.artifact}
                  onClose={dismissArtifact}
                  onFollowUp={followUp}
                  onOpenChat={() => window.deepFocus?.history?.open?.()}
                />
                <SuggestionRow
                  primary={suggestedAction}
                  alternatives={suggestedAlternatives}
                  disabled={isStreaming}
                  onPick={(id, label) =>
                    void runAction({ id, label: label ?? id })
                  }
                />
              </motion.div>
            ) : lastAssistantMsg ? (
              <motion.div
                key={`answer-${lastAssistantMsg.id}`}
                layout
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.97 }}
                transition={SPRING}
                className="w-full"
              >
                <FloatingAnswer
                  text={lastAssistantMsg.content}
                  streaming={!!lastAssistantMsg.streaming}
                  onClose={dismissArtifact}
                />
              </motion.div>
            ) : isStreaming ? (
              <motion.div
                key="shimmer"
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={SPRING}
                className="w-full"
              >
                <StreamingShimmer />
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Composer vs InlineThinking — single crossfade slot, shared
              layout so they morph smoothly when a turn starts/ends. */}
          <AnimatePresence mode="wait" initial={false}>
            {isStreaming ? (
              <motion.div
                key="thinking"
                layout
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={SPRING}
                className="w-full"
              >
                <InlineThinking
                  chars={
                    lastAssistantMsg?.content.length ??
                    (artifactProgress > 0 ? artifactProgress : 0)
                  }
                  routing={lastRouting}
                  onAbort={() => abortRef.current?.abort()}
                />
              </motion.div>
            ) : (
              <motion.div
                key="composer"
                layout
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={SPRING}
                className="w-full"
              >
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
                      ? lastAssistantMsg
                        ? "Ask a follow-up…"
                        : "Ask anything about the attached context…"
                      : mode === "region"
                        ? "Ask about the captured region…"
                        : "Ask anything…"
                  }
                  providerLabel={providerLabel}
                  onClose={minimizeShell}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </LayoutGroup>
    </Stage>
  );
}

// ---------------------------------------------------------------------
// Stage: anchors everything to the bottom-right of the transparent window.
// ---------------------------------------------------------------------

// Stage sizes the Electron window to exactly match its content plus a wide
// transparent halo on every side. The halo is where box-shadows, orb glows,
// and artifact drop shadows fade out smoothly. Without it, shadows hit the
// window edge and render a sharp rectangular cutoff. The extra transparent
// area is invisible and doesn't swallow clicks on the app beneath because
// pointer-events is `none` on the Stage itself — only real UI children
// (orb / composer / grip / artifact) opt into pointer-events via `auto`.
const HALO_MARGIN = 72;

function Stage({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const push = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.ceil(rect.width) + HALO_MARGIN * 2;
      const h = Math.ceil(rect.height) + HALO_MARGIN * 2;
      window.deepFocus?.panel?.setContentSize?.(w, h);
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="pointer-events-none inline-flex flex-col items-end gap-2.5 [&>*]:pointer-events-auto"
      style={{ margin: HALO_MARGIN, width: "fit-content" }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------
// Drag grip — small handle users can grab to move the whole window.
// ---------------------------------------------------------------------

function DragGrip() {
  const handlers = useWindowDragHandlers();
  return (
    <div
      title="Drag to move Glance"
      className="slide-down glass flex h-5 w-14 cursor-grab items-center justify-center rounded-full active:cursor-grabbing"
      {...handlers}
    >
      <div className="flex gap-0.5">
        <span className="h-1 w-1 rounded-full bg-slate-400/70" />
        <span className="h-1 w-1 rounded-full bg-slate-400/70" />
        <span className="h-1 w-1 rounded-full bg-slate-400/70" />
        <span className="h-1 w-1 rounded-full bg-slate-400/70" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// DraggableOrb — click to open, press-and-drag to move the window.
// We implement drag manually (not via -webkit-app-region) because the
// native drag region swallows click events and :hover styles on Electron.
// ---------------------------------------------------------------------

const DRAG_THRESHOLD_PX = 4;

function useWindowDragHandlers(onClick?: () => void) {
  const stateRef = useRef<{
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stateRef.current = { startX: e.screenX, startY: e.screenY, moved: false };
    window.deepFocus?.panel?.dragStart?.(e.screenX, e.screenY);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = stateRef.current;
    if (!s) return;
    const dx = e.screenX - s.startX;
    const dy = e.screenY - s.startY;
    if (!s.moved && dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
      return;
    }
    s.moved = true;
    window.deepFocus?.panel?.dragMove?.(e.screenX, e.screenY);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const s = stateRef.current;
      stateRef.current = null;
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      if (s && !s.moved) {
        onClick?.();
      }
    },
    [onClick],
  );

  return { onPointerDown, onPointerMove, onPointerUp };
}

function DraggableOrb({ onClick }: { onClick: () => void }) {
  const handlers = useWindowDragHandlers(onClick);
  return (
    <motion.button
      layoutId="glance-core"
      aria-label="Open Glance (drag to reposition)"
      title="Click to open · drag to move"
      className="orb"
      whileHover={{ scale: 1.12, rotate: -4 }}
      whileTap={{ scale: 0.88, rotate: 6 }}
      transition={SPRING_BOUNCY}
      {...handlers}
    />
  );
}

// ---------------------------------------------------------------------
// Context chip — small, floating, auto-shows selection or image preview
// ---------------------------------------------------------------------

function ContextChip({
  selection,
  image,
}: {
  selection: AttachedSelection | null;
  image: AttachedImage | null;
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
    </div>
  );
}

// ---------------------------------------------------------------------
// Notice banner — main-process warnings/errors surfaced in the shell
// (e.g. Screen Recording permission missing). Dismissable, with an
// optional deep-link button.
// ---------------------------------------------------------------------

function NoticeBanner({
  notice,
}: {
  notice: NonNullable<PanelOpenPayload["notice"]>;
}) {
  const tone = notice.tone ?? "warn";
  const palette =
    tone === "error"
      ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
      : tone === "info"
        ? "border-sky-500/40 bg-sky-500/10 text-sky-100"
        : "border-amber-500/40 bg-amber-500/10 text-amber-100";
  return (
    <div
      className={
        "slide-down flex max-w-[480px] items-start gap-2 rounded-2xl border px-3 py-2 text-[12px] " +
        palette
      }
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium leading-tight">{notice.title}</div>
        {notice.body ? (
          <div className="mt-1 text-[11px] leading-snug text-slate-200/80">
            {notice.body}
          </div>
        ) : null}
        {notice.action ? (
          <button
            onClick={() =>
              window.deepFocus?.shell?.openExternal?.(notice.action!.href)
            }
            className="mt-2 rounded-full border border-white/20 bg-white/5 px-2.5 py-[3px] text-[11px] font-medium text-slate-100 transition hover:bg-white/10"
          >
            {notice.action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// FloatingAnswer — a readable, streaming-aware text card. Renders the
// assistant's plain-text response (what smart crumbs and free-form text
// turns produce). Structured JSON responses are rendered by FloatingArtifact
// instead; this is the fallback / default path.
// ---------------------------------------------------------------------

function FloatingAnswer({
  text,
  streaming,
  onClose,
}: {
  text: string;
  streaming: boolean;
  onClose?: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Autoscroll to the newest token so long streams stay in view without
  // stealing focus from the composer.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <div
      className={
        "rise-in glass relative w-full max-w-[520px] rounded-[22px] px-4 py-3 " +
        (streaming ? "glance-streaming-border" : "")
      }
    >
      {onClose && !streaming ? (
        <button
          onClick={onClose}
          aria-label="Clear answer"
          title="Clear answer (Cmd+K wipes everything)"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
        >
          <CloseIcon />
        </button>
      ) : null}
      <div
        ref={scrollerRef}
        className={
          "glance-answer max-h-[360px] overflow-y-auto text-[13.5px] leading-relaxed text-slate-100" +
          (onClose && !streaming ? " pr-7" : "")
        }
      >
        {text ? <Markdown content={text} /> : streaming ? " " : ""}
        {streaming ? <span className="glance-caret" /> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// InlineThinking — replaces the composer while a turn streams. A compact
// pill with a swirling aurora bead + live token count + abort affordance.
// Inspired by the ChatGPT voice-mode bloom but scaled for a 520px shell.
// ---------------------------------------------------------------------

function InlineThinking({
  chars,
  routing,
  onAbort,
}: {
  chars: number;
  routing: RoutingInfo | null;
  onAbort: () => void;
}) {
  const label =
    chars > 0 ? `${chars.toLocaleString()} chars` : "Listening to the model…";
  // Pretty-print the chosen action so users can see the agent's decision
  // land *before* the artifact does. "answer" is conversational; hide it.
  const routedLabel =
    routing && routing.action && routing.action !== "answer"
      ? prettyActionId(routing.action)
      : null;
  return (
    <div className="glass flex w-full items-center gap-3 rounded-[22px] px-3 py-2">
      <motion.div
        layoutId="glance-core"
        className="aurora-bead"
        aria-hidden
        transition={SPRING}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-slate-100">
          <span>Thinking</span>
          <span className="glance-dots">
            <span />
            <span />
            <span />
          </span>
          <AnimatePresence>
            {routedLabel ? (
              <motion.span
                key={routedLabel}
                initial={{ opacity: 0, x: -6, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -6, scale: 0.9 }}
                transition={SPRING_SOFT}
                className="ml-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-[1px] text-[10px] font-mono uppercase tracking-[0.12em] text-emerald-200"
                title={routing?.reason ?? ""}
              >
                → {routedLabel}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
          {label}
        </div>
      </div>
      <motion.button
        onClick={onAbort}
        className="ghost-btn shrink-0"
        title="Abort (Esc)"
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.94 }}
      >
        Stop
      </motion.button>
    </div>
  );
}

function prettyActionId(id: string): string {
  return id
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------
// SuggestionRow — "this looks like code. Try explain_code?"
// Rendered beside an artifact when the agent (or the router) thinks a
// different artifact kind is actually a better fit. Click → rerun as
// that kind with the same context.
// ---------------------------------------------------------------------

function SuggestionRow({
  primary,
  alternatives,
  disabled,
  onPick,
}: {
  primary: SuggestedAction | null;
  alternatives: SuggestedAction[];
  disabled: boolean;
  onPick: (id: string, label?: string) => void;
}) {
  const items: SuggestedAction[] = [];
  if (primary?.id) items.push(primary);
  for (const a of alternatives) {
    if (a?.id && !items.find((i) => i.id === a.id)) items.push(a);
  }
  if (!items.length) return null;
  return (
    <motion.div
      layout
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.04, delayChildren: 0.06 } },
      }}
      className="mt-2 flex max-w-[520px] flex-wrap justify-end gap-1.5"
    >
      <motion.div
        variants={{
          hidden: { opacity: 0, y: 4 },
          visible: { opacity: 1, y: 0, transition: SPRING_SOFT },
        }}
        className="mr-1 self-center font-mono text-[9.5px] uppercase tracking-[0.16em] text-slate-400"
      >
        Try instead
      </motion.div>
      {items.map((s, i) => (
        <motion.button
          key={`${s.id}-${i}`}
          variants={{
            hidden: { opacity: 0, y: 6, scale: 0.94 },
            visible: { opacity: 1, y: 0, scale: 1, transition: SPRING },
          }}
          whileHover={{ scale: 1.05, y: -1 }}
          whileTap={{ scale: 0.95 }}
          disabled={disabled}
          onClick={() => onPick(s.id, s.label)}
          title={s.reason ?? ""}
          className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-[5px] text-[11px] text-emerald-100 transition hover:border-emerald-400/60 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {prettyActionId(s.label ?? s.id)}
          {s.reason ? (
            <span className="ml-1.5 font-normal text-emerald-200/60">· {s.reason}</span>
          ) : null}
        </motion.button>
      ))}
    </motion.div>
  );
}

// ---------------------------------------------------------------------
// StreamingShimmer — placeholder while we've kicked a turn off but haven't
// received the first token yet. Three softly-pulsing bars; dies as soon as
// FloatingAnswer has anything to show.
// ---------------------------------------------------------------------

function StreamingShimmer() {
  return (
    <div className="rise-in glass w-full max-w-[520px] rounded-[22px] px-4 py-3">
      <div className="flex flex-col gap-2">
        <div className="glance-shimmer h-3 w-5/6 rounded-md" />
        <div className="glance-shimmer h-3 w-4/6 rounded-md" />
        <div className="glance-shimmer h-3 w-3/6 rounded-md" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Smart crumbs — context-aware one-tap prompts. Heuristics over the
// attached selection/image/sourceApp produce 3–4 short suggestions that
// auto-send when tapped, so the user never sees a "plain empty" panel.
// ---------------------------------------------------------------------

function SmartCrumbs({
  selection,
  image,
  disabled,
  onPick,
}: {
  selection: AttachedSelection | null;
  image: AttachedImage | null;
  disabled: boolean;
  onPick: (prompt: string) => void;
}) {
  const crumbs = useMemo(
    () => buildSmartCrumbs({ selection, image }),
    [selection, image],
  );
  if (!crumbs.length) return null;

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.035, delayChildren: 0.04 } },
      }}
      className="flex max-w-[480px] flex-wrap justify-end gap-1.5"
    >
      {crumbs.map((c) => (
        <motion.button
          key={c.label}
          variants={{
            hidden: { opacity: 0, y: 6, scale: 0.94 },
            visible: { opacity: 1, y: 0, scale: 1, transition: SPRING },
          }}
          whileHover={{ scale: 1.06, y: -1 }}
          whileTap={{ scale: 0.94 }}
          disabled={disabled}
          onClick={() => onPick(c.prompt)}
          title={c.prompt}
          className="rounded-full border border-emerald-500/25 bg-emerald-500/5 px-3 py-[5px] text-[11.5px] text-emerald-100/90 transition hover:border-emerald-400/60 hover:bg-emerald-500/15 hover:text-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {c.label}
        </motion.button>
      ))}
    </motion.div>
  );
}

type Crumb = { label: string; prompt: string };

function buildSmartCrumbs({
  selection,
  image,
}: {
  selection: AttachedSelection | null;
  image: AttachedImage | null;
}): Crumb[] {
  const out: Crumb[] = [];
  const text = selection?.text?.trim() ?? "";
  const app = (selection?.sourceApp ?? "").toLowerCase();

  if (text) {
    const codeyApp = /code|xcode|terminal|iterm|intellij|pycharm|webstorm|vim|nvim|sublime/.test(
      app,
    );
    const codeyText =
      /[{};]|=>|function\s|def\s|class\s|import\s|#include|console\.|error:|traceback/i.test(
        text,
      );
    const urly = /\bhttps?:\/\//i.test(text);
    const looksLikeError = /\b(error|exception|traceback|failed|undefined|null)\b/i.test(
      text,
    );
    const longish = text.length > 260;
    const nonEnglish = /[\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\u0600-\u06FF]/.test(
      text,
    );

    if (codeyApp || codeyText) {
      out.push({ label: "Explain this code", prompt: "Explain what this code does, step by step." });
      if (looksLikeError) {
        out.push({ label: "Diagnose error", prompt: "What is causing this error and how do I fix it?" });
      } else {
        out.push({ label: "Find bugs", prompt: "Review this for bugs, edge cases, and smells." });
      }
      out.push({ label: "Improve", prompt: "Suggest a cleaner, more idiomatic version." });
    } else {
      out.push({ label: "Explain", prompt: "Explain this clearly and concisely." });
      if (longish) {
        out.push({ label: "TL;DR", prompt: "Give me a 2–3 sentence TL;DR." });
      } else {
        out.push({ label: "What does this mean?", prompt: "What does this mean in context?" });
      }
      if (nonEnglish) {
        out.push({ label: "Translate → English", prompt: "Translate this to English." });
      } else {
        out.push({ label: "Simplify", prompt: "Rewrite this in plain language a 10-year-old could grasp." });
      }
      if (urly) {
        out.push({ label: "Summarize link", prompt: "Summarize what this link is likely about." });
      }
    }
    out.push({ label: "Ask something else…", prompt: "" });
  } else if (image?.dataUrl) {
    out.push({ label: "Describe", prompt: "Describe everything visible in this region, concisely." });
    out.push({ label: "Extract text", prompt: "Extract all legible text verbatim." });
    out.push({
      label: "Translate → English",
      prompt:
        "Detect any non-English text in this image and translate it to English. " +
        "Preserve the layout when possible, and note the detected source language.",
    });
    out.push({ label: "Explain", prompt: "Explain what this is and why it matters." });
    out.push({ label: "What should I do?", prompt: "Given this, what's the most useful next action I can take?" });
  }

  // Keep it tight — up to 5 chips; flex-wrap takes care of anything that
  // won't fit on one row of the 520px shell.
  return out.filter((c) => c.prompt).slice(0, 5);
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
      <div className="glass flex w-full items-end gap-1.5 rounded-[22px] pl-2 pr-1.5 py-1.5">
        <motion.button
          onClick={onMic}
          aria-label="Voice input"
          title="Voice input (coming soon)"
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.9 }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/5 hover:text-emerald-200"
        >
          <MicIcon />
        </motion.button>
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
            <motion.button
              onClick={() => window.deepFocus?.settings?.open?.()}
              aria-label="Settings"
              whileHover={{ scale: 1.08, rotate: 12 }}
              whileTap={{ scale: 0.92, rotate: -6 }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
            >
              <GearIcon />
            </motion.button>
            <motion.button
              onClick={onClose}
              aria-label="Collapse"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.9 }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
            >
              <CloseIcon />
            </motion.button>
            <motion.button
              onClick={onSend}
              aria-label="Send"
              disabled={!value.trim()}
              whileHover={value.trim() ? { scale: 1.1, x: 1 } : undefined}
              whileTap={value.trim() ? { scale: 0.9 } : undefined}
              transition={SPRING_BOUNCY}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-slate-950 transition enabled:hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-500"
            >
              <SendIcon />
            </motion.button>
          </div>
        </div>
      </div>
    );
  },
);
