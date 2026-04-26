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
import { ArtifactActionRail, FloatingArtifact } from "./FloatingArtifact";
import {
  CloseIcon,
  DragIcon,
  GearIcon,
  MicIcon,
  SendIcon,
  SparkleIcon,
  StopIcon,
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
  const [, setArtifactProgress] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Stable ref so the onOpen effect (empty deps) can always call the latest sendText.
  const sendTextRef = useRef<((instruction: string) => void) | null>(null);

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

  // Auto-expand when an artifact lands or a notice is surfaced. Context
  // arrival is handled by the IPC onOpen handler below. We deliberately do
  // NOT re-expand on `isStreaming` — if the user closes the shell mid-turn
  // we abort and respect the close.
  useEffect(() => {
    if (lastArtifactMsg || panelNotice) {
      setExpanded(true);
    }
  }, [lastArtifactMsg, panelNotice]);

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
        // Auto-explain: when the user fires the hotkey with selected text,
        // immediately trigger "Explain this" so they get an instant response
        // without needing to type anything. A short delay lets the store
        // settle and the window become visible before the request fires.
        if (sel && payload.explicit) {
          setTimeout(() => {
            sendTextRef.current?.("Explain this");
          }, 80);
        }
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

  // Tuck away to the orb. We abort any in-flight turn AND clear the current
  // output so the auto-expand effect (which re-opens on `lastArtifactMsg` or
  // `panelNotice`) doesn't immediately bounce us back open. Session id +
  // provider label stay — Cmd+K is the hard reset.
  const minimizeShell = useCallback(() => {
    abortRef.current?.abort();
    useSession.getState().clearOutput();
    setExpanded(false);
    setDraft("");
    setPanelNotice(null);
  }, []);

  // Collapse back to orb when the main process requests it (toggle hotkey
  // hides the window). Ensures the panel re-appears as the orb — not the
  // expanded composer — when the user toggles it back on.
  useEffect(() => {
    const off = window.deepFocus?.panel?.onMinimize?.(() => minimizeShell());
    return () => { off?.(); };
  }, [minimizeShell]);

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
  const [, setLastRouting] = useState<RoutingInfo | null>(null);

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

      // Decide which image to send to the artifact router.
      // 1. Explicit region capture (Cmd+Ctrl+S) or caller-provided image wins.
      // 2. Otherwise grab an ambient full-screen snapshot so the model sees
      //    what's actually on screen. Falls back gracefully on any failure.
      let wireImage: string | null = imageUrl;
      if (!wireImage) {
        try {
          const t0 = performance.now();
          const cap = await window.deepFocus?.capture?.fullscreen?.();
          const ms = Math.round(performance.now() - t0);
          if (cap?.dataUrl) {
            wireImage = cap.dataUrl;
            console.info(
              `[chat] ambient full-screen capture attached (${cap.width}×${cap.height}, ${ms}ms)`,
            );
          } else {
            console.info(`[chat] ambient capture unavailable (${ms}ms) — no image context`);
          }
        } catch (err) {
          console.warn("[chat] ambient capture threw — continuing without image:", err);
        }
      }

      try {
        const res = await runArtifact({
          action: "auto",
          text,
          imageDataUrl: wireImage,
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
        const message = err instanceof Error ? err.message : String(err);
        useSession.getState().failMessage(assistantMsg.id, message);
        if (!controller.signal.aborted) {
          setPanelNotice({
            tone: "error",
            title: "That didn't go through",
            body: humanizeBackendError(message),
          });
        }
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
  // Keep the ref in sync so onOpen (empty deps) always holds the current version.
  sendTextRef.current = sendText;

  // --- Run an explicit artifact action (chip click / suggestion) ----

  const runAction = useCallback(
    async (action: ActionSummary | { id: string; label?: string; needs_image?: boolean; needs_text?: boolean }) => {
      if (isStreaming) return;
      const store = useSession.getState();
      // Prefer pending context, but fall back to whatever the previous user
      // turn carried. This is crucial for "Try instead" suggestions: the
      // pending slots are cleared after each send, so without this fallback
      // the backend sees no text/image and 400s.
      let sel = store.pendingSelection;
      let img = store.pendingImage;
      if (!sel?.text && !img?.dataUrl) {
        for (let i = store.messages.length - 1; i >= 0; i -= 1) {
          const m = store.messages[i];
          if (m.role !== "user") continue;
          if (m.selection?.text || m.image?.dataUrl) {
            sel = m.selection ?? null;
            img = m.image ?? null;
            break;
          }
        }
      }
      const hasText = !!sel?.text?.trim();
      const hasImg = !!img?.dataUrl;
      if (action.needs_image && !hasImg) {
        setPanelNotice({
          tone: "warn",
          title: `${action.label ?? action.id} needs an image`,
          body: "Capture a region (Cmd+Ctrl+S) and try again.",
        });
        return;
      }
      if (action.needs_text && !hasText && !hasImg) {
        setPanelNotice({
          tone: "warn",
          title: `${action.label ?? action.id} needs context`,
          body: "Select some text or capture a region first.",
        });
        return;
      }

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
        const message = err instanceof Error ? err.message : String(err);
        useSession.getState().failMessage(assistantMsg.id, message);
        if (!controller.signal.aborted) {
          setPanelNotice({
            tone: "error",
            title: `${action.label ?? action.id} failed`,
            body: humanizeBackendError(message),
          });
        }
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

  // Collapsed: just the orb. (We intentionally ignore `isStreaming` here so
  // a user who hits × during a turn really does collapse — minimizeShell
  // already aborted the in-flight controller.)
  if (!expanded && !lastArtifactMsg && !panelNotice) {
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
        <div className="flex w-[520px] flex-col items-end gap-2.5">
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {lastArtifactMsg?.artifact ? (
                <ArtifactActionRail
                  artifact={lastArtifactMsg.artifact}
                  onClose={dismissArtifact}
                  onFollowUp={followUp}
                  onOpenChat={() => window.deepFocus?.history?.open?.()}
                />
              ) : null}
            </div>
            <TopBar onClose={minimizeShell} />
          </div>

          <AnimatePresence initial={false}>
            {healthWarning ? (
              <motion.div
                key="health"

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

                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={SPRING_SOFT}
              >
                <NoticeBanner
                  notice={panelNotice}
                  onDismiss={() => setPanelNotice(null)}
                />
              </motion.div>
            ) : null}

            {hasContext && !lastArtifactMsg ? (
              <motion.div
                key="context-chip"

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

                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.97 }}
                transition={SPRING}
                className="w-full"
              >
                <FloatingArtifact artifact={lastArtifactMsg.artifact} />
                <SuggestionRow
                  primary={suggestedAction}
                  alternatives={suggestedAlternatives}
                  disabled={isStreaming}
                  onPick={(id, label) =>
                    void runAction({ id, label: label ?? id })
                  }
                />
              </motion.div>
            ) : lastAssistantMsg && lastAssistantMsg.content ? (
              <motion.div
                key={`answer-${lastAssistantMsg.id}`}

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
            ) : null}
          </AnimatePresence>

          {/* Composer is ALWAYS rendered in expanded mode. While a turn is
              streaming, the input is disabled, the whole pill shows the
              traveling emerald border, and the Send button morphs into Stop.
              This is the entire "thinking" UX — no separate blob, no aurora. */}
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={SPRING}
            className="w-full"
          >
            <FloatingComposer
              ref={inputRef}
              value={draft}
              onChange={setDraft}
              streaming={isStreaming}
              onSend={() => {
                const text = draft.trim();
                if (!text) return;
                void sendText(text);
              }}
              onStop={() => abortRef.current?.abort()}
              onMic={() => {
                /* TODO: wire ElevenLabs STT */
              }}
              onClearOutput={dismissArtifact}
              hasOutput={!!lastArtifactMsg || !!lastAssistantMsg}
              placeholder={
                isStreaming
                  ? "Thinking…"
                  : hasContext
                    ? lastAssistantMsg
                      ? "Ask a follow-up…"
                      : "Ask anything about the attached context…"
                    : mode === "region"
                      ? "Ask about the captured region…"
                      : "Ask anything…"
              }
              providerLabel={providerLabel}
            />
          </motion.div>
        </div>
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
// TopBar — drag handle on the left, close (minimize) on the right. Always
// visible while the shell is expanded so the user can grab or dismiss at
// any time, including while a turn is streaming.
// ---------------------------------------------------------------------

function TopBar({ onClose }: { onClose: () => void }) {
  const dragHandlers = useWindowDragHandlers();
  return (
    <div className="flex items-center gap-1">
      <button
        title="Drag to move"
        aria-label="Drag to move"
        className="glass flex h-6 w-6 cursor-grab items-center justify-center rounded-full text-slate-400 hover:text-slate-100 active:cursor-grabbing"
        {...dragHandlers}
      >
        <DragIcon />
      </button>
      <button
        onClick={onClose}
        title="Collapse (Esc)"
        aria-label="Collapse"
        className="glass flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-rose-500/20 hover:text-rose-100"
      >
        <CloseIcon />
      </button>
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
  onDismiss,
}: {
  notice: NonNullable<PanelOpenPayload["notice"]>;
  onDismiss?: () => void;
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
      {onDismiss ? (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="-mr-1 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400/80 transition hover:bg-white/10 hover:text-slate-100"
        >
          <CloseIcon />
        </button>
      ) : null}
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

// Turn raw backend/fetch errors into something a human wants to read. Keeps
// the original detail if we can't recognize it so debugging stays possible.
function humanizeBackendError(raw: string): string {
  const s = raw.trim();
  if (!s) return "Unknown error.";
  // `backend 400: {"detail":"action 'product' needs text context"}`
  const m = /^backend\s+(\d{3}):\s*(.*)$/i.exec(s);
  if (m) {
    const status = Number(m[1]);
    let detail = m[2]?.trim() ?? "";
    try {
      const parsed = JSON.parse(detail);
      if (parsed && typeof parsed === "object" && typeof parsed.detail === "string") {
        detail = parsed.detail;
      }
    } catch {
      /* keep raw detail */
    }
    if (status === 400) return detail || "The backend rejected that request.";
    if (status === 404) return "Backend endpoint not found. Is the API out of date?";
    if (status === 429) return "Rate limited — wait a moment and try again.";
    if (status >= 500) return detail || "Backend hit an internal error. Check the server logs.";
    return detail || s;
  }
  if (/failed to fetch|network|ECONNREFUSED/i.test(s)) {
    return "Couldn't reach the backend. Is `pnpm dev:backend` running?";
  }
  return s;
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
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.04, delayChildren: 0.06 } },
      }}
      className="mt-3 flex max-w-[520px] flex-wrap items-center justify-end gap-1.5"
    >
      <motion.div
        variants={{
          hidden: { opacity: 0, y: 4 },
          visible: { opacity: 1, y: 0, transition: SPRING_SOFT },
        }}
        className="mr-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-slate-400"
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
          whileHover={{ scale: 1.03, y: -1 }}
          whileTap={{ scale: 0.96 }}
          disabled={disabled}
          onClick={() => onPick(s.id, s.label)}
          title={s.reason ?? ""}
          className="glass flex items-center gap-1.5 rounded-full px-3 py-[5px] text-[11px] text-emerald-200 ring-1 ring-emerald-400/40 transition hover:text-emerald-100 hover:ring-emerald-300/70 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
          <span className="font-medium">{prettyActionId(s.label ?? s.id)}</span>
          {s.reason ? (
            <span className="max-w-[220px] truncate font-normal text-slate-300/80">· {s.reason}</span>
          ) : null}
        </motion.button>
      ))}
    </motion.div>
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
          whileHover={{ scale: 1.04, y: -1 }}
          whileTap={{ scale: 0.94 }}
          disabled={disabled}
          onClick={() => onPick(c.prompt)}
          title={c.prompt}
          className="glass rounded-full px-3 py-[5px] text-[11.5px] font-medium text-emerald-200 ring-1 ring-emerald-400/40 transition hover:text-emerald-100 hover:ring-emerald-300/70 disabled:cursor-not-allowed disabled:opacity-40"
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
// Composer pill — mic + text + [send|stop]. Streaming state = subtle
// traveling border + Stop button in place of Send. No separate "thinking"
// surface: this IS the thinking surface while a turn is in flight.
//
// The X button is context-aware:
//   - draft non-empty  → clear the draft
//   - draft empty + output on screen → clear the output (keep session)
//   - neither          → hidden
// Hard close (minimize to orb) lives in the TopBar, not here.
// ---------------------------------------------------------------------

type ComposerProps = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onMic: () => void;
  onClearOutput: () => void;
  hasOutput: boolean;
  streaming: boolean;
  placeholder: string;
  providerLabel: string | null;
};

const FloatingComposer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  function FloatingComposer(
    {
      value,
      onChange,
      onSend,
      onStop,
      onMic,
      onClearOutput,
      hasOutput,
      streaming,
      placeholder,
      providerLabel,
    },
    ref,
  ) {
    const hasDraft = !!value.trim();
    const showClear = hasDraft || hasOutput;

    return (
      <div
        className={
          "glass flex w-full items-end gap-1.5 rounded-[22px] pl-2 pr-1.5 py-1.5 " +
          (streaming ? "glance-streaming-border" : "")
        }
      >
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
          disabled={streaming}
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!streaming) onSend();
            }
          }}
          placeholder={placeholder}
          className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-[14px] text-slate-100 outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:text-slate-300/70"
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
            {showClear ? (
              <motion.button
                onClick={() => (hasDraft ? onChange("") : onClearOutput())}
                aria-label={hasDraft ? "Clear text" : "Clear answer"}
                title={hasDraft ? "Clear text" : "Clear answer"}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.9 }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
              >
                <CloseIcon />
              </motion.button>
            ) : null}
            {streaming ? (
              <motion.button
                onClick={onStop}
                aria-label="Stop"
                title="Stop (Esc)"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                transition={SPRING_BOUNCY}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-500/90 text-white transition hover:bg-rose-400"
              >
                <StopIcon />
              </motion.button>
            ) : (
              <motion.button
                onClick={onSend}
                aria-label="Send"
                disabled={!hasDraft}
                whileHover={hasDraft ? { scale: 1.1, x: 1 } : undefined}
                whileTap={hasDraft ? { scale: 0.9 } : undefined}
                transition={SPRING_BOUNCY}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-slate-950 transition enabled:hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-500"
              >
                <SendIcon />
              </motion.button>
            )}
          </div>
        </div>
      </div>
    );
  },
);
