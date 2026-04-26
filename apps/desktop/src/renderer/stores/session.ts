import { create } from "zustand";

import type { PanelMode, WindowContext } from "../../shared/ipc";

export type ChatRole = "user" | "assistant" | "system";

export type AttachedImage = {
  dataUrl: string;
  width?: number;
  height?: number;
  savedPath?: string | null;
};

export type AttachedSelection = {
  text: string;
  sourceApp?: string | null;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  /** True while the assistant is still streaming tokens into this message. */
  streaming?: boolean;
  /** Provenance: 'just-ask' | 'selection' | 'region'. */
  source?: PanelMode;
  /** Preset applied to this turn, if any. */
  preset?: string | null;
  /** Verbatim selection attached to a user turn (selection mode). */
  selection?: AttachedSelection | null;
  /** Image attached to a user turn (region mode). */
  image?: AttachedImage | null;
  /** Image generated *by the assistant* (Visual Metaphor preset). */
  generatedImage?: { dataUrl?: string; url?: string; caption?: string } | null;
};

type SessionState = {
  sessionId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  providerLabel: string | null;
  // Context attached to the *next* turn — cleared after send.
  pendingSelection: AttachedSelection | null;
  pendingImage: AttachedImage | null;
  mode: PanelMode;
  windowContext: WindowContext | null;

  setSessionId: (id: string | null) => void;
  setProviderLabel: (label: string | null) => void;
  appendMessage: (msg: ChatMessage) => void;
  appendToken: (id: string, delta: string) => void;
  finalizeMessage: (id: string) => void;
  failMessage: (id: string, errorText: string) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  removeLastAssistantFor: (userId: string) => void;
  setStreaming: (on: boolean) => void;
  setPendingSelection: (sel: AttachedSelection | null) => void;
  setPendingImage: (img: AttachedImage | null) => void;
  setMode: (mode: PanelMode) => void;
  setWindowContext: (ctx: WindowContext | null) => void;
  clear: () => void;
};

export const useSession = create<SessionState>((set) => ({
  sessionId: null,
  messages: [],
  isStreaming: false,
  providerLabel: null,
  pendingSelection: null,
  pendingImage: null,
  mode: "just-ask",
  windowContext: null,

  setSessionId: (id) => set({ sessionId: id }),
  setProviderLabel: (label) => set({ providerLabel: label }),
  appendMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  appendToken: (id, delta) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + delta } : m,
      ),
    })),
  finalizeMessage: (id) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, streaming: false } : m)),
    })),
  failMessage: (id, errorText) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id
          ? {
              ...m,
              streaming: false,
              content: `${m.content}${m.content ? "\n\n" : ""}⚠️ ${errorText}`,
            }
          : m,
      ),
    })),
  updateMessage: (id, patch) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  removeLastAssistantFor: (userId) =>
    set((state) => {
      const idx = state.messages.findIndex((m) => m.id === userId);
      if (idx === -1) return state;
      const cleaned = [...state.messages];
      // drop any assistant messages that come *after* this user message
      for (let i = cleaned.length - 1; i > idx; i--) {
        if (cleaned[i].role === "assistant") {
          cleaned.splice(i, 1);
        }
      }
      return { messages: cleaned };
    }),
  setStreaming: (on) => set({ isStreaming: on }),
  setPendingSelection: (sel) => set({ pendingSelection: sel }),
  setPendingImage: (img) => set({ pendingImage: img }),
  setMode: (mode) => set({ mode }),
  setWindowContext: (ctx) => set({ windowContext: ctx }),
  clear: () =>
    set({
      sessionId: null,
      messages: [],
      isStreaming: false,
      pendingSelection: null,
      pendingImage: null,
      mode: "just-ask",
    }),
}));

export function makeMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const PRESETS: { id: string; label: string; hint: string; key: string }[] = [
  { id: "simplify", label: "Simplify", hint: "Plain language, short bullets", key: "1" },
  { id: "analogy", label: "Analogy", hint: "Vivid real-world analogy", key: "2" },
  { id: "visual", label: "Visual", hint: "Cinematic description + image", key: "3" },
  { id: "funfacts", label: "Fun facts", hint: "Three did-you-knows", key: "4" },
  { id: "intuition", label: "Intuition", hint: "First principles", key: "5" },
];
