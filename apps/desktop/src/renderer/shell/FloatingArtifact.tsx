import type { ReactNode } from "react";
import { motion } from "framer-motion";

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
 * A chromeless floating artifact. The artifact content itself is rendered
 * raw — no card, no border — and a floating action bar sits below it with
 * staggered entrance + spring hover/tap.
 */
export function FloatingArtifact({
  artifact,
  onClose,
  onFollowUp,
  onRedo,
  onOpenChat,
}: Props) {
  return (
    <div className="flex w-full flex-col items-end gap-2">
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

      <motion.div
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.045, delayChildren: 0.08 } },
        }}
        className="flex flex-wrap items-center justify-end gap-1.5"
      >
        <ActionButton
          onClick={() => copyArtifact(artifact)}
          icon={<CopyIcon />}
          label="Copy"
        />
        {onRedo ? (
          <ActionButton onClick={onRedo} icon={<RedoIcon />} label="Redo" />
        ) : null}
        <ActionButton
          onClick={onFollowUp}
          icon={<FollowUpIcon />}
          label="Ask follow-up"
        />
        {onOpenChat ? (
          <ActionButton
            onClick={onOpenChat}
            icon={<ChatIcon />}
            label="Full chat"
          />
        ) : null}
        <ActionButton
          onClick={onClose}
          icon={<CloseIcon />}
          label="Dismiss"
          variant="danger"
        />
      </motion.div>
    </div>
  );
}

function ActionButton({
  onClick,
  icon,
  label,
  variant,
}: {
  onClick: () => void;
  icon: ReactNode;
  label: string;
  variant?: "default" | "danger" | "primary";
}) {
  const cls =
    "ghost-btn" +
    (variant === "danger" ? " danger" : variant === "primary" ? " primary" : "");
  return (
    <motion.button
      variants={{
        hidden: { opacity: 0, y: 8, scale: 0.92 },
        visible: { opacity: 1, y: 0, scale: 1, transition: SPRING },
      }}
      whileHover={{ scale: 1.05, y: -1 }}
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className={cls}
    >
      <span className="opacity-80">{icon}</span>
      <span className="text-[11px] font-medium uppercase tracking-wider">
        {label}
      </span>
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
