import type { ShiftMinTarget } from "./shift-eligibility";

// Department-wide shift count target ("Pay-period preferences"). Same min/max +
// window shape as a per-staff ShiftMinTarget, plus a strength (soft vs hard) and
// a perFte flag. When perFte is true the counts are expressed per 1.0 FTE and get
// scaled to each staff member's ftePercentage before the scheduler consumes them.
export type DepartmentShiftTarget = ShiftMinTarget & {
  strength: "preference" | "rule";
  perFte: boolean;
};

// A per-staff/in-engine target with provenance + strength attached. The window
// shape is identical to ShiftMinTarget so it drops straight into the existing
// min/max machinery; `strength`/`source` are carried for slice 2 (soft-vs-hard
// enforcement) and diagnostics.
export type EffectiveTarget = ShiftMinTarget & {
  strength: "preference" | "rule";
  source: "staff" | "department";
};

// Scale a per-1.0-FTE count to a concrete count for a given FTE, rounding to the
// nearest whole shift. Never negative. e.g. 2 ORL @ 0.8 FTE → round(1.6) = 2.
export function scaleCountToFte(count: number, fte: number): number {
  return Math.max(0, Math.round(count * (Number.isFinite(fte) ? fte : 1)));
}

// Apply FTE scaling to a department target. perFte=false → counts are absolute
// and pass through unchanged. Returns null when scaling collapses the target to
// nothing to enforce (min ≤ 0 and no positive max), so a low-FTE staffer doesn't
// get a meaningless "at least 0" target. Clamps max ≥ min after rounding.
export function scaleDeptTargetToFte(
  t: DepartmentShiftTarget,
  fte: number,
): ShiftMinTarget & { strength: "preference" | "rule" } | null {
  const factor = t.perFte ? fte : 1;
  const minCount = scaleCountToFte(t.minCount, factor);
  let maxCount = t.maxCount == null ? null : scaleCountToFte(t.maxCount, factor);
  if (maxCount != null && maxCount < minCount) maxCount = minCount;
  if (minCount <= 0 && (maxCount == null || maxCount <= 0)) return null;
  return {
    shiftTypeId: t.shiftTypeId,
    minCount,
    maxCount,
    window: t.window,
    windowDays: t.windowDays,
    windowCount: t.windowCount,
    strength: t.strength,
  };
}

// Identity of a target for override matching: a per-staff target and a department
// default that share (shiftType, window, window-amount) are "the same" target, so
// the per-staff one wins. days-windows key on windowDays; fixed windows on
// windowCount (default 1).
function targetKey(t: {
  shiftTypeId: string;
  window: string;
  windowDays?: number | null;
  windowCount?: number | null;
}): string {
  const amount = t.window === "days" ? t.windowDays ?? 7 : t.windowCount ?? 1;
  return `${t.shiftTypeId}|${t.window}|${amount}`;
}

// Merge a staff member's own targets with the FTE-scaled department defaults.
// Per-staff targets take precedence: a department default whose key collides with
// a per-staff target is dropped entirely (the staff override fully replaces it).
// Per-staff targets are tagged strength "rule" (they have no strength column, and
// today's behavior treats them as hard) so existing schedules are unchanged.
//
// `departmentShiftIds` gates which shifts the BROAD department defaults reach: a
// dept default only applies to a staffer when its shift is in this set — i.e. the
// shift is auto-schedulable AND this staffer is eligible for it. Pass undefined to
// skip the gate (all dept defaults apply). Per-staff targets are never gated; an
// admin set them explicitly. This keeps a department-wide "2 ORL / pay period"
// from broadcasting onto staff who don't do ORL, or onto everyone when ORL isn't
// even an auto-schedulable shift.
export function effectiveTargetsForStaff(
  perStaffTargets: ShiftMinTarget[],
  departmentTargets: DepartmentShiftTarget[],
  fte: number,
  departmentShiftIds?: Set<string>,
): EffectiveTarget[] {
  const covered = new Set(perStaffTargets.map(targetKey));
  const result: EffectiveTarget[] = perStaffTargets.map((t) => ({
    ...t,
    strength: "rule",
    source: "staff",
  }));
  for (const d of departmentTargets) {
    if (departmentShiftIds && !departmentShiftIds.has(d.shiftTypeId)) continue;
    if (covered.has(targetKey(d))) continue;
    const scaled = scaleDeptTargetToFte(d, fte);
    if (scaled) result.push({ ...scaled, source: "department" });
  }
  return result;
}
