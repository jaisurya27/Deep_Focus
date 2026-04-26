import { useEffect, useMemo, useState } from "react";

import { listActions } from "../lib/api";
import type {
  ActionSummary,
  ArtifactCategory,
} from "../../shared/artifacts";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "../../shared/artifacts";

type Props = {
  hasText: boolean;
  hasImage: boolean;
  disabled?: boolean;
  onPick: (action: ActionSummary) => void;
};

/**
 * Category-grouped action bar. Shows only actions whose input requirements
 * match the currently-attached context. Hidden entirely when no context.
 */
export function ActionBar({ hasText, hasImage, disabled, onPick }: Props) {
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [activeCategory, setActiveCategory] = useState<ArtifactCategory>(
    "understand",
  );

  useEffect(() => {
    let cancelled = false;
    listActions().then((list) => {
      if (!cancelled) setActions(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const available = useMemo(() => {
    return actions.filter((a) => {
      if (a.needs_image && !hasImage) return false;
      if (a.needs_text && !hasText && !hasImage) return false;
      return true;
    });
  }, [actions, hasImage, hasText]);

  const byCategory = useMemo(() => {
    const map: Record<string, ActionSummary[]> = {};
    for (const a of available) {
      (map[a.category] ??= []).push(a);
    }
    return map;
  }, [available]);

  const populatedCategories = useMemo(
    () => CATEGORY_ORDER.filter((c) => byCategory[c]?.length),
    [byCategory],
  );

  useEffect(() => {
    if (
      populatedCategories.length &&
      !populatedCategories.includes(activeCategory)
    ) {
      setActiveCategory(populatedCategories[0]);
    }
  }, [populatedCategories, activeCategory]);

  if (!hasText && !hasImage) return null;
  if (!populatedCategories.length) return null;

  const chips = byCategory[activeCategory] ?? [];

  return (
    <div className="border-b border-slate-800/80 bg-gradient-to-b from-slate-950/80 to-slate-950/40 px-4 py-2">
      <div className="mb-1.5 flex items-center gap-1">
        <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300/70">
          Glance
        </span>
        {populatedCategories.map((c) => {
          const active = c === activeCategory;
          return (
            <button
              key={c}
              onClick={() => setActiveCategory(c)}
              className={
                "rounded-full px-2.5 py-[3px] text-[10px] font-mono uppercase tracking-wider transition " +
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
      <div className="flex flex-wrap gap-1.5">
        {chips.map((a) => (
          <button
            key={a.id}
            disabled={disabled}
            onClick={() => onPick(a)}
            title={a.blurb}
            className="group rounded-full border border-slate-800 bg-slate-900/60 px-2.5 py-[4px] text-[11.5px] text-slate-200 transition hover:border-emerald-500/50 hover:bg-emerald-500/5 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
