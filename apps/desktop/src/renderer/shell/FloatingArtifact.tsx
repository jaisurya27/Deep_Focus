import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

import type { Artifact } from "../../shared/artifacts";
import { ArtifactCard } from "../artifacts/ArtifactCard";
import {
  ChatIcon,
  CloseIcon,
  CopyIcon,
  FollowUpIcon,
  RedoIcon,
} from "./icons";

type Props = {
  artifact: Artifact;
  onClose: () => void;
  onFollowUp: () => void;
  onRedo?: () => void;
  onOpenChat?: () => void;
};

const SPRING = { type: "spring", stiffness: 420, damping: 36, mass: 0.9 } as const;

/**
 * Just the artifact body (the card itself). The action rail lives in the
 * shell's TopBar so drag/close + copy/follow-up/dismiss all share a single
 * horizontal row above the output.
 */
export function FloatingArtifact({ artifact }: { artifact: Artifact }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.98 }}
      transition={SPRING}
      className="max-h-[60vh] w-full overflow-y-auto stage-scroll px-1"
    >
      <ArtifactCard artifact={artifact} />
    </motion.div>
  );
}

/**
 * Compact icon-only rail of artifact actions: Copy / Redo? / Follow-up /
 * Full chat? / Dismiss. Rendered by the shell inside the TopBar row, so it
 * sits on the same line as the drag + close buttons, floating above the
 * artifact body. Each button is a 24px glass pill; hover/focus springs in
 * the label and expands the pill's width.
 */
export function ArtifactActionRail({
  artifact,
  onClose,
  onFollowUp,
  onRedo,
  onOpenChat,
}: Props) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={SPRING}
      className="flex items-center gap-1"
    >
      <IconAction
        onClick={() => copyArtifact(artifact)}
        icon={<CopyIcon />}
        label="Copy"
      />
      {onRedo ? (
        <IconAction onClick={onRedo} icon={<RedoIcon />} label="Redo" />
      ) : null}
      <IconAction
        onClick={onFollowUp}
        icon={<FollowUpIcon />}
        label="Follow-up"
      />
      {onOpenChat ? (
        <IconAction
          onClick={onOpenChat}
          icon={<ChatIcon />}
          label="Full chat"
        />
      ) : null}
      <IconAction
        onClick={onClose}
        icon={<CloseIcon />}
        label="Dismiss"
        tone="danger"
      />
    </motion.div>
  );
}

/**
 * Icon-first glass button. 24px round by default; on hover/focus the label
 * slides in and the button expands with a spring. Sized to match the
 * shell's other top-row affordances exactly.
 */
function IconAction({
  onClick,
  icon,
  label,
  tone = "default",
}: {
  onClick: () => void;
  icon: ReactNode;
  label: string;
  tone?: "default" | "danger";
}) {
  const [hover, setHover] = useState(false);
  const hoverCls =
    tone === "danger" ? "hover:text-rose-200" : "hover:text-emerald-200";
  return (
    <motion.button
      layout
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      onClick={onClick}
      whileTap={{ scale: 0.92 }}
      transition={SPRING}
      aria-label={label}
      title={label}
      className={`glass flex h-6 items-center gap-1 rounded-full px-1.5 text-slate-300 transition-colors ${hoverCls}`}
    >
      <span className="flex h-3 w-3 items-center justify-center">{icon}</span>
      <AnimatePresence initial={false}>
        {hover ? (
          <motion.span
            key="label"
            initial={{ opacity: 0, width: 0, marginLeft: -2, marginRight: -2 }}
            animate={{ opacity: 1, width: "auto", marginLeft: 0, marginRight: 2 }}
            exit={{ opacity: 0, width: 0, marginLeft: -2, marginRight: -2 }}
            transition={{ type: "spring", stiffness: 500, damping: 34 }}
            className="overflow-hidden whitespace-nowrap text-[9.5px] font-medium uppercase tracking-wider"
          >
            {label}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.button>
  );
}

function copyArtifact(a: Artifact) {
  const text = stringify(a);
  if (!text) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* ignore */
  });
}

function stringify(artifact: Artifact): string {
  const a = artifact as Record<string, unknown> & { kind: string };
  const arr = (k: string): unknown[] => (Array.isArray(a[k]) ? (a[k] as unknown[]) : []);
  const s = (k: string): string => (typeof a[k] === "string" ? (a[k] as string) : "");

  switch (a.kind) {
    case "translate":
      return s("translation") || s("original");
    case "solve_math":
      return [s("problem"), s("answer"), ...arr("steps")].filter(Boolean).join("\n");
    case "explain_code":
      return [s("summary"), ...arr("walkthrough")].filter(Boolean).join("\n- ");
    case "fix_code":
      return s("fixed");
    case "diagnose_error":
      return [s("likely_cause"), ...arr("fix_steps")].filter(Boolean).join("\n- ");
    case "explain_chart":
      return [s("headline"), ...arr("key_points")].filter(Boolean).join("\n- ");
    case "critique_ui":
      return [
        "Strengths:",
        ...arr("strengths"),
        "Issues:",
        ...arr("issues"),
        "Suggestions:",
        ...arr("suggestions"),
      ].join("\n");
    case "identify":
      return [s("name"), ...arr("facts")].filter(Boolean).join("\n- ");
    case "rewrite":
      return arr("variants")
        .map((v) => {
          const vv = v as { tone?: string; text?: string };
          return `[${vv.tone ?? ""}] ${vv.text ?? ""}`;
        })
        .join("\n\n");
    case "tasks_to_calendar":
      return arr("events")
        .map((e) => {
          const ev = e as { title?: string; when?: string };
          return `• ${ev.title ?? ""}${ev.when ? ` — ${ev.when}` : ""}`;
        })
        .join("\n");
    case "draft_reply":
      return [a.subject ? `Subject: ${s("subject")}` : "", s("body")]
        .filter(Boolean)
        .join("\n\n");
    case "diagram_to_mermaid":
      return s("mermaid");
    case "recipe":
      return [
        s("dish"),
        "",
        "Ingredients:",
        ...arr("ingredients").map((i) => `• ${String(i)}`),
        "",
        "Steps:",
        ...arr("steps").map((step, i) => `${i + 1}. ${String(step)}`),
      ].join("\n");
    case "product":
      return [s("name"), s("summary"), s("price_range"), ...arr("review_bullets")]
        .filter(Boolean)
        .join("\n");
    case "media_lookup":
      return [s("title"), s("summary"), arr("cast_or_authors").join(", ")]
        .filter(Boolean)
        .join("\n");
    case "travel":
      return [s("name"), s("history")].filter(Boolean).join("\n");
    case "answer":
      return [s("title"), s("body")].filter(Boolean).join("\n\n");
    default:
      return JSON.stringify(a, null, 2);
  }
}
