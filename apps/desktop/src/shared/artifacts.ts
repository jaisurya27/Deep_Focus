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

export type MapArtifact = {
  kind: "map";
  title?: string;
  address?: string;
  description?: string;
  map_query?: string;
  directions_from?: string | null;
  place_type?: string;
  links?: { label: string; query: string }[];
};

export type ShoppingItem = {
  retailer: string;
  price?: string | null;
  url?: string;
  add_to_cart?: boolean;
};

export type ShoppingArtifact = {
  kind: "shopping";
  product_name?: string;
  description?: string;
  price_range?: string;
  image_search?: string;
  items?: ShoppingItem[];
};

export type FoodOrderArtifact = {
  kind: "food_order";
  dish?: string;
  cuisine?: string;
  recipe?: {
    ingredients?: string[];
    steps?: string[];
    time_min?: number;
  };
  order_options?: {
    platform: string;
    search_query?: string;
    url?: string;
  }[];
  nearby_query?: string;
};

export type WeatherDay = {
  day: string;
  high_f?: number;
  low_f?: number;
  condition?: string;
};

export type WeatherArtifact = {
  kind: "weather";
  location?: string;
  condition?: string;
  temperature_f?: number;
  temperature_c?: number;
  feels_like_f?: number;
  humidity?: number;
  wind_mph?: number;
  wind_direction?: string;
  forecast?: WeatherDay[];
  weather_query?: string;
};

export type RestaurantBookingArtifact = {
  kind: "restaurant_booking";
  name?: string;
  cuisine?: string;
  address?: string;
  rating?: number;
  price_level?: string;
  description?: string;
  opentable_query?: string;
  opentable_url?: string;
  phone?: string | null;
  map_query?: string;
  hours?: string | null;
};

export type FlightTrackArtifact = {
  kind: "flight_track";
  route?: string;
  origin?: string;
  destination?: string;
  current_price?: string | null;
  airline?: string | null;
  flight_number?: string | null;
  departure_date?: string;
  duration?: string | null;
  typical_price_range?: string | null;
  price_trend?: "rising" | "falling" | "stable" | string;
  google_flights_url?: string;
  kayak_url?: string;
};

export type EmailComposeArtifact = {
  kind: "email_compose";
  to_name?: string;
  to_email?: string | null;
  subject?: string;
  body?: string;
  tone?: string;
  cc?: string | null;
};

export type JobApplyArtifact = {
  kind: "job_apply";
  company?: string;
  role?: string;
  location?: string;
  salary_range?: string | null;
  requirements?: string[];
  key_skills?: string[];
  application_url?: string | null;
  linkedin_easy_apply?: boolean;
  notes?: string[];
};

export type GroceryListItem = {
  name: string;
  quantity?: string;
  category?: string;
};

export type GroceryListArtifact = {
  kind: "grocery_list";
  recipe_name?: string;
  servings?: number;
  items?: GroceryListItem[];
  instacart_query?: string;
  walmart_grocery_query?: string;
};

/**
 * Smart-context escape hatch. Emitted by the backend when the router sees
 * that the user is asking about something visual/contextual on their screen
 * but no image was captured. The renderer fulfills the declared `needs`
 * (currently just `"screenshot"`) and automatically re-runs the same
 * instruction, producing a seamless "oh, let me actually look at your
 * screen" experience instead of a confused "I can't see your screen" reply.
 */
export type NeedsContextArtifact = {
  kind: "needs_context";
  /** What the frontend should collect before retrying. */
  needs?: Array<"screenshot" | "selection" | "active_window">;
  /** Short explanation of why we're asking. */
  reason?: string;
  /** The original user instruction, preserved for the retry. */
  retry_instruction?: string | null;
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
  | NeedsContextArtifact
  | MapArtifact
  | ShoppingArtifact
  | FoodOrderArtifact
  | WeatherArtifact
  | RestaurantBookingArtifact
  | FlightTrackArtifact
  | EmailComposeArtifact
  | JobApplyArtifact
  | GroceryListArtifact
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
