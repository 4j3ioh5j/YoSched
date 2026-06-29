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

/** A negotiable policy factor. `tier` is its current position in the lexicographic
 *  `rank[]` (lower = higher precedence; ties broken by the next tier down). */
export type PriorityFactor = {
  key: string;
  label: string;
  description: string;
  tier: number;
};

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

// The negotiable factors, in current precedence order (tier 0 = highest). This mirrors
// `rank[]` = [hardBreaches, ppHoursDeviation, requestsDenied, fairnessSpread] exactly.
export const PRIORITY_FACTORS: PriorityFactor[] = [
  {
    key: "coverage-and-hard-limits",
    label: "Coverage & hard staffing limits",
    description:
      "Meet the required number of staff for every shift, every day, and respect hard per-staff minimums and maximums. Highest priority. (Today coverage and the hard limits share one tier.)",
    tier: 0,
  },
  {
    key: "pp-hours",
    label: "Pay-period hours balance",
    description:
      "Keep each person close to their pay-period hour target. Today this penalizes going over and under target equally.",
    tier: 1,
  },
  {
    key: "requests",
    label: "Requested shifts honored",
    description: "Honor staff shift requests that aren’t already guaranteed by an approval.",
    tier: 2,
  },
  {
    key: "fairness",
    label: "Fairness / equity spread",
    description: "Distribute undesirable shifts evenly across staff (FTE-normalized).",
    tier: 3,
  },
];

// What this panel will become — shown as a forward-looking note so the current
// (fixed) state isn't mistaken for the finished feature. Tracks David's locked
// decisions (handoff #252 + 2026-06-28 directional-hours policy).
export const PRIORITY_ROADMAP_NOTE =
  "This order is currently fixed. It will become admin-reorderable (drag to rank). Coverage will " +
  "split out of the top tier so it can be ranked against hours, and pay-period hours will split into " +
  "“over target” (soft — better to go slightly over than leave a shift uncovered) and " +
  "“under target” (not allowed without a manual override).";
