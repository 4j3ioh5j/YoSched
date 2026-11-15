// Card #220: the Staff page's row for one person, built from the same include everywhere it is
// needed — the page load and the restore after an Undo of a remove — so both give identical rows
// and rule-list versions (card #206: versions come from exactly the rows shown).
import { staffLoginStatus } from "@/lib/staff-login-status";
import { ruleVersionsOf } from "@/lib/staff-rule-versions";
import type { Prisma } from "@/generated/prisma/client";

export const STAFF_PAGE_INCLUDE = {
  employmentType: true, eligibleShifts: true, availabilityRules: true, shiftEligibilityRules: true, shiftMinimumTargets: true, standingCommitments: true, shiftOverrides: true,
  loginUser: { select: { id: true, isActive: true, email: true, passwordHash: true } },
} satisfies Prisma.StaffInclude;

export type StaffPageRow = Prisma.StaffGetPayload<{ include: typeof STAFF_PAGE_INCLUDE }>;

export function toClientStaff(p: StaffPageRow) {
  return {
    id: p.id,
    name: p.name,
    loginStatus: staffLoginStatus(p.loginUser),
    loginUserId: p.loginUser?.id ?? null,
    initials: p.initials,
    employmentTypeId: p.employmentTypeId,
    employmentTypeName: p.employmentType.name,
    // Card #71: the stored value; the page shows it only when the type has an FTE %.
    ftePercentage: p.ftePercentage ?? p.employmentType.defaultFtePercentage,
    fixedHoursPerPp: p.fixedHoursPerPp,
    availabilityRules: p.availabilityRules.map((ar) => ({
      type: ar.type,
      strength: ar.strength,
      conditionStaffId: ar.conditionStaffId,
      conditionType: ar.conditionType,
      whenKind: ar.whenKind,
      whenDays: ar.whenDays,
      whenPpWeek: ar.whenPpWeek,
      whenOrds: ar.whenOrds,
      whenCycleUnit: ar.whenCycleUnit,
      whenCycleN: ar.whenCycleN,
      whenCycleOffset: ar.whenCycleOffset,
    })),
    eligibleShiftTypeIds: p.eligibleShifts.map((es) => es.shiftTypeId),
    shiftEligibilityRules: p.shiftEligibilityRules.map((er) => ({
      shiftTypeId: er.shiftTypeId,
      type: er.type,
      strength: er.strength,
      whenKind: er.whenKind,
      whenDays: er.whenDays,
      whenPpWeek: er.whenPpWeek,
      whenOrds: er.whenOrds,
      whenCycleUnit: er.whenCycleUnit,
      whenCycleN: er.whenCycleN,
      whenCycleOffset: er.whenCycleOffset,
    })),
    shiftMinimumTargets: p.shiftMinimumTargets.map((mt) => ({
      shiftTypeId: mt.shiftTypeId,
      minCount: mt.minCount,
      maxCount: mt.maxCount,
      window: mt.window,
      windowDays: mt.windowDays,
      windowCount: mt.windowCount,
      strength: mt.strength,
    })),
    standingCommitments: p.standingCommitments.map((sc) => ({
      shiftTypeId: sc.shiftTypeId,
      notes: sc.notes,
      whenKind: sc.whenKind,
      whenDays: sc.whenDays,
      whenPpWeek: sc.whenPpWeek,
      whenOrds: sc.whenOrds,
      whenCycleUnit: sc.whenCycleUnit,
      whenCycleN: sc.whenCycleN,
      whenCycleOffset: sc.whenCycleOffset,
    })),
    shiftOverrides: p.shiftOverrides.map((o) => ({
      shiftTypeId: o.shiftTypeId,
      durationHrs: o.durationHrs,
      durationHrsWeekday: o.durationHrsWeekday,
      durationHrsWeekend: o.durationHrsWeekend,
      durationHrsHoliday: o.durationHrsHoliday,
    })),
    // Card #206: each rule list's version, from the same rows as the lists above.
    ruleVersions: ruleVersionsOf(p),
    specialQualifications: p.specialQualifications,
    isActive: p.isActive,
    isAutoScheduled: p.isAutoScheduled,
    sortOrder: p.sortOrder,
  };
}
