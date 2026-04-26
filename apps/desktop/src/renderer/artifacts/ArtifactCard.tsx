import { useEffect, useMemo, useRef, useState } from "react";
import { BlockMath, InlineMath } from "react-katex";
import "katex/dist/katex.min.css";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  securityLevel: "loose",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
});

import type {
  AnswerArtifact,
  Artifact,
  CritiqueUiArtifact,
  DiagnoseErrorArtifact,
  DiagramMermaidArtifact,
  DraftReplyArtifact,
  EmailComposeArtifact,
  ExplainChartArtifact,
  ExplainCodeArtifact,
  FixCodeArtifact,
  FlightTrackArtifact,
  FoodOrderArtifact,
  GenerateImageArtifact,
  GenericArtifact,
  GroceryListArtifact,
  IdentifyArtifact,
  JobApplyArtifact,
  MapArtifact,
  MediaLookupArtifact,
  NeedsContextArtifact,
  ProductArtifact,
  RecipeArtifact,
  RestaurantBookingArtifact,
  RewriteArtifact,
  ShoppingArtifact,
  SolveMathArtifact,
  TasksCalendarArtifact,
  TranslateArtifact,
  TravelArtifact,
  WeatherArtifact,
} from "../../shared/artifacts";
import { Markdown } from "../lib/markdown";

/**
 * Single entry point. Dispatches on `artifact.kind`; unknown kinds fall
 * through to the generic card so the UI never shows nothing.
 */
export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  switch (artifact.kind) {
    case "translate":
      return <TranslateCard a={artifact as TranslateArtifact} />;
    case "solve_math":
      return <SolveMathCard a={artifact as SolveMathArtifact} />;
    case "explain_code":
      return <ExplainCodeCard a={artifact as ExplainCodeArtifact} />;
    case "fix_code":
      return <FixCodeCard a={artifact as FixCodeArtifact} />;
    case "diagnose_error":
      return <DiagnoseErrorCard a={artifact as DiagnoseErrorArtifact} />;
    case "explain_chart":
      return <ExplainChartCard a={artifact as ExplainChartArtifact} />;
    case "critique_ui":
      return <CritiqueUiCard a={artifact as CritiqueUiArtifact} />;
    case "identify":
      return <IdentifyCard a={artifact as IdentifyArtifact} />;
    case "rewrite":
      return <RewriteCard a={artifact as RewriteArtifact} />;
    case "tasks_to_calendar":
      return <TasksCalendarCard a={artifact as TasksCalendarArtifact} />;
    case "draft_reply":
      return <DraftReplyCard a={artifact as DraftReplyArtifact} />;
    case "diagram_to_mermaid":
      return <DiagramMermaidCard a={artifact as DiagramMermaidArtifact} />;
    case "recipe":
      return <RecipeCard a={artifact as RecipeArtifact} />;
    case "product":
      return <ProductCard a={artifact as ProductArtifact} />;
    case "media_lookup":
      return <MediaLookupCard a={artifact as MediaLookupArtifact} />;
    case "travel":
      return <TravelCard a={artifact as TravelArtifact} />;
    case "answer":
      return <AnswerCard a={artifact as AnswerArtifact} />;
    case "needs_context":
      return <NeedsContextCard a={artifact as NeedsContextArtifact} />;
    case "map":
      return <MapCard a={artifact as MapArtifact} />;
    case "shopping":
      return <ShoppingCard a={artifact as ShoppingArtifact} />;
    case "food_order":
      return <FoodOrderCard a={artifact as FoodOrderArtifact} />;
    case "weather":
      return <WeatherCard a={artifact as WeatherArtifact} />;
    case "restaurant_booking":
      return <RestaurantBookingCard a={artifact as RestaurantBookingArtifact} />;
    case "flight_track":
      return <FlightTrackCard a={artifact as FlightTrackArtifact} />;
    case "email_compose":
      return <EmailComposeCard a={artifact as EmailComposeArtifact} />;
    case "job_apply":
      return <JobApplyCard a={artifact as JobApplyArtifact} />;
    case "grocery_list":
      return <GroceryListCard a={artifact as GroceryListArtifact} />;
    case "generate_image":
      return <GenerateImageCard a={artifact as GenerateImageArtifact} />;
    default:
      return <GenericCard a={artifact as GenericArtifact} />;
  }
}

function NeedsContextCard({ a }: { a: NeedsContextArtifact }) {
  // This only renders when the auto-fulfill loop in GlanceShell couldn't
  // satisfy the request (e.g. Screen Recording permission denied). In the
  // happy path the shell swallows `needs_context` and re-runs the turn,
  // so the user never sees this card.
  const needsLabel =
    (a.needs ?? []).map((n) => n.replace(/_/g, " ")).join(", ") || "more context";
  return (
    <Card title="Need more context" tone="warn">
      <div className="glass-quiet rounded-2xl px-4 py-3 text-[13px] text-slate-200">
        {a.reason ??
          "Glance needs more context to answer this — typically a screenshot of what you're looking at."}
        <div className="mt-2 text-[11px] text-slate-400">
          Asked for: <span className="font-mono text-slate-300">{needsLabel}</span>
        </div>
        {a.retry_instruction ? (
          <div className="mt-2 text-[11.5px] text-slate-300">
            Your question:{" "}
            <span className="italic text-slate-200">"{a.retry_instruction}"</span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function AnswerCard({ a }: { a: AnswerArtifact }) {
  return (
    <Card title={a.title ? a.title : "Answer"} tone="neutral">
      {a.body ? (
        <div className="glass-quiet rounded-2xl px-4 py-3">
          <Markdown content={a.body} />
        </div>
      ) : null}
      {a.followups?.length ? (
        <div className="mt-1 flex flex-col gap-1.5">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-slate-400">
            You might ask
          </div>
          <div className="flex flex-wrap gap-1.5">
            {a.followups.map((f, i) => (
              <span
                key={i}
                className="rounded-full border border-slate-600/60 bg-slate-900/70 px-2.5 py-[3px] text-[11px] text-slate-200"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

// --- Shared atoms --------------------------------------------------------

function Card({
  title,
  subtitle,
  tone: _tone,
  children,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode | null;
  tone?: "neutral" | "success" | "warn" | "info";
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  // Every artifact gets an opaque acrylic panel so the content stays
  // readable on ANY desktop background (white Chrome tab, Figma canvas,
  // photo wallpaper, etc.). The shell's transparent Electron window would
  // otherwise let the desktop bleed right through the artifact text.
  return (
    <div className="glass flex flex-col gap-3 rounded-[22px] px-4 py-3 text-slate-100">
      {(title || subtitle || actions) && (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {title ? (
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300/70">
                {title}
              </div>
            ) : null}
            {subtitle ? (
              <div className="mt-0.5 text-[13px] leading-snug text-slate-300">
                {subtitle}
              </div>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 gap-1.5">{actions}</div> : null}
        </div>
      )}
      <div className="flex flex-col gap-2 text-[13px] text-slate-100">
        {children}
      </div>
    </div>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      className="rounded-md border border-slate-700/70 bg-slate-900/70 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-200"
    >
      {done ? "Copied" : label}
    </button>
  );
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-md border border-slate-700/70 bg-slate-900/70 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-200"
    >
      {children}
    </a>
  );
}

function Bullets({ items, empty }: { items?: string[]; empty?: string }) {
  if (!items?.length) return empty ? <p className="text-slate-500">{empty}</p> : null;
  return (
    <ul className="ml-4 list-disc space-y-1 text-[13px] text-slate-200 marker:text-emerald-400/60">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "emerald" | "amber" | "sky" }) {
  const map: Record<string, string> = {
    slate: "border-slate-700 text-slate-300",
    emerald: "border-emerald-500/40 text-emerald-200",
    amber: "border-amber-500/40 text-amber-200",
    sky: "border-sky-500/40 text-sky-200",
  };
  return (
    <span className={`rounded-full border ${map[tone]} bg-slate-900/60 px-2 py-[2px] text-[10px] font-mono uppercase tracking-wider`}>
      {children}
    </span>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-[12px] leading-relaxed text-slate-100">
      {lang ? (
        <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-slate-500">
          {lang}
        </div>
      ) : null}
      <code className="whitespace-pre">{code}</code>
    </pre>
  );
}

function googleMapsUrl(q: string): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(q)}`;
}
function googleSearchUrl(q: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// --- Understand ----------------------------------------------------------

function TranslateCard({ a }: { a: TranslateArtifact }) {
  return (
    <Card
      title={`Translate${a.detected_lang ? ` · ${a.detected_lang} → ${a.target_lang ?? "en"}` : ""}`}
      subtitle={a.translation ? null : "(no translation returned)"}
      tone="info"
      actions={a.translation ? <CopyButton text={a.translation} /> : undefined}
    >
      {a.original ? (
        <blockquote className="border-l-2 border-slate-700 pl-3 text-[12.5px] italic text-slate-400">
          {a.original}
        </blockquote>
      ) : null}
      {a.translation ? (
        <div className="text-[14px] leading-relaxed text-slate-100">
          {a.translation}
        </div>
      ) : null}
      {a.notes?.length ? <Bullets items={a.notes} /> : null}
    </Card>
  );
}

// Heuristic: does this string look like it contains LaTeX worth rendering?
// We catch both fenced ($...$, $$...$$, \(...\), \[...\]) and bare TeX
// commands (\frac, \sqrt, ^{...}, _{...}) since the model emits both.
const TEX_TOKEN_RE = /\\(?:frac|sqrt|sum|int|lim|prod|cdot|times|pm|leq|geq|neq|approx|infty|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega)\b|\^\{|_\{|\$\$?|\\\(|\\\[/;
function looksLikeTex(s: string): boolean {
  return TEX_TOKEN_RE.test(s);
}

// Strip the outer "y' = " etc. that some prompts pre-render and isolate the
// expression so KaTeX gets a clean bare-TeX input. We also strip a leading
// "= " since SolveMathCard already prefixes one in the answer pill.
function stripLeadingEquals(s: string): string {
  return s.replace(/^\s*=\s*/, "").trim();
}

function MathInline({ children }: { children: string }) {
  if (!children) return null;
  if (!looksLikeTex(children)) return <>{children}</>;
  // Render the whole thing as a single inline math node. If it parses, KaTeX
  // shows the formatted formula; if not, fall back to the raw string so the
  // user at least sees the LaTeX source instead of a stack trace.
  try {
    return <InlineMath math={children} />;
  } catch {
    return <span className="font-mono">{children}</span>;
  }
}

// For step text that mixes prose and TeX ("dy/du = 1/(2\sqrt{u}) by chain
// rule.") — split on $...$ and \(...\) inline delimiters; otherwise render
// the whole string as a single inline-math node if it has TeX tokens, else
// plain text. This keeps both pure-LaTeX steps and mixed prose readable.
function MathText({ children }: { children: string }) {
  if (!children) return null;
  const parts: Array<{ kind: "text" | "math"; value: string }> = [];
  const re = /\$\$([^$]+)\$\$|\$([^$]+)\$|\\\(([^)]+)\\\)|\\\[([^\]]+)\\\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(children))) {
    if (m.index > last) parts.push({ kind: "text", value: children.slice(last, m.index) });
    parts.push({ kind: "math", value: (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim() });
    last = re.lastIndex;
  }
  if (parts.length === 0) {
    // No fenced math — if the whole string smells like TeX, render it as math.
    return looksLikeTex(children) ? <MathInline>{children}</MathInline> : <>{children}</>;
  }
  if (last < children.length) parts.push({ kind: "text", value: children.slice(last) });
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "math" ? <MathInline key={i}>{p.value}</MathInline> : <span key={i}>{p.value}</span>,
      )}
    </>
  );
}

function SolveMathCard({ a }: { a: SolveMathArtifact }) {
  const answer = a.answer ? stripLeadingEquals(a.answer) : "";
  return (
    <Card title="Solve" subtitle={a.problem ? <MathText>{a.problem}</MathText> : undefined} tone="info">
      {answer ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[14px] text-emerald-100 overflow-x-auto">
          {looksLikeTex(answer) ? (
            <BlockMath math={answer} />
          ) : (
            <span className="font-mono">= {answer}</span>
          )}
        </div>
      ) : null}
      {a.steps?.length ? (
        <ol className="ml-5 list-decimal space-y-1.5 text-[13px] leading-relaxed text-slate-200 marker:text-emerald-400/60">
          {a.steps.map((s, i) => (
            <li key={i}>
              <MathText>{s}</MathText>
            </li>
          ))}
        </ol>
      ) : null}
      {a.notes?.length ? <Bullets items={a.notes} /> : null}
    </Card>
  );
}

function ExplainCodeCard({ a }: { a: ExplainCodeArtifact }) {
  return (
    <Card
      title={`Explain code${a.language ? ` · ${a.language}` : ""}`}
      subtitle={a.summary}
      tone="info"
      actions={a.complexity ? <Pill>{a.complexity}</Pill> : undefined}
    >
      {a.walkthrough?.length ? (
        <div>
          <div className="mb-1 text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Walkthrough
          </div>
          <Bullets items={a.walkthrough} />
        </div>
      ) : null}
      {a.risks?.length ? (
        <div>
          <div className="mb-1 text-[11px] font-mono uppercase tracking-wider text-amber-400/70">
            Risks
          </div>
          <Bullets items={a.risks} />
        </div>
      ) : null}
    </Card>
  );
}

function FixCodeCard({ a }: { a: FixCodeArtifact }) {
  return (
    <Card
      title={`Fix code${a.language ? ` · ${a.language}` : ""}`}
      subtitle={a.diagnosis}
      tone="warn"
      actions={a.fixed ? <CopyButton text={a.fixed} label="Copy fix" /> : undefined}
    >
      {a.fixed ? <CodeBlock code={a.fixed} lang={a.language} /> : null}
      {a.changes?.length ? (
        <div>
          <div className="mb-1 text-[11px] font-mono uppercase tracking-wider text-emerald-400/70">
            Changes
          </div>
          <Bullets items={a.changes} />
        </div>
      ) : null}
    </Card>
  );
}

function DiagnoseErrorCard({ a }: { a: DiagnoseErrorArtifact }) {
  return (
    <Card title="Diagnose" subtitle={a.likely_cause} tone="warn">
      {a.error ? (
        <pre className="whitespace-pre-wrap rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-200">
          {a.error}
        </pre>
      ) : null}
      {a.fix_steps?.length ? (
        <div>
          <div className="mb-1 text-[11px] font-mono uppercase tracking-wider text-emerald-400/70">
            Fix steps
          </div>
          <Bullets items={a.fix_steps} />
        </div>
      ) : null}
      {a.snippets?.length ? (
        <div className="flex flex-col gap-2">
          {a.snippets.map((s, i) => (
            <div key={i}>
              {s.label ? (
                <div className="mb-1 text-[11px] font-mono uppercase tracking-wider text-slate-500">
                  {s.label}
                </div>
              ) : null}
              {s.code ? <CodeBlock code={s.code} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function ExplainChartCard({ a }: { a: ExplainChartArtifact }) {
  return (
    <Card title="Chart" subtitle={a.headline} tone="info">
      <Bullets items={a.key_points} />
      {a.caveats?.length ? (
        <div>
          <div className="mb-1 text-[11px] font-mono uppercase tracking-wider text-amber-400/70">
            Caveats
          </div>
          <Bullets items={a.caveats} />
        </div>
      ) : null}
    </Card>
  );
}

function CritiqueUiCard({ a }: { a: CritiqueUiArtifact }) {
  return (
    <Card title="UI critique" tone="info">
      <div className="grid gap-2 md:grid-cols-3">
        <MiniSection title="Strengths" items={a.strengths} tone="emerald" />
        <MiniSection title="Issues" items={a.issues} tone="amber" />
        <MiniSection title="Suggestions" items={a.suggestions} tone="sky" />
      </div>
    </Card>
  );
}

function MiniSection({
  title,
  items,
  tone,
}: {
  title: string;
  items?: string[];
  tone: "emerald" | "amber" | "sky";
}) {
  const border = {
    emerald: "border-emerald-500/30",
    amber: "border-amber-500/30",
    sky: "border-sky-500/30",
  }[tone];
  return (
    <div className={`rounded-lg border ${border} bg-slate-950/40 p-2`}>
      <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
        {title}
      </div>
      <Bullets items={items} empty="—" />
    </div>
  );
}

function IdentifyCard({ a }: { a: IdentifyArtifact }) {
  const query = a.name || "";
  return (
    <Card
      title={`Identify${a.category ? ` · ${a.category}` : ""}`}
      subtitle={a.name}
      tone="info"
      actions={a.confidence ? <Pill tone={a.confidence === "high" ? "emerald" : a.confidence === "low" ? "amber" : "slate"}>{a.confidence}</Pill> : undefined}
    >
      <Bullets items={a.facts} />
      <div className="flex flex-wrap gap-1.5">
        {query ? <LinkButton href={googleSearchUrl(query)}>Google</LinkButton> : null}
        {a.links?.map((l, i) => (
          <LinkButton key={i} href={googleSearchUrl(l.query)}>
            {l.label}
          </LinkButton>
        ))}
      </div>
    </Card>
  );
}

// --- Act -----------------------------------------------------------------

function RewriteCard({ a }: { a: RewriteArtifact }) {
  const text = a.text?.trim() ?? "";
  return (
    <Card
      title="Rewrite"
      tone="info"
      actions={
        <div className="flex items-center gap-2">
          {a.tone ? <Pill tone="emerald">{a.tone}</Pill> : null}
          {text ? <CopyButton text={text} /> : null}
        </div>
      }
    >
      {text ? (
        <div className="text-[13px] leading-relaxed text-slate-100 whitespace-pre-wrap">
          {text}
        </div>
      ) : (
        <div className="text-[12px] text-slate-400">No rewrite returned.</div>
      )}
    </Card>
  );
}

function TasksCalendarCard({ a }: { a: TasksCalendarArtifact }) {
  const ics = useMemo(() => buildIcs(a.events ?? []), [a.events]);
  return (
    <Card
      title="Tasks → Calendar"
      subtitle={`${a.events?.length ?? 0} event${(a.events?.length ?? 0) === 1 ? "" : "s"}`}
      tone="success"
      actions={
        ics ? (
          <a
            href={`data:text/calendar;charset=utf8,${encodeURIComponent(ics)}`}
            download="glance.ics"
            className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-emerald-200 transition hover:bg-emerald-500/20"
          >
            .ics
          </a>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-1.5">
        {a.events?.map((e, i) => (
          <div
            key={i}
            className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium text-slate-100">
                {e.title}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-slate-400">
                {e.when ? <span>🕐 {e.when}</span> : null}
                {e.duration_min ? <span>⏱ {e.duration_min} min</span> : null}
              </div>
              {e.notes ? (
                <div className="mt-1 text-[11.5px] text-slate-500">{e.notes}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function buildIcs(events: TasksCalendarArtifact["events"]): string | null {
  if (!events?.length) return null;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Glance//EN",
  ];
  for (const e of events) {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@glance`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `SUMMARY:${escapeIcs(e.title)}`,
      e.when ? `DESCRIPTION:${escapeIcs(`When: ${e.when}`)}` : "",
      e.notes ? `DESCRIPTION:${escapeIcs(e.notes)}` : "",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.filter(Boolean).join("\r\n");
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function DraftReplyCard({ a }: { a: DraftReplyArtifact }) {
  return (
    <Card
      title="Draft reply"
      subtitle={a.tone ? `tone · ${a.tone}` : null}
      tone="success"
      actions={a.body ? <CopyButton text={a.body} label="Copy reply" /> : undefined}
    >
      {a.subject ? (
        <div className="text-[12px] text-slate-400">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
            Subject
          </span>{" "}
          {a.subject}
        </div>
      ) : null}
      {a.body ? (
        <div className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-[13px] leading-relaxed text-slate-100">
          {a.body}
        </div>
      ) : null}
    </Card>
  );
}

function MermaidDiagram({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    let cancelled = false;
    const el = ref.current;
    if (!el || !source.trim()) return;
    setError(null);
    el.innerHTML = "";
    mermaid
      .render(idRef.current, source)
      .then(({ svg }) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        const svgEl = ref.current.querySelector("svg");
        if (svgEl) {
          svgEl.setAttribute("width", "100%");
          svgEl.removeAttribute("height");
          svgEl.style.maxWidth = "100%";
          svgEl.style.height = "auto";
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[12px] text-rose-200">
        Could not render diagram: {error}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className="overflow-auto rounded-lg border border-emerald-500/20 bg-slate-950/40 p-3"
    />
  );
}

function DiagramMermaidCard({ a }: { a: DiagramMermaidArtifact }) {
  const [showSource, setShowSource] = useState(false);
  return (
    <Card
      title="Diagram → Mermaid"
      tone="info"
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSource((s) => !s)}
            className="rounded-full border border-emerald-500/30 px-2 py-[2px] text-[10px] font-mono uppercase tracking-wider text-emerald-200 hover:bg-emerald-500/15"
          >
            {showSource ? "Diagram" : "Source"}
          </button>
          {a.mermaid ? <CopyButton text={a.mermaid} /> : null}
        </div>
      }
    >
      {a.mermaid ? (
        showSource ? (
          <CodeBlock code={a.mermaid} lang="mermaid" />
        ) : (
          <MermaidDiagram source={a.mermaid} />
        )
      ) : null}
      {a.notes?.length ? <Bullets items={a.notes} /> : null}
    </Card>
  );
}

// --- Create --------------------------------------------------------------

function GenerateImageCard({ a }: { a: GenerateImageArtifact }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const hasImage = !!a.data_url;
  const hasError = !!a.error;
  return (
    <Card
      title={`Image${a.image_model ? ` · ${a.image_model}` : ""}`}
      subtitle={a.title ?? null}
      tone="info"
      actions={
        <div className="flex items-center gap-2">
          {a.prompt ? (
            <button
              type="button"
              onClick={() => setShowPrompt((s) => !s)}
              className="rounded-full border border-emerald-500/30 px-2 py-[2px] text-[10px] font-mono uppercase tracking-wider text-emerald-200 hover:bg-emerald-500/15"
            >
              {showPrompt ? "Image" : "Prompt"}
            </button>
          ) : null}
          {a.data_url ? <CopyButton text={a.data_url} label="Copy URL" /> : null}
        </div>
      }
    >
      {hasError ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[12px] text-rose-200">
          {a.error}
        </div>
      ) : !hasImage ? (
        <div className="flex items-center justify-center rounded-lg border border-emerald-500/20 bg-slate-950/40 p-8 text-[12px] text-slate-400">
          {a.prompt ? "Image generation requires an image provider key (OpenAI or xAI)." : "No image returned."}
        </div>
      ) : showPrompt ? (
        <div className="rounded-lg bg-slate-950/60 p-3 text-[12px] leading-relaxed text-slate-300 whitespace-pre-wrap">
          {a.prompt}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-emerald-500/20">
          <img
            src={a.data_url!}
            alt={a.title ?? "Generated image"}
            className="w-full object-contain"
            style={{ maxHeight: "480px" }}
          />
        </div>
      )}
    </Card>
  );
}

// --- Discover ------------------------------------------------------------

function RecipeCard({ a }: { a: RecipeArtifact }) {
  return (
    <Card
      title={`Recipe${a.cuisine ? ` · ${a.cuisine}` : ""}`}
      subtitle={a.dish}
      tone="success"
      actions={
        a.where_to_buy_query ? (
          <LinkButton href={googleMapsUrl(a.where_to_buy_query)}>Nearby</LinkButton>
        ) : undefined
      }
    >
      {a.time_min ? <Pill tone="emerald">⏱ {a.time_min} min</Pill> : null}
      {a.ingredients?.length ? (
        <div>
          <div className="mb-1 text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Ingredients
          </div>
          <Bullets items={a.ingredients} />
        </div>
      ) : null}
      {a.steps?.length ? (
        <div>
          <div className="mb-1 text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Steps
          </div>
          <ol className="ml-5 list-decimal space-y-1 text-[13px] text-slate-200 marker:text-emerald-400/60">
            {a.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}

function ProductCard({ a }: { a: ProductArtifact }) {
  return (
    <Card
      title="Product"
      subtitle={a.name}
      tone="success"
      actions={a.price_range ? <Pill tone="emerald">{a.price_range}</Pill> : undefined}
    >
      {a.summary ? <p className="text-[13px] text-slate-200">{a.summary}</p> : null}
      {a.review_bullets?.length ? (
        <div>
          <div className="mb-1 text-[11px] font-mono uppercase tracking-wider text-slate-400">
            What reviewers say
          </div>
          <Bullets items={a.review_bullets} />
        </div>
      ) : null}
      {a.search_queries?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {a.search_queries.map((q, i) => (
            <LinkButton key={i} href={googleSearchUrl(q.query)}>
              {q.label}
            </LinkButton>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function MediaLookupCard({ a }: { a: MediaLookupArtifact }) {
  return (
    <Card
      title={`Media${a.type ? ` · ${a.type}` : ""}`}
      subtitle={a.title}
      tone="success"
    >
      {a.summary ? <p className="text-[13px] text-slate-200">{a.summary}</p> : null}
      {a.cast_or_authors?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {a.cast_or_authors.map((n, i) => (
            <Pill key={i}>{n}</Pill>
          ))}
        </div>
      ) : null}
      {a.where_to_find?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {a.where_to_find.map((w, i) => (
            <LinkButton key={i} href={googleSearchUrl(w.query)}>
              {w.label}
            </LinkButton>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function TravelCard({ a }: { a: TravelArtifact }) {
  return (
    <Card
      title="Landmark"
      subtitle={a.name}
      tone="success"
      actions={
        a.map_query ? <LinkButton href={googleMapsUrl(a.map_query)}>Open map</LinkButton> : undefined
      }
    >
      {a.history ? <p className="text-[13px] leading-relaxed text-slate-200">{a.history}</p> : null}
    </Card>
  );
}

// --- Map -----------------------------------------------------------------

function MapCard({ a }: { a: MapArtifact }) {
  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(a.map_query ?? a.title ?? "")}`;
  const directionsUrl = a.directions_from
    ? `https://www.google.com/maps/dir/${encodeURIComponent(a.directions_from)}/${encodeURIComponent(a.address ?? a.title ?? "")}`
    : `https://www.google.com/maps/dir//${encodeURIComponent(a.address ?? a.title ?? "")}`;
  const appleMapsUrl = `https://maps.apple.com/?q=${encodeURIComponent(a.map_query ?? a.title ?? "")}`;

  return (
    <Card title={`Map${a.place_type ? ` · ${a.place_type}` : ""}`} subtitle={a.title} tone="info">
      {/* Decorative map-grid placeholder */}
      <div
        className="relative overflow-hidden rounded-xl border border-slate-700/40"
        style={{
          height: 100,
          background: "#0c1a2e",
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.07) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      >
        {/* Simulated roads */}
        <div className="absolute inset-0 flex items-center">
          <div className="h-[2px] w-full bg-slate-600/30" />
        </div>
        <div className="absolute inset-0 flex items-center" style={{ transform: "rotate(-25deg) scaleX(1.5)" }}>
          <div className="h-[1.5px] w-full bg-slate-700/30" />
        </div>
        <div className="absolute inset-0 flex justify-center">
          <div className="h-full w-[2px] bg-slate-600/30" />
        </div>
        {/* Location pin */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-0">
            <div className="h-4 w-4 rounded-full border-2 border-white/80 bg-emerald-500 shadow-[0_0_14px_4px_rgba(16,185,129,0.45)]" />
            <div className="h-2 w-[2px] bg-emerald-500/70" />
          </div>
        </div>
        {/* Corner label */}
        {a.title && (
          <div className="absolute bottom-1.5 left-2.5 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-200 backdrop-blur-sm">
            {a.title}
          </div>
        )}
      </div>

      {a.address ? (
        <div className="flex items-start gap-2 text-[13px]">
          <span className="mt-px shrink-0 text-emerald-400">📍</span>
          <span className="text-slate-200">{a.address}</span>
        </div>
      ) : null}
      {a.description ? (
        <p className="text-[12.5px] leading-relaxed text-slate-400">{a.description}</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-200 transition hover:bg-emerald-500/20"
        >
          Google Maps
        </a>
        <a
          href={directionsUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-slate-700/70 bg-slate-900/70 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-200"
        >
          Directions
        </a>
        <a
          href={appleMapsUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-slate-700/70 bg-slate-900/70 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-200"
        >
          Apple Maps
        </a>
        {a.links?.map((l, i) => (
          <LinkButton key={i} href={googleSearchUrl(l.query)}>
            {l.label}
          </LinkButton>
        ))}
      </div>
    </Card>
  );
}

// --- Shopping ------------------------------------------------------------

const RETAILER_META: Record<string, { icon: string; color: string }> = {
  amazon:   { icon: "📦", color: "border-orange-500/40 text-orange-200 bg-orange-500/10" },
  walmart:  { icon: "🛒", color: "border-blue-500/40 text-blue-200 bg-blue-500/10" },
  "best buy": { icon: "💡", color: "border-yellow-500/40 text-yellow-200 bg-yellow-500/10" },
  target:   { icon: "🎯", color: "border-red-500/40 text-red-200 bg-red-500/10" },
};

function retailerMeta(name: string) {
  return RETAILER_META[name.toLowerCase()] ?? { icon: "🛍️", color: "border-slate-600 text-slate-300 bg-slate-800/50" };
}

function ShoppingCard({ a }: { a: ShoppingArtifact }) {
  return (
    <Card
      title="Shop"
      subtitle={a.product_name}
      tone="success"
      actions={a.price_range ? <Pill tone="emerald">{a.price_range}</Pill> : undefined}
    >
      {a.description ? <p className="text-[12.5px] text-slate-300">{a.description}</p> : null}

      {a.items?.length ? (
        <div className="flex flex-col gap-1.5">
          {a.items.map((item, i) => {
            const meta = retailerMeta(item.retailer);
            return (
              <div
                key={i}
                className="flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
              >
                <span className="text-base">{meta.icon}</span>
                <span className="flex-1 text-[13px] font-medium text-slate-200">{item.retailer}</span>
                {item.price ? (
                  <span className="font-mono text-[13px] font-semibold text-emerald-300">{item.price}</span>
                ) : null}
                {item.url ? (
                  <>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className={`rounded border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider transition hover:opacity-80 ${meta.color}`}
                    >
                      View
                    </a>
                    {item.add_to_cart ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-emerald-500/50 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-emerald-200 transition hover:bg-emerald-500/25"
                      >
                        Cart →
                      </a>
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {a.image_search ? (
        <div className="flex flex-wrap gap-1.5">
          <LinkButton href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(a.image_search)}`}>
            Images
          </LinkButton>
          <LinkButton href={googleSearchUrl(a.image_search + " reviews")}>Reviews</LinkButton>
        </div>
      ) : null}
    </Card>
  );
}

// --- Food & Order --------------------------------------------------------

function FoodOrderCard({ a }: { a: FoodOrderArtifact }) {
  const [tab, setTab] = useState<"order" | "recipe">("order");

  const PLATFORM_ICON: Record<string, string> = {
    doordash: "🚗",
    "uber eats": "🚙",
    grubhub: "🍔",
    instacart: "🛒",
  };

  return (
    <Card title={`Food${a.cuisine ? ` · ${a.cuisine}` : ""}`} subtitle={a.dish} tone="success">
      {/* Tab switcher */}
      <div className="flex gap-1 rounded-xl border border-slate-700/50 bg-slate-900/50 p-1">
        {(["order", "recipe"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-1.5 text-[11px] font-mono uppercase tracking-wider transition ${
              tab === t
                ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t === "order" ? "🚗 Order" : "👨‍🍳 Recipe"}
          </button>
        ))}
      </div>

      {tab === "order" ? (
        <div className="flex flex-col gap-2">
          {a.order_options?.length ? (
            <div className="flex flex-col gap-1.5">
              {a.order_options.map((opt, i) => {
                const icon = PLATFORM_ICON[opt.platform.toLowerCase()] ?? "🍽️";
                return (
                  <a
                    key={i}
                    href={opt.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-lg border border-slate-700/60 bg-slate-900/50 px-3 py-2.5 transition hover:border-emerald-500/40 hover:bg-emerald-500/5"
                  >
                    <span className="text-xl">{icon}</span>
                    <div className="flex-1">
                      <div className="text-[13.5px] font-semibold text-slate-100">{opt.platform}</div>
                      {opt.search_query ? (
                        <div className="text-[11px] text-slate-500">"{opt.search_query}"</div>
                      ) : null}
                    </div>
                    <span className="text-[11px] text-emerald-400">Order →</span>
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="text-[12.5px] text-slate-500">No delivery options found.</p>
          )}
          {a.nearby_query ? (
            <a
              href={googleMapsUrl(a.nearby_query)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-slate-700/40 bg-slate-900/40 px-3 py-2 text-[12px] text-slate-300 transition hover:border-emerald-500/30 hover:text-emerald-200"
            >
              <span>📍</span>
              <span>Find nearby restaurants</span>
            </a>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {a.recipe?.time_min ? (
            <Pill tone="emerald">⏱ {a.recipe.time_min} min</Pill>
          ) : null}
          {a.recipe?.ingredients?.length ? (
            <div>
              <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-slate-500">Ingredients</div>
              <Bullets items={a.recipe.ingredients} />
            </div>
          ) : null}
          {a.recipe?.steps?.length ? (
            <div>
              <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-slate-500">Steps</div>
              <ol className="ml-5 list-decimal space-y-1 text-[13px] text-slate-200 marker:text-emerald-400/60">
                {a.recipe.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

// --- Weather -------------------------------------------------------------

const WEATHER_ICON_MAP: [string, string][] = [
  ["sunny", "☀️"],
  ["clear", "☀️"],
  ["partly cloudy", "⛅"],
  ["mostly cloudy", "🌥️"],
  ["overcast", "☁️"],
  ["cloudy", "☁️"],
  ["drizzle", "🌦️"],
  ["thunderstorm", "⛈️"],
  ["stormy", "⛈️"],
  ["rainy", "🌧️"],
  ["rain", "🌧️"],
  ["snowy", "❄️"],
  ["snow", "❄️"],
  ["foggy", "🌫️"],
  ["fog", "🌫️"],
  ["windy", "💨"],
  ["hazy", "🌫️"],
];

function weatherIcon(condition?: string): string {
  if (!condition) return "🌡️";
  const lc = condition.toLowerCase();
  for (const [key, icon] of WEATHER_ICON_MAP) {
    if (lc.includes(key)) return icon;
  }
  return "🌡️";
}

function WeatherCard({ a }: { a: WeatherArtifact }) {
  const icon = weatherIcon(a.condition);
  const weatherUrl = a.weather_query
    ? `https://www.google.com/search?q=${encodeURIComponent(a.weather_query)}`
    : `https://weather.com/weather/today`;

  return (
    <Card title={`Weather${a.location ? ` · ${a.location}` : ""}`} tone="info">
      {/* Current conditions hero */}
      <div className="flex items-center gap-4 rounded-xl border border-slate-700/40 bg-slate-900/50 px-4 py-3">
        <span className="text-5xl leading-none">{icon}</span>
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[36px] font-light leading-none text-slate-100">
              {a.temperature_f ?? "—"}°
            </span>
            <span className="text-[13px] text-slate-400">F</span>
            {a.temperature_c != null ? (
              <span className="text-[13px] text-slate-500">/ {a.temperature_c}°C</span>
            ) : null}
          </div>
          <div className="mt-0.5 text-[13px] text-slate-300">{a.condition ?? "Unknown"}</div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-1.5">
        {a.feels_like_f != null ? (
          <div className="flex flex-col items-center rounded-lg border border-slate-800 bg-slate-950/40 py-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Feels like</span>
            <span className="mt-0.5 text-[13px] font-medium text-slate-200">{a.feels_like_f}°F</span>
          </div>
        ) : null}
        {a.humidity != null ? (
          <div className="flex flex-col items-center rounded-lg border border-slate-800 bg-slate-950/40 py-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Humidity</span>
            <span className="mt-0.5 text-[13px] font-medium text-slate-200">{a.humidity}%</span>
          </div>
        ) : null}
        {a.wind_mph != null ? (
          <div className="flex flex-col items-center rounded-lg border border-slate-800 bg-slate-950/40 py-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Wind</span>
            <span className="mt-0.5 text-[13px] font-medium text-slate-200">
              {a.wind_mph} mph {a.wind_direction ?? ""}
            </span>
          </div>
        ) : null}
      </div>

      {/* 5-day forecast */}
      {a.forecast?.length ? (
        <div>
          <div className="mb-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">Forecast</div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {a.forecast.map((day, i) => (
              <div
                key={i}
                className="flex min-w-[56px] flex-col items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-950/40 px-2 py-2"
              >
                <span className="text-[10px] font-mono text-slate-400">{day.day}</span>
                <span className="text-lg leading-none">{weatherIcon(day.condition)}</span>
                <span className="text-[11px] font-medium text-slate-200">{day.high_f ?? "—"}°</span>
                <span className="text-[10px] text-slate-500">{day.low_f ?? "—"}°</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        <LinkButton href={weatherUrl}>Full forecast</LinkButton>
      </div>
    </Card>
  );
}

// --- Restaurant booking --------------------------------------------------

function StarRating({ rating }: { rating?: number }) {
  if (rating == null) return null;
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span className="flex items-center gap-0.5 text-[12px]">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < full ? "text-amber-400" : half && i === full ? "text-amber-400/60" : "text-slate-700"}>
          ★
        </span>
      ))}
      <span className="ml-1 font-mono text-[11px] text-slate-400">{rating.toFixed(1)}</span>
    </span>
  );
}

function RestaurantBookingCard({ a }: { a: RestaurantBookingArtifact }) {
  const openTableUrl = a.opentable_url
    ?? `https://www.opentable.com/s/?term=${encodeURIComponent(a.opentable_query ?? a.name ?? "")}`;
  const mapsUrl = googleMapsUrl(a.map_query ?? a.name ?? "");
  const phoneUrl = a.phone ? `tel:${a.phone.replace(/\s/g, "")}` : null;

  return (
    <Card
      title={`Restaurant${a.cuisine ? ` · ${a.cuisine}` : ""}`}
      subtitle={a.name}
      tone="success"
      actions={a.price_level ? <Pill tone="amber">{a.price_level}</Pill> : undefined}
    >
      <div className="flex items-center gap-3">
        <StarRating rating={a.rating} />
      </div>

      {a.description ? (
        <p className="text-[12.5px] leading-relaxed text-slate-300">{a.description}</p>
      ) : null}

      <div className="flex flex-col gap-1 text-[12.5px] text-slate-400">
        {a.address ? (
          <div className="flex items-start gap-1.5">
            <span className="shrink-0">📍</span>
            <span>{a.address}</span>
          </div>
        ) : null}
        {a.hours ? (
          <div className="flex items-start gap-1.5">
            <span className="shrink-0">🕐</span>
            <span>{a.hours}</span>
          </div>
        ) : null}
        {a.phone ? (
          <div className="flex items-start gap-1.5">
            <span className="shrink-0">📞</span>
            <span>{a.phone}</span>
          </div>
        ) : null}
      </div>

      {/* CTAs */}
      <a
        href={openTableUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-2 rounded-xl border border-orange-500/50 bg-orange-500/15 py-2.5 text-[13px] font-semibold text-orange-200 transition hover:bg-orange-500/25"
      >
        🗓️ Book on OpenTable
      </a>

      <div className="flex flex-wrap gap-1.5">
        <LinkButton href={mapsUrl}>Directions</LinkButton>
        {phoneUrl ? <LinkButton href={phoneUrl}>Call</LinkButton> : null}
        <LinkButton href={googleSearchUrl((a.name ?? "") + " reviews")}>Reviews</LinkButton>
      </div>
    </Card>
  );
}

// --- Flight tracker ------------------------------------------------------

function FlightTrackCard({ a }: { a: FlightTrackArtifact }) {
  const trendIcon =
    a.price_trend === "rising" ? "↑" : a.price_trend === "falling" ? "↓" : "→";
  const trendColor =
    a.price_trend === "rising"
      ? "text-red-400"
      : a.price_trend === "falling"
        ? "text-emerald-400"
        : "text-slate-400";

  const googleFlightsUrl = a.google_flights_url ?? "https://www.google.com/travel/flights";
  const kayakUrl = a.kayak_url ?? `https://www.kayak.com/flights`;

  return (
    <Card title="Flight" tone="info">
      {/* Route + price hero */}
      <div className="flex items-center gap-3 rounded-xl border border-slate-700/40 bg-slate-900/50 px-4 py-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-100">
            {a.route ?? `${a.origin ?? "?"} → ${a.destination ?? "?"}`}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-2 text-[12px] text-slate-400">
            {a.airline ? <span>✈️ {a.airline}</span> : null}
            {a.flight_number ? <span className="font-mono">{a.flight_number}</span> : null}
            {a.duration ? <span>⏱ {a.duration}</span> : null}
          </div>
        </div>
        <div className="text-right">
          {a.current_price ? (
            <div className="text-[22px] font-light text-slate-100">{a.current_price}</div>
          ) : null}
          {a.price_trend ? (
            <div className={`flex items-center justify-end gap-1 text-[12px] font-mono font-semibold ${trendColor}`}>
              <span>{trendIcon}</span>
              <span>{a.price_trend}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1 text-[12.5px] text-slate-400">
        {a.departure_date ? (
          <div className="flex items-center gap-1.5">
            <span>📅</span>
            <span>{a.departure_date}</span>
          </div>
        ) : null}
        {a.typical_price_range ? (
          <div className="flex items-center gap-1.5">
            <span>💰</span>
            <span>Typical range: <span className="text-slate-300">{a.typical_price_range}</span></span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <a
          href={googleFlightsUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-sky-200 transition hover:bg-sky-500/20"
        >
          Google Flights
        </a>
        <a
          href={kayakUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-slate-700/70 bg-slate-900/70 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-300 transition hover:border-sky-500/50 hover:text-sky-200"
        >
          Kayak
        </a>
        <a
          href={`https://www.google.com/travel/flights`}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-slate-700/70 bg-slate-900/70 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-300 transition hover:border-amber-500/50 hover:text-amber-200"
        >
          🔔 Track price
        </a>
      </div>
    </Card>
  );
}

// --- Email compose -------------------------------------------------------

function EmailComposeCard({ a }: { a: EmailComposeArtifact }) {
  const body = a.body ?? "";
  const gmailUrl = `https://mail.google.com/mail/?view=cm${
    a.to_email ? `&to=${encodeURIComponent(a.to_email)}` : ""
  }${a.subject ? `&su=${encodeURIComponent(a.subject)}` : ""}${
    body ? `&body=${encodeURIComponent(body)}` : ""
  }`;
  const outlookUrl = `https://outlook.live.com/mail/0/deeplink/compose?${
    a.to_email ? `to=${encodeURIComponent(a.to_email)}&` : ""
  }${a.subject ? `subject=${encodeURIComponent(a.subject)}&` : ""}${
    body ? `body=${encodeURIComponent(body)}` : ""
  }`;

  return (
    <Card
      title={`Email${a.tone ? ` · ${a.tone}` : ""}`}
      tone="neutral"
      actions={body ? <CopyButton text={body} label="Copy" /> : undefined}
    >
      {/* Email header */}
      <div className="rounded-t-lg border border-slate-700/60 bg-slate-950/40 px-3 pt-2.5 pb-0">
        <div className="flex items-baseline gap-1.5 border-b border-slate-800 pb-1.5 text-[12px]">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">To</span>
          <span className="text-slate-200 font-medium">{a.to_name ?? "—"}</span>
          {a.to_email ? (
            <span className="text-slate-500">&lt;{a.to_email}&gt;</span>
          ) : null}
        </div>
        {a.subject ? (
          <div className="flex items-baseline gap-1.5 py-1.5 text-[12px]">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Subject</span>
            <span className="text-slate-200">{a.subject}</span>
          </div>
        ) : null}
      </div>
      {/* Body */}
      <div className="whitespace-pre-wrap rounded-b-lg border-x border-b border-slate-700/60 bg-slate-950/40 px-3 py-2.5 text-[13px] leading-relaxed text-slate-200">
        {body || <span className="text-slate-600 italic">No body generated.</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <a
          href={gmailUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-red-200 transition hover:bg-red-500/20"
        >
          Open Gmail
        </a>
        <a
          href={outlookUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-sky-200 transition hover:bg-sky-500/20"
        >
          Outlook
        </a>
      </div>
    </Card>
  );
}

// --- Job apply -----------------------------------------------------------

function JobApplyCard({ a }: { a: JobApplyArtifact }) {
  const applyUrl = a.application_url ?? (a.company ? googleSearchUrl(a.company + " " + (a.role ?? "") + " apply") : "#");

  return (
    <Card title="Job" subtitle={a.role} tone="info">
      {/* Company + meta */}
      <div className="flex flex-wrap items-center gap-2">
        {a.company ? (
          <span className="text-[14px] font-semibold text-slate-200">{a.company}</span>
        ) : null}
        {a.location ? <Pill tone="slate">{a.location}</Pill> : null}
        {a.salary_range ? <Pill tone="emerald">{a.salary_range}</Pill> : null}
      </div>

      {/* Skills */}
      {a.key_skills?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {a.key_skills.map((s, i) => (
            <Pill key={i} tone="sky">{s}</Pill>
          ))}
        </div>
      ) : null}

      {/* Requirements */}
      {a.requirements?.length ? (
        <div>
          <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-slate-500">Requirements</div>
          <Bullets items={a.requirements} />
        </div>
      ) : null}

      {/* Notes */}
      {a.notes?.length ? (
        <div>
          <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-amber-400/70">Notes</div>
          <Bullets items={a.notes} />
        </div>
      ) : null}

      {/* CTAs */}
      <div className="flex flex-wrap gap-1.5">
        <a
          href={applyUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-mono font-semibold uppercase tracking-wider text-emerald-200 transition hover:bg-emerald-500/25"
        >
          Apply Now →
        </a>
        {a.linkedin_easy_apply ? (
          <a
            href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent((a.role ?? "") + " " + (a.company ?? ""))}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-sky-200 transition hover:bg-sky-500/20"
          >
            LinkedIn
          </a>
        ) : (
          <LinkButton
            href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent((a.role ?? "") + " " + (a.company ?? ""))}`}
          >
            LinkedIn
          </LinkButton>
        )}
      </div>
    </Card>
  );
}

// --- Grocery list --------------------------------------------------------

const GROCERY_CATEGORY_ORDER = ["produce", "meat", "dairy", "bakery", "pantry", "frozen", "other"];

function GroceryListCard({ a }: { a: GroceryListArtifact }) {
  const items = a.items ?? [];
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const grouped = useMemo(() => {
    const map = new Map<string, { item: (typeof items)[0]; idx: number }[]>();
    items.forEach((item, idx) => {
      const cat = item.category ?? "other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push({ item, idx });
    });
    return map;
  }, [items]);

  const sortedCategories = [...grouped.keys()].sort((x, y) => {
    const xi = GROCERY_CATEGORY_ORDER.indexOf(x);
    const yi = GROCERY_CATEGORY_ORDER.indexOf(y);
    return (xi === -1 ? 99 : xi) - (yi === -1 ? 99 : yi);
  });

  return (
    <Card
      title={`Grocery list${a.recipe_name ? ` · ${a.recipe_name}` : ""}`}
      subtitle={
        a.servings
          ? `${a.servings} servings · ${items.length} items`
          : `${items.length} items`
      }
      tone="success"
    >
      <div className="flex flex-col gap-3">
        {sortedCategories.map((cat) => (
          <div key={cat}>
            <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-slate-500">
              {cat}
            </div>
            <div className="flex flex-col gap-0.5">
              {grouped.get(cat)!.map(({ item, idx }) => (
                <label
                  key={idx}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1 transition hover:bg-slate-800/40"
                >
                  <input
                    type="checkbox"
                    checked={checked.has(idx)}
                    onChange={() => toggle(idx)}
                    className="h-3.5 w-3.5 rounded accent-emerald-500"
                  />
                  <span
                    className={`flex-1 text-[13px] transition ${
                      checked.has(idx) ? "text-slate-600 line-through" : "text-slate-200"
                    }`}
                  >
                    {item.name}
                  </span>
                  {item.quantity ? (
                    <span className="shrink-0 font-mono text-[11px] text-slate-500">
                      {item.quantity}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {checked.size > 0 ? (
        <div className="text-[11px] text-slate-500">
          {checked.size} / {items.length} collected
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {a.instacart_query ? (
          <a
            href={`https://www.instacart.com/store/all/all?query=${encodeURIComponent(a.instacart_query)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-200 transition hover:bg-emerald-500/20"
          >
            Instacart
          </a>
        ) : null}
        {a.walmart_grocery_query ? (
          <a
            href={`https://www.walmart.com/grocery/search?query=${encodeURIComponent(a.walmart_grocery_query)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-slate-700/70 bg-slate-900/70 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-200"
          >
            Walmart Grocery
          </a>
        ) : null}
      </div>
    </Card>
  );
}

// --- Fallback ------------------------------------------------------------

function GenericCard({ a }: { a: GenericArtifact }) {
  const keys = Object.keys(a).filter((k) => k !== "kind");
  return (
    <Card title={a.action ? `Result · ${a.action}` : "Result"} tone="neutral">
      {typeof a.text === "string" && a.text ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-[12.5px] leading-relaxed text-slate-200">
          {a.text}
        </pre>
      ) : (
        <pre className="max-h-48 overflow-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-[11.5px] text-slate-300">
          {JSON.stringify(
            keys.reduce<Record<string, unknown>>((acc, k) => {
              acc[k] = (a as Record<string, unknown>)[k];
              return acc;
            }, {}),
            null,
            2,
          )}
        </pre>
      )}
      {a.notes?.length ? <Bullets items={a.notes} /> : null}
    </Card>
  );
}
