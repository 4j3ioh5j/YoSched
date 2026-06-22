// Live-mode "what-if" primitive (#231 S1).
//
// `applyScenario` runs a CONSTRAINED re-solve: it locks the entire baseline grid,
// FREES only the cells the edit disturbed, PINS the new content as locked, and
// re-runs the (pure) engine. Because every untouched cell is locked, the engine
// only fills the holes left by the frees — so a real edit ripples a few cells,
// not a rebuild. The result is diffed against the baseline to surface exactly
// what moved.
//
// HYBRID infeasibility rule (#231): a pin that is HARD-illegal (staff ineligible
// or unavailable for that shift on that date) is rejected and NOTHING is applied
// — the caller snaps the edit back. SOFT breaches (PP-hours cap, coverage below
// floor) are allowed and surfaced as engine warnings for the UI to flag red.
//
// This module is pure (no prisma/next/fs/process.env) so it runs client-side.

import {
  autoSchedule,
  compareScheduleQuality,
  type AutoScheduleInput,
  type AutoScheduleResult,
  type ScheduleAssignment,
  type ScheduleStaff,
  type ScheduleShiftType,
} from "./auto-scheduler";
import { evaluateAvailability, type PayPeriodRange } from "./availability";
import { evaluateShiftEligibility } from "./shift-eligibility";
import { foldRequestsForDate, type PendingRequestMode, type ScheduleRequestData } from "./schedule-requests";
import { dayCapViolations } from "./max-per-day";

// A cell the edit forces into place (locked, the engine must honor it).
export type ScenarioPin = { staffId: string; date: string; shiftTypeId: string };
// A cell the edit emptied (the engine may refill it to keep coverage).
export type ScenarioFree = { staffId: string; date: string };

export type ScenarioGridCell = { staffId: string; date: string; shiftTypeId: string; code: string };

// One changed cell in the ripple (a "move" surfaces as a removed `before` on the
// source date plus an added `after` on the destination date).
export type ScenarioChange = {
  staffId: string;
  date: string;
  before: { shiftTypeId: string; code: string } | null;
  after: { shiftTypeId: string; code: string } | null;
};

export type ScenarioPinRejection = {
  staffId: string;
  date: string;
  shiftTypeId: string;
  // "manual-locked" is raised by the Live UI (not the engine): a user edit that
  // targets a hand-placed cell is refused so auto-generate can't overwrite/move it.
  // "day-full" means the pin would exceed the shift type's per-day cap (maxPerDay)
  // — e.g. a second ORC/ORL/ICU on a date that already has its one allowed.
  reason: "ineligible" | "unavailable" | "request-blocked" | "unknown-staff" | "unknown-shift" | "manual-locked" | "day-full";
};

export type ScenarioOutcome = {
  // True ⇒ the scenario was solved. False ⇒ at least one pin was HARD-illegal, so
  // NOTHING was applied: `grid` equals the baseline, `changes` is empty, and
  // `rejected` says why (the UI snaps the edit back).
  applied: boolean;
  // The full result grid (locked survivors ∪ new suggestions).
  grid: ScenarioGridCell[];
  // The ripple: every cell whose shift differs from the baseline.
  changes: ScenarioChange[];
  rejected: ScenarioPinRejection[];
  // SOFT breaches (PP-hours / coverage) the engine flagged — allow-with-warning.
  softWarnings: string[];
  // Quality vs baseline (#220 lexicographic): <0 ⇒ scenario BETTER, >0 ⇒ worse,
  // 0 ⇒ equal. 0 when nothing was applied.
  qualityDelta: number;
  // Raw engine output (suggestions, warnings, stats, quality).
  result: AutoScheduleResult;
};

const keyOf = (staffId: string, date: string) => `${staffId}:${date}`;
// staffIds are cuids and dates are YYYY-MM-DD — neither contains ':', so the
// first colon always separates the two.
function splitKey(k: string): [string, string] {
  const i = k.indexOf(":");
  return [k.slice(0, i), k.slice(i + 1)];
}

function ppRangesOf(input: AutoScheduleInput): PayPeriodRange[] {
  return input.payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate }));
}

// Could `staff` legally hold `st` on `date`? Mirrors the engine's `canHoldForSwap`
// (auto-scheduler.ts:1843) HARD gates — the constraints the HYBRID rule snaps back:
// (1) shift eligibility, (2) approved-request block (a hard OFF/leave request forbids
// working shifts; a NEGATE_SHIFT forbids the named shift — same fold the engine uses
// in `requestBlocksWork`), and (3) availability / working-day rules. Deferred and
// surfaced SOFTLY instead (via engine warnings/quality, since they need the
// engine-internal grid state): follow-rule adjacency, per-day caps, rolling max.
function pinHardLegality(
  staff: ScheduleStaff,
  st: ScheduleShiftType,
  date: string,
  ppRanges: PayPeriodRange[],
  isAssigned: (staffId: string, date: string) => boolean,
  requests: ScheduleRequestData[],
  pendingMode: PendingRequestMode,
  isAwayShift: (shiftTypeId: string) => boolean,
): "ok" | "ineligible" | "unavailable" | "request-blocked" {
  let eligible = staff.eligibleShiftTypeIds.includes(st.id);
  if (staff.shiftEligibilityRules && staff.shiftEligibilityRules.length > 0) {
    const r = evaluateShiftEligibility(staff.shiftEligibilityRules, st.id, date, ppRanges);
    // A soft preference (small negative weight) does NOT make a shift ineligible.
    if (r !== null) eligible = r.eligible || (r.weight < 0 && r.weight > -10);
  }
  if (!eligible) return "ineligible";
  // Mirror of the engine's requestBlocksWork (auto-scheduler.ts:508): an approved
  // hard OFF forbids any working (non-off, non-leave) shift; a hard NEGATE_SHIFT
  // forbids that shift id. PLUS a hard LEAVE: the engine enforces leave by
  // PRE-PLACING the locked leave cell (so isAssigned later blocks work) rather than
  // through requestBlocksWork — a standalone pin check has no pre-placement, so we
  // block working pins on a hard-leave day here (folded.leaveShiftTypeId is set
  // only for an approved hard LEAVE). Pinning OFF/leave on that day is still fine.
  if (requests.length > 0) {
    const folded = foldRequestsForDate(requests, staff.id, date, isAwayShift, pendingMode);
    if (folded.forbidWorking && !st.isOffShift && !st.isLeave) return "request-blocked";
    if (folded.forbiddenShiftIds.has(st.id)) return "request-blocked";
    if (folded.leaveShiftTypeId && !st.isOffShift && !st.isLeave) return "request-blocked";
  }
  if (!st.ignoresWorkingDays) {
    const avail = evaluateAvailability(staff.availabilityRules, date, ppRanges, isAssigned);
    if (!avail.available) return "unavailable";
  }
  return "ok";
}

/**
 * Constrained re-solve for one Live-mode edit.
 *
 * @param input  the full engine input bundle (its `existingAssignments` is the
 *               current baseline grid; this function does not mutate `input`).
 * @param pins   cells the edit forces into place (locked).
 * @param frees  cells the edit emptied (removed so the engine can refill them).
 */
export function applyScenario(
  input: AutoScheduleInput,
  pins: ScenarioPin[],
  frees: ScenarioFree[],
): ScenarioOutcome {
  const offShift = input.shiftTypes.find((s) => s.isOffShift);
  const staffById = new Map(input.staff.map((s) => [s.id, s] as const));
  const stById = new Map(input.shiftTypes.map((s) => [s.id, s] as const));
  const ppRanges = ppRangesOf(input);

  // Mirror the engine's request-fold inputs for hard pin validation.
  const requests = input.scheduleRequests ?? [];
  const pendingMode: PendingRequestMode = input.schedulingPreferences.pendingRequestMode ?? "off";
  const isAwayShift = (id: string): boolean => {
    const st = stById.get(id);
    return !!st && (st.isLeave || st.isOffShift);
  };

  // Baseline grid, and an isAssigned backing conditional-availability rules.
  const baseMap = new Map<string, ScheduleAssignment>();
  for (const a of input.existingAssignments) baseMap.set(keyOf(a.staffId, a.date), a);
  const baselineAssigned = (staffId: string, date: string): boolean => {
    const a = baseMap.get(keyOf(staffId, date));
    if (!a) return false;
    if (offShift && a.shiftTypeId === offShift.id) return false;
    return true;
  };

  // Grade the untouched, fully-locked baseline once — the quality-delta reference.
  const baselineRun = autoSchedule({
    ...input,
    existingAssignments: input.existingAssignments.map((a) => ({ ...a, isLocked: true })),
  });

  // Validate every pin's HARD legality BEFORE applying. Any rejection snaps the
  // whole edit back (an edit is atomic — a half-applied move is never shown).
  const rejected: ScenarioPinRejection[] = [];
  for (const pin of pins) {
    const staff = staffById.get(pin.staffId);
    const st = stById.get(pin.shiftTypeId);
    if (!staff) { rejected.push({ ...pin, reason: "unknown-staff" }); continue; }
    if (!st) { rejected.push({ ...pin, reason: "unknown-shift" }); continue; }
    const legality = pinHardLegality(staff, st, pin.date, ppRanges, baselineAssigned, requests, pendingMode, isAwayShift);
    if (legality !== "ok") rejected.push({ ...pin, reason: legality });
  }

  // Per-day caps (maxPerDay) — historically deferred from pinHardLegality because
  // they need the whole-day grid, not just the single staff. Count against the
  // baseline grid MINUS the cells this edit frees (an emptied cell no longer holds
  // its shift), with each pin REPLACING any cell at its key (dayCapViolations
  // handles overwrite + same-batch dedup). A pin that would exceed its shift's cap
  // is hard-rejected just like an illegal pin, so the edit snaps back. The engine
  // itself already honors maxPerDay, so only a user PIN can introduce a violation.
  const freedKeys = new Set(frees.map((f) => keyOf(f.staffId, f.date)));
  const capCurrent = input.existingAssignments
    .filter((a) => !freedKeys.has(keyOf(a.staffId, a.date)))
    .map((a) => ({ staffId: a.staffId, date: a.date, shiftTypeId: a.shiftTypeId }));
  for (const v of dayCapViolations(pins, capCurrent, (id) => stById.get(id)?.maxPerDay ?? null)) {
    rejected.push({ ...v, reason: "day-full" });
  }

  if (rejected.length > 0) {
    return {
      applied: false,
      grid: gridFromAssignments(input.existingAssignments),
      changes: [],
      rejected,
      softWarnings: [],
      qualityDelta: 0,
      result: baselineRun,
    };
  }

  // Build the constrained scenario: lock the whole baseline, drop freed + pinned
  // keys, then add the pins as locked cells. A freed cell must be REMOVED, not
  // merely unlocked — the engine still treats an unlocked non-OFF cell as
  // occupied (auto-scheduler.ts `assign`), so it would never be refilled.
  const freeKeys = new Set(frees.map((f) => keyOf(f.staffId, f.date)));
  const pinKeys = new Set(pins.map((p) => keyOf(p.staffId, p.date)));
  const survivors: ScheduleAssignment[] = input.existingAssignments
    .filter((a) => {
      const k = keyOf(a.staffId, a.date);
      return !freeKeys.has(k) && !pinKeys.has(k);
    })
    .map((a) => ({ ...a, isLocked: true }));
  for (const pin of pins) {
    const st = stById.get(pin.shiftTypeId)!;
    survivors.push({ staffId: pin.staffId, date: pin.date, shiftTypeId: pin.shiftTypeId, code: st.code, isLocked: true });
  }

  const result = autoSchedule({ ...input, existingAssignments: survivors });

  // Result grid = locked survivors ∪ new suggestions. The engine never re-emits a
  // locked cell, and freed keys were removed from `survivors`, so suggestions
  // never collide with survivors.
  const resultMap = new Map<string, { shiftTypeId: string; code: string }>();
  for (const a of survivors) resultMap.set(keyOf(a.staffId, a.date), { shiftTypeId: a.shiftTypeId, code: a.code });
  for (const s of result.suggestions) resultMap.set(keyOf(s.staffId, s.date), { shiftTypeId: s.shiftTypeId, code: s.code });

  // Diff vs baseline → the ripple.
  const changes: ScenarioChange[] = [];
  const allKeys = new Set<string>([...baseMap.keys(), ...resultMap.keys()]);
  for (const k of allKeys) {
    const b = baseMap.get(k);
    const r = resultMap.get(k);
    const beforeShift = b?.shiftTypeId ?? null;
    const afterShift = r?.shiftTypeId ?? null;
    if (beforeShift !== afterShift) {
      const [staffId, date] = splitKey(k);
      changes.push({
        staffId,
        date,
        before: b ? { shiftTypeId: b.shiftTypeId, code: b.code } : null,
        after: r ? { shiftTypeId: r.shiftTypeId, code: r.code } : null,
      });
    }
  }

  const grid: ScenarioGridCell[] = [];
  for (const [k, v] of resultMap) {
    const [staffId, date] = splitKey(k);
    grid.push({ staffId, date, shiftTypeId: v.shiftTypeId, code: v.code });
  }

  return {
    applied: true,
    grid,
    changes,
    rejected: [],
    softWarnings: result.warnings,
    qualityDelta: compareScheduleQuality(result.quality, baselineRun.quality),
    result,
  };
}

function gridFromAssignments(assignments: ScheduleAssignment[]): ScenarioGridCell[] {
  return assignments.map((a) => ({ staffId: a.staffId, date: a.date, shiftTypeId: a.shiftTypeId, code: a.code }));
}

export type CommitCell = { staffId: string; date: string; shiftTypeId: string };

// WYSIWYG Accept: the cells to persist when accepting an Auto-generate result.
// `savedGrid` is the SAVED DB grid captured at enter time (key `${staffId}:${date}`
// → shiftTypeId). Returns every outcome cell whose shift differs from what was
// saved — the engine's enter-time fills of empty slots, the user's edits, and the
// ripple alike (all of it is on screen). Cells unchanged from the saved grid are
// omitted, so they keep their stored `source`.
//
// Diffing against the SAVED grid (not an enter-time snapshot that already contains
// the fills) is the whole point: it stops the auto-fills from being silently
// dropped on Accept. A saved cell the user emptied (absent from `outcomeGrid`) is
// intentionally NOT cleared here — that matches the existing free-and-not-refilled
// behavior and would need a delete path.
export function cellsToCommitOnAccept(
  outcomeGrid: ScenarioGridCell[],
  savedGrid: Map<string, string>,
): CommitCell[] {
  return outcomeGrid
    .filter((c) => savedGrid.get(keyOf(c.staffId, c.date)) !== c.shiftTypeId)
    .map((c) => ({ staffId: c.staffId, date: c.date, shiftTypeId: c.shiftTypeId }));
}

// Ripple RADIUS as a 0-based ring (the "minimal freeing" ladder, #248 Option 4):
//   0 = free nothing extra (only the user's explicit frees apply)
//   1 = same-date cells (the touched day)         — was scope "day"
//   2 = pay-periods overlapping a touched date     — was scope "pp"
//   3 = the whole displayed range                  — was scope "range"
// The chosen `scope` is the CEILING; `applyScenarioExpanding` starts at ring 0 and
// widens one ring at a time only when the smaller set can't restore coverage.
const SCOPE_RING: Record<"day" | "pp" | "range", number> = { day: 1, pp: 2, range: 3 };

// Which baseline cells an Auto-generate edit may free for the engine to re-solve at
// a given ripple `ring`. `pinned`/`touchedDates` are keyed/dated by the user's
// accumulated edits this session.
//
// CRITICAL guard: with NO touched dates (or ring 0) there is no discretionary set to
// free — return NOTHING. Without this, the widest ring (inRing ≡ true) would free +
// re-solve the WHOLE grid on a bare scope switch, and the seed-0 re-solve diverges
// from the enter-time fill, lighting up phantom ripple on cells the user never
// touched. (Smaller rings already free nothing when no date is touched.)
export function freesForRing(
  input: AutoScheduleInput,
  pinned: { has(key: string): boolean },
  touchedDates: ReadonlySet<string>,
  ring: number,
): ScenarioFree[] {
  if (ring <= 0 || touchedDates.size === 0) return [];
  const ppRanges = ring === 2
    ? input.payPeriods.filter((pp) => [...touchedDates].some((t) => pp.startDate <= t && t <= pp.endDate))
    : [];
  const inRing = (date: string): boolean => {
    if (ring >= 3) return true;
    if (ring === 1) return touchedDates.has(date);
    return ppRanges.some((pp) => pp.startDate <= date && date <= pp.endDate);
  };
  const frees: ScenarioFree[] = [];
  for (const a of input.existingAssignments) {
    const k = keyOf(a.staffId, a.date);
    // Never free a hand-placed cell: the engine compensates by reshuffling its
    // own discretionary fills, not by undoing the user's manual assignments.
    if (a.source === "manual") continue;
    if (!a.isLocked && !pinned.has(k) && inRing(a.date)) frees.push({ staffId: a.staffId, date: a.date });
  }
  return frees;
}

// Back-compat shim: the full-scope free set (the whole ring for `scope`). Kept for
// callers/tests that want the un-expanded behavior; the Live UI now goes through
// `applyScenarioExpanding`.
export function freesForScope(
  input: AutoScheduleInput,
  pinned: { has(key: string): boolean },
  touchedDates: ReadonlySet<string>,
  scope: "day" | "pp" | "range",
): ScenarioFree[] {
  return freesForRing(input, pinned, touchedDates, SCOPE_RING[scope]);
}

// Expanding (minimal-perturbation) re-solve — #248 Option 4. Instead of freeing the
// whole scope at once, free the user's explicit frees plus an ever-widening ring of
// discretionary cells, stopping at the SMALLEST ring that doesn't introduce a new
// HARD breach (unmet coverage / hard min-max) beyond the baseline. The user's chosen
// `scope` is the ceiling. Result: an edit ripples only as far as it must to stay
// feasible, not as far as the scope allows.
//
// Feasibility is gauged ONLY on raw COVERAGE shortfall — not soft tiers (PP-hours /
// fairness), whose deltas ARE the gratuitous churn we're suppressing, and not
// `hardBreaches`, which sanctions away a gap blocked by a locked survivor (and in a
// re-solve every un-freed cell is locked, so ring 0 would always look "fine"). The
// raw `coverageShortfall` sees the hole an overwrite opens; widening frees a body the
// engine can backfill it with. A hard-illegal pin (applied === false) snaps back
// immediately and never widens.
export function applyScenarioExpanding(
  input: AutoScheduleInput,
  pins: ScenarioPin[],
  explicitFrees: ScenarioFree[],
  touchedDates: ReadonlySet<string>,
  pinned: { has(key: string): boolean },
  scope: "day" | "pp" | "range",
): ScenarioOutcome {
  const ceiling = SCOPE_RING[scope];
  // The locked-baseline coverage shortfall is the reference: only widen for a gap the
  // EDIT opened, never for one the baseline already had. (applyScenario also grades the
  // baseline internally for qualityDelta; we grade it once here so each ring can be
  // compared without widening applyScenario's return shape.)
  const baselineShortfall = autoSchedule({
    ...input,
    existingAssignments: input.existingAssignments.map((a) => ({ ...a, isLocked: true })),
  }).quality.breakdown.coverageShortfall;

  let outcome: ScenarioOutcome | null = null;
  for (let ring = 0; ring <= ceiling; ring++) {
    const frees = [...explicitFrees, ...freesForRing(input, pinned, touchedDates, ring)];
    outcome = applyScenario(input, pins, frees);
    // Hard-illegal pin: nothing to widen — snap back with the rejection.
    if (!outcome.applied) return outcome;
    // Smallest ring that doesn't leave the edit's coverage worse than baseline.
    if (outcome.result.quality.breakdown.coverageShortfall - baselineShortfall <= 0) return outcome;
  }
  // Ceiling reached and still short of baseline coverage — return the widest attempt
  // (its warnings drive the UI's breach flags).
  return outcome!;
}
