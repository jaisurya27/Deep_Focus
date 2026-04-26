import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import { checkHealth, clearAllSessions, type HealthResponse } from "./lib/api";
import type { Settings } from "../shared/ipc";

type HotkeyName =
  | "justAsk"
  | "regionCapture"
  | "togglePanel"
  | "toggleFocusMode";

const HOTKEYS: { name: HotkeyName; label: string; description: string }[] = [
  {
    name: "justAsk",
    label: "Ask / Explain selection",
    description: "Opens the panel. If text is selected in the foreground app, explains it automatically.",
  },
  {
    name: "regionCapture",
    label: "Region capture",
    description: "Drag a rectangle; the panel opens with that region attached.",
  },
  { name: "togglePanel", label: "Toggle panel", description: "Show/hide the last panel." },
  {
    name: "toggleFocusMode",
    label: "Focus mode",
    description: "Webcam-based focus monitor (phase 5).",
  },
];

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keyState, setKeyState] = useState<{ xai: boolean; openai: boolean }>({
    xai: false,
    openai: false,
  });
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [xaiDraft, setXaiDraft] = useState("");
  const [openaiDraft, setOpenaiDraft] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, ks, h] = await Promise.all([
      window.deepFocus?.settings?.get?.(),
      window.deepFocus?.settings?.getApiKeyState?.(),
      checkHealth(),
    ]);
    if (s) setSettings(s);
    if (ks) setKeyState(ks);
    setHealth(h);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const patch = async (partial: Partial<Settings>) => {
    const next = await window.deepFocus?.settings?.set?.(partial);
    if (next) setSettings(next);
  };

  const saveKey = async (provider: "xai" | "openai") => {
    const value = provider === "xai" ? xaiDraft : openaiDraft;
    if (!value) return;
    const ok = await window.deepFocus?.settings?.saveApiKey?.(provider, value);
    if (ok) {
      setSaved(`${provider} key saved — restart the backend to pick it up`);
      if (provider === "xai") setXaiDraft("");
      else setOpenaiDraft("");
      void reload();
    } else {
      setSaved(`Could not save ${provider} key (safeStorage unavailable)`);
    }
    setTimeout(() => setSaved(null), 4000);
  };

  if (!settings) {
    return (
      <div className="flex h-screen items-center justify-center text-[13px] text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-y-auto bg-slate-950 px-8 py-8 text-slate-200">
      <h1 className="font-mono text-[12px] uppercase tracking-[0.25em] text-emerald-400">
        Glance · Settings
      </h1>

      <Section title="Hotkeys" hint="Click a field and press the new combination.">
        {HOTKEYS.map((hk) => (
          <HotkeyRow
            key={hk.name}
            label={hk.label}
            description={hk.description}
            value={settings.hotkeys[hk.name]}
            onChange={(next) =>
              patch({ hotkeys: { ...settings.hotkeys, [hk.name]: next } })
            }
          />
        ))}
      </Section>

      <Section
        title="API keys"
        hint="Stored encrypted via Electron safeStorage — keys never leave your machine."
      >
        <KeyRow
          label="xAI Grok"
          state={keyState.xai}
          value={xaiDraft}
          onChange={setXaiDraft}
          onSave={() => saveKey("xai")}
        />
        <KeyRow
          label="OpenAI"
          state={keyState.openai}
          value={openaiDraft}
          onChange={setOpenaiDraft}
          onSave={() => saveKey("openai")}
        />
        <p className="mt-2 text-[11px] text-slate-500">
          Storing a key here doesn't hot-reload the backend — it writes to Electron
          userData only. The backend reads from <code>services/backend/.env</code>
          on startup. Use this field as a convenience for packaged builds where
          there's no <code>.env</code>.
        </p>
      </Section>

      <Section title="Backend">
        <TextRow
          label="URL"
          value={settings.backendUrl}
          onChange={(v) => patch({ backendUrl: v })}
        />
        <HealthReadout health={health} />
      </Section>

      <Section title="General">
        <ToggleRow
          label="Launch on startup"
          description="Register Glance as a login item."
          value={settings.launchOnStartup}
          onChange={(v) => patch({ launchOnStartup: v })}
        />
        <ToggleRow
          label="Focus monitoring (phase 5)"
          description="Webcam-based distraction alerts. Off by default."
          value={settings.focusModeEnabled}
          onChange={(v) => patch({ focusModeEnabled: v })}
        />
      </Section>

      <Section title="Danger zone">
        <button
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] text-red-300 transition hover:bg-red-500/20"
          onClick={async () => {
            if (!confirm("Delete all session history? This cannot be undone.")) return;
            await clearAllSessions();
            setSaved("All sessions cleared.");
            setTimeout(() => setSaved(null), 3000);
          }}
        >
          Clear all session history
        </button>
      </Section>

      {saved ? (
        <div className="fixed bottom-4 right-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] text-emerald-200">
          {saved}
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-xl border border-slate-800/70 bg-slate-900/40 p-4">
      <div className="mb-1 text-[14px] font-semibold text-slate-100">{title}</div>
      {hint ? <div className="mb-3 text-[11px] text-slate-500">{hint}</div> : null}
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function HotkeyRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("CommandOrControl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      const key = e.key.length === 1 ? e.key.toUpperCase() : capitalize(e.key);
      if (["Shift", "Meta", "Control", "Alt", "Dead"].includes(key)) return;
      parts.push(key);
      const accel = parts.join("+");
      setDraft(accel);
      setRecording(false);
      onChange(accel);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChange, recording]);

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-slate-950/40 px-3 py-2">
      <div>
        <div className="text-[13px] text-slate-200">{label}</div>
        <div className="text-[11px] text-slate-500">{description}</div>
      </div>
      <div
        ref={inputRef}
        tabIndex={0}
        onClick={() => setRecording(true)}
        className={`cursor-pointer select-none rounded-md border px-2.5 py-1 font-mono text-[11px] ${
          recording
            ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-200"
            : "border-slate-700 bg-slate-900 text-slate-200"
        }`}
      >
        {recording ? "Press keys…" : draft}
      </div>
    </div>
  );
}

function KeyRow({
  label,
  state,
  value,
  onChange,
  onSave,
}: {
  label: string;
  state: boolean;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-800/70 bg-slate-950/40 px-3 py-2">
      <div className="w-24 text-[13px] text-slate-300">{label}</div>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={state ? "•••• stored ••••" : "paste key"}
        className="flex-1 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1 font-mono text-[12px] outline-none placeholder:text-slate-500 focus:border-emerald-500/50"
      />
      <button
        disabled={!value}
        onClick={onSave}
        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 transition enabled:hover:bg-emerald-500/20 disabled:opacity-40"
      >
        Save
      </button>
    </div>
  );
}

function TextRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-800/70 bg-slate-950/40 px-3 py-2">
      <div className="w-24 text-[13px] text-slate-300">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="flex-1 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1 font-mono text-[12px] outline-none focus:border-emerald-500/50"
      />
    </div>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-slate-950/40 px-3 py-2">
      <div>
        <div className="text-[13px] text-slate-200">{label}</div>
        <div className="text-[11px] text-slate-500">{description}</div>
      </div>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="h-4 w-4 accent-emerald-500"
      />
    </label>
  );
}

function HealthReadout({ health }: { health: HealthResponse | null }) {
  if (!health) {
    return (
      <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
        Backend is not reachable.
      </div>
    );
  }
  return (
    <div className="mt-2 grid gap-1 rounded-md border border-slate-800/70 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-400">
      <Row
        label="Text"
        value={health.active_provider ? `${health.active_provider} · ${health.active_model}` : "—"}
        err={health.active_error}
      />
      <Row
        label="Vision"
        value={
          health.vision_active_provider
            ? `${health.vision_active_provider} · ${health.vision_active_model}`
            : "—"
        }
      />
      <Row
        label="Image"
        value={health.image_active_provider ?? "—"}
      />
    </div>
  );
}

function Row({
  label,
  value,
  err,
}: {
  label: string;
  value: string;
  err?: string | null;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono uppercase tracking-wider text-slate-500">{label}</span>
      <span className={err ? "text-amber-300" : "text-slate-300"}>
        {err ?? value}
      </span>
    </div>
  );
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
