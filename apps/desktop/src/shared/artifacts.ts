/**
 * Shared artifact types for the Glance pivot.
 *
 * The backend `/artifact` route returns `{ artifact: <data>, meta: {...} }`
 * where `data.kind` is one of the strings below. The renderer uses a
 * discriminated union to dispatch to the right card component.
 */

export type ArtifactCategory =
  | "understand"
  | "act"
  | "discover"
  | "create"
  | "connect";

export type ActionSummary = {
  id: string;
  category: ArtifactCategory;
  label: string;
  blurb: string;
  needs_text: boolean;
  needs_image: boolean;
};

// --- Individual artifact shapes (all fields optional — models can be lossy) --

export type TranslateArtifact = {
  kind: "translate";
  detected_lang?: string;
  target_lang?: string;
  original?: string;
  translation?: string;
  notes?: string[];
};

export type SolveMathArtifact = {
  kind: "solve_math";
  problem?: string;
  answer?: string;
  latex?: string;
  steps?: string[];
  notes?: string[];
};

export type ExplainCodeArtifact = {
  kind: "explain_code";
  language?: string;
  summary?: string;
  walkthrough?: string[];
  risks?: string[];
  complexity?: string;
};

export type FixCodeArtifact = {
  kind: "fix_code";
  language?: string;
  diagnosis?: string;
  original?: string;
  fixed?: string;
  changes?: string[];
};

export type DiagnoseErrorArtifact = {
  kind: "diagnose_error";
  error?: string;
  likely_cause?: string;
  fix_steps?: string[];
  snippets?: { label?: string; code?: string }[];
};

export type ExplainChartArtifact = {
  kind: "explain_chart";
  headline?: string;
  key_points?: string[];
  caveats?: string[];
};

export type CritiqueUiArtifact = {
  kind: "critique_ui";
  strengths?: string[];
  issues?: string[];
  suggestions?: string[];
};

export type IdentifyArtifact = {
  kind: "identify";
  name?: string;
  category?: string;
  confidence?: "low" | "medium" | "high" | string;
  facts?: string[];
  links?: { label: string; query: string }[];
};

export type RewriteArtifact = {
  kind: "rewrite";
  original?: string;
  variants?: { tone: string; text: string }[];
};

export type TasksCalendarArtifact = {
  kind: "tasks_to_calendar";
  events?: {
    title: string;
    when?: string;
    duration_min?: number;
    notes?: string;
  }[];
};

export type DraftReplyArtifact = {
  kind: "draft_reply";
  subject?: string;
  body?: string;
  tone?: string;
};

export type DiagramMermaidArtifact = {
  kind: "diagram_to_mermaid";
  mermaid?: string;
  notes?: string[];
};

export type RecipeArtifact = {
  kind: "recipe";
  dish?: string;
  cuisine?: string;
  ingredients?: string[];
  steps?: string[];
  time_min?: number;
  where_to_buy_query?: string;
};

export type ProductArtifact = {
  kind: "product";
  name?: string;
  summary?: string;
  price_range?: string;
  review_bullets?: string[];
  search_queries?: { label: string; query: string }[];
};

export type MediaLookupArtifact = {
  kind: "media_lookup";
  title?: string;
  type?: string;
  summary?: string;
  cast_or_authors?: string[];
  where_to_find?: { label: string; query: string }[];
};

export type TravelArtifact = {
  kind: "travel";
  name?: string;
  history?: string;
  map_query?: string;
};

export type AnswerArtifact = {
  kind: "answer";
  title?: string;
  body?: string;
  followups?: string[];
};

// Optional fields every artifact kind may carry when the agent wants to
// suggest a different artifact type for the same context.
export type SuggestedAction = {
  id: string;
  label?: string;
  reason?: string;
};

export type ArtifactMeta = {
  provider: string;
  model: string;
  session_id: string;
  routed_action?: string | null;
  routed_reason?: string | null;
};

export type GenericArtifact = {
  kind: "generic" | string;
  action?: string;
  text?: string;
  notes?: string[];
  [key: string]: unknown;
};

// Every concrete artifact may carry these suggestion hooks — the renderer
// reads them on the raw object rather than requiring each union member to
// redeclare them.
type WithSuggestions = {
  suggested_action?: SuggestedAction;
  suggested_alternatives?: SuggestedAction[];
};

export type Artifact = (
  | TranslateArtifact
  | SolveMathArtifact
  | ExplainCodeArtifact
  | FixCodeArtifact
  | DiagnoseErrorArtifact
  | ExplainChartArtifact
  | CritiqueUiArtifact
  | IdentifyArtifact
  | RewriteArtifact
  | TasksCalendarArtifact
  | DraftReplyArtifact
  | DiagramMermaidArtifact
  | RecipeArtifact
  | ProductArtifact
  | MediaLookupArtifact
  | TravelArtifact
  | AnswerArtifact
  | GenericArtifact
) &
  WithSuggestions;

export type ArtifactResponse = {
  artifact: Artifact;
  meta: ArtifactMeta;
};

// Ordering + labels for the action bar.
export const CATEGORY_ORDER: ArtifactCategory[] = [
  "understand",
  "act",
  "discover",
  "create",
  "connect",
];

export const CATEGORY_LABELS: Record<ArtifactCategory, string> = {
  understand: "Understand",
  act: "Act",
  discover: "Discover",
  create: "Create",
  connect: "Connect",
};
