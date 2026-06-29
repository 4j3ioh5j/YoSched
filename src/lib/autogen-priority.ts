// Source-of-truth description of HOW auto-generation prioritizes its decisions.
//
// TODAY this order is hardcoded in `auto-scheduler.ts` — both the objective that
// GRADES a finished schedule (the lexicographic `rank[]`, ~line 2526) and the greedy
// STEP pipeline that BUILDS one. This module does NOT change any of that: it only
// DESCRIBES the fixed order so the Settings "Auto-Generation Priority" panel can make
// it visible (Slice 0, read-only transparency — handoff #252).
//
// Slice 1 turns `PRIORITY_FACTORS` into a persisted, admin-reorderable config and
// builds `rank[]` from it instead of the literal; keep this the seed / source of
// truth. Slice 2 teaches the builder to honor the configured order (the real 8/4
// fix). Until then, everything here is informational.

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
  {
    key: "rolling-max",
    label: "Rolling maximum caps",
    description:
      "A staff member never exceeds their hard maximum count of a shift within any rolling window.",
  },
];

// Display metadata for the negotiable factors, keyed by the canonical factor `key`
// shared with the engine (DEFAULT_FACTOR_ORDER in auto-scheduler.ts) and the
// AutoGenFactor table. The live precedence order + enabled state come from the DB;
// this is just the label + description the Settings panel renders. Slice 1 has the
// four current aggregate factors; Slice 2 adds split keys (coverage, hours over/under).
export const FACTOR_META: Record<string, FactorMeta> = {
  coverageAndHardLimits: {
    label: "Coverage & hard staffing limits",
    description:
      "Meet the required number of staff for every shift, every day, and respect hard per-staff minimums and maximums. (Today coverage and the hard limits share one tier.)",
  },
  ppHours: {
    label: "Pay-period hours balance",
    description:
      "Keep each person close to their pay-period hour target. Today this penalizes going over and under target equally.",
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
// feature. Tracks David's locked decisions (handoff #252 + 2026-06-28 directional-hours
// policy). Reordering today re-ranks how finished schedules are GRADED; the builder's
// placement still follows its fixed pipeline until the next step.
export const PRIORITY_ROADMAP_NOTE =
  "Reordering changes how auto-generation grades a finished schedule. Coming next: the builder will " +
  "also honor this order while placing shifts, coverage will split out of the top factor so it can be " +
  "ranked against hours, and pay-period hours will split into “over target” (soft — better to go " +
  "slightly over than leave a shift uncovered) and “under target” (not allowed without a manual override).";
