import { useMemo, useState } from "react";

import type {
  Artifact,
  CritiqueUiArtifact,
  DiagnoseErrorArtifact,
  DiagramMermaidArtifact,
  DraftReplyArtifact,
  ExplainChartArtifact,
  ExplainCodeArtifact,
  FixCodeArtifact,
  GenericArtifact,
  IdentifyArtifact,
  MediaLookupArtifact,
  ProductArtifact,
  RecipeArtifact,
  RewriteArtifact,
  SolveMathArtifact,
  TasksCalendarArtifact,
  TranslateArtifact,
  TravelArtifact,
} from "../../shared/artifacts";

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
    default:
      return <GenericCard a={artifact as GenericArtifact} />;
  }
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
  subtitle?: string | null;
  tone?: "neutral" | "success" | "warn" | "info";
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  // Glance: artifacts float chromeless. Only a whisper-quiet label remains
  // above the content; the FloatingArtifact shell provides action buttons.
  return (
    <div className="flex flex-col gap-3 text-slate-100">
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

function SolveMathCard({ a }: { a: SolveMathArtifact }) {
  return (
    <Card title="Solve" subtitle={a.problem} tone="info">
      {a.answer ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-[14px] text-emerald-200">
          = {a.answer}
        </div>
      ) : null}
      {a.steps?.length ? (
        <ol className="ml-5 list-decimal space-y-1 text-[13px] text-slate-200 marker:text-emerald-400/60">
          {a.steps.map((s, i) => (
            <li key={i}>{s}</li>
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
  return (
    <Card title="Rewrite" tone="info">
      <div className="flex flex-col gap-2">
        {a.variants?.map((v, i) => (
          <div
            key={i}
            className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5"
          >
            <div className="mb-1 flex items-center justify-between">
              <Pill tone="emerald">{v.tone}</Pill>
              <CopyButton text={v.text} />
            </div>
            <div className="text-[13px] leading-relaxed text-slate-200">
              {v.text}
            </div>
          </div>
        ))}
      </div>
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

function DiagramMermaidCard({ a }: { a: DiagramMermaidArtifact }) {
  return (
    <Card
      title="Diagram → Mermaid"
      tone="info"
      actions={a.mermaid ? <CopyButton text={a.mermaid} /> : undefined}
    >
      {a.mermaid ? <CodeBlock code={a.mermaid} lang="mermaid" /> : null}
      {a.notes?.length ? <Bullets items={a.notes} /> : null}
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
