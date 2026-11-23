// The re-solve scope for auto-generate (Live) edits — how much of the schedule the
// engine may change to compensate for an edit (#248). "limited" = minimal/expanding
// freeing (least churn, no PP-hours rebalance); the others free everything in scope
// and rebalance hours. Single source of truth for the grid selector, the Settings
// default picker, and the API validator.

export const LIVE_SCOPES = ["limited", "day", "pp", "range"] as const;
export type LiveScope = (typeof LIVE_SCOPES)[number];

export const DEFAULT_LIVE_SCOPE: LiveScope = "day";

export function isLiveScope(v: unknown): v is LiveScope {
  return typeof v === "string" && (LIVE_SCOPES as readonly string[]).includes(v);
}

// Lenient parse for stored/legacy values — falls back to the default.
export function parseLiveScope(v: unknown): LiveScope {
  return isLiveScope(v) ? v : DEFAULT_LIVE_SCOPE;
}

export const LIVE_SCOPE_LABELS: Record<LiveScope, string> = {
  limited: "Limited",
  day: "Day(s)",
  pp: "Pay period",
  range: "Whole range",
};

// One short sentence per scope (card #461): the tooltip on each Auto-generate banner button
// and the hint under each choice in Settings. Hand-placed and locked cells never move in any scope.
export const LIVE_SCOPE_HINTS: Record<LiveScope, string> = {
  limited: "Fewest changes: other cells move only if coverage needs it; hours may drift.",
  day: "Re-solves only the day(s) you edited.",
  pp: "Re-solves the pay period(s) you edited and rebalances hours.",
  range: "Re-solves the whole schedule being generated: the most changes.",
};
