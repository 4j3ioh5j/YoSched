// Source-of-truth description of HOW auto-generation prioritizes its decisions.
//
// TODAY this order is hardcoded in `auto-scheduler.ts` — both the objective that
// GRADES a finished schedule (the lexicographic `rank[]`, ~line 2526) and the greedy
// STEP pipeline that BUILDS one. This module does NOT change any of that: it only
// DESCRIBES the fixed order so the Settings "Auto-Generation Priority" panel can make
// it visible (Slice 0, read-only transparency — handoff #252).
//
// Slice 1 turned the order into a persisted, admin-reorderable config and builds
// `rank[]` from it. Slice 2a split the aggregate factors (coverage out of the hard
// limits; pay-period hours into over/under) so they rank independently. Slice 2b
// teaches the builder to honor the order (the real 8/4 fix). The grading metadata
// here is the human-readable source of truth for those keys.

/** Constraints auto-generation can NEVER trade away — not reorderable, shown for transparency only. */
export type PinnedConstraint = {
  key: string;
  label: string;
  description: string;
};

/** Display metadata for a negotiable factor, keyed by the factor `key` that the engine
 *  (DEFAULT_FACTOR_ORDER) and the AutoGenFactor table share. The live order/enabled
 *  state comes from the DB; this supplies the human label + description. */
export type FactorMeta = { label: string; description: string };

// The hard structural constraints, pinned above every negotiable factor. These map to
// the gates in `isAvailable()` / the schema `@@unique([staffId,date])` — see #252 §2.3.
export const PINNED_CONSTRAINTS: PinnedConstraint[] = [
  {
    key: "one-per-day",
    label: "One shift per person per day",
    description: "A staff member is never double-booked on the same date.",
  },
  {
    key: "eligibility",
    label: "Shift eligibility",
    description: "Only staff qualified for a shift can be assigned to it.",
  },
  {
    key: "locked-manual",
    label: "Locked & manually-set cells",
    description: "Hand-placed and locked assignments are never changed by auto-generation.",
  },
  {
    key: "approved-requests",
    label: "Approved hard requests",
    description:
      "Approved time-off, leave, and “don’t schedule” requests are always honored; approved shift requests are placed.",
  },
  {
    key: "per-day-cap",
    label: "Per-day shift caps",
    description: "No more than the configured number of a shift on a single day (e.g. one ORC per day).",
  },
];

// Display metadata for the negotiable factors, keyed by the canonical factor `key`
// shared with the engine (DEFAULT_FACTOR_ORDER in auto-scheduler.ts) and the
// AutoGenFactor table. The live precedence order + enabled state come from the DB;
// this is just the label + description the Settings panel renders. Slice 1 has the
// four current aggregate factors; Slice 2 adds split keys (coverage, hours over/under).
export const FACTOR_META: Record<string, FactorMeta> = {
  hardLimits: {
    label: "Hard per-staff limits (min / max)",
    description:
      "Respect each staff member's hard minimum and maximum shift counts (the max is a rolling-window cap). Rank coverage above this to let auto-generation exceed a hard max when it's the only way to fill a required shift.",
  },
  coverage: {
    label: "Coverage (required staff per shift)",
    description:
      "Meet the required number of staff for every shift, every day. Rank this above hours to fill a shift even when it pushes someone over their pay-period target.",
  },
  overHours: {
    label: "Pay-period hours — over target",
    description:
      "Avoid scheduling people past their pay-period hour target. Ranked below coverage by default — better to go slightly over than leave a shift uncovered.",
  },
  underHours: {
    label: "Pay-period hours — under target",
    description:
      "Keep people from landing under their pay-period hour target. Under-target hours surface as a shortage to review rather than being produced silently.",
  },
  requests: {
    label: "Requested shifts honored",
    description: "Honor staff shift requests that aren’t already guaranteed by an approval.",
  },
  fairness: {
    label: "Fairness / equity spread",
    description: "Distribute undesirable shifts evenly across staff (FTE-normalized).",
  },
};

// Forward-looking note so the current capability isn't mistaken for the finished
// feature. Tracks David's locked decisions (handoff #252/#376 + directional-hours
// policy). Slice 2a split coverage out of the hard limits and hours into over/under so
// they can be ranked independently — but reordering still only re-ranks how finished
// schedules are GRADED. The builder honoring this order while placing shifts is next.
export const PRIORITY_ROADMAP_NOTE =
  "Reordering changes how auto-generation grades a finished schedule. Coming next: the builder will " +
  "also honor this order while placing shifts — e.g. ranking coverage above the hours or hard-limit " +
  "factors will let it exceed a pay-period target, or a hard maximum, when that's the only way to " +
  "fill a required shift.";
