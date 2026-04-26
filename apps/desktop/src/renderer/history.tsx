import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import {
  getSession,
  listSessions,
  type SessionDetail,
  type SessionListItem,
} from "./lib/api";
import { Markdown } from "./lib/markdown";

function App() {
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [selected, setSelected] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const list = await listSessions(query.trim() || undefined);
      if (!cancelled) {
        setSessions(list);
        setLoading(false);
        if (list.length > 0 && !selected) {
          const first = await getSession(list[0].id);
          if (!cancelled) setSelected(first);
        } else if (list.length === 0) {
          setSelected(null);
        }
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const onPick = async (id: string) => {
    const detail = await getSession(id);
    setSelected(detail);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-200">
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-slate-800/80">
        <div className="border-b border-slate-800/80 p-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search sessions…"
            className="w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-[13px] outline-none placeholder:text-slate-500 focus:border-emerald-500/50"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && sessions.length === 0 ? (
            <div className="p-4 text-[12px] text-slate-500">Loading…</div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-[12px] text-slate-500">
              {query
                ? "No sessions match that query."
                : "No sessions yet. Hit ⌘⇧J somewhere on your screen to start one."}
            </div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => onPick(s.id)}
                className={`block w-full border-b border-slate-900/70 px-3 py-2 text-left transition hover:bg-slate-900/60 ${
                  selected?.id === s.id ? "bg-slate-900/80" : ""
                }`}
              >
                <div className="truncate text-[13px] text-slate-200">
                  {s.snippet}
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-500">
                  <span>{new Date(s.updated_at).toLocaleString()}</span>
                  <span>{s.message_count} msg</span>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <SessionView detail={selected} />
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-slate-500">
            Select a session on the left.
          </div>
        )}
      </main>
    </div>
  );
}

function SessionView({ detail }: { detail: SessionDetail }) {
  const meta = useMemo(() => {
    const first = detail.messages[0]?.created_at;
    const last = detail.messages[detail.messages.length - 1]?.created_at;
    return { first, last };
  }, [detail]);
  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-slate-800/80 pb-3">
        <div className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
          Session {detail.id.slice(0, 8)}
        </div>
        <div className="mt-1 text-[12px] text-slate-400">
          {meta.first ? new Date(meta.first).toLocaleString() : "—"}
          {meta.last && meta.last !== meta.first
            ? ` · ${new Date(meta.last).toLocaleString()}`
            : ""}
        </div>
      </header>
      <div className="flex flex-col gap-4">
        {detail.messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-[13.5px] ${
                m.role === "user"
                  ? "rounded-br-sm border border-emerald-500/25 bg-emerald-500/10 text-emerald-50"
                  : "rounded-bl-sm border border-slate-800/80 bg-slate-900/60 text-slate-200"
              }`}
            >
              {m.source_text ? (
                <div className="mb-2 whitespace-pre-wrap rounded border-l-2 border-emerald-500/40 bg-slate-900/50 px-2 py-1 text-[11.5px] text-slate-300">
                  {m.source_text}
                </div>
              ) : null}
              {m.role === "assistant" ? (
                <Markdown content={m.content} />
              ) : (
                <div className="whitespace-pre-wrap">{m.content}</div>
              )}
              {m.preset ? (
                <div className="mt-1 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                  · {m.preset}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
