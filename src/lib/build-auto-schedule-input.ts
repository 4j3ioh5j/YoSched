// Builds the full AutoScheduleInput bundle from the database for a date range.
//
// Extracted from the POST /api/auto-schedule route (#231 S1b) so the SAME input
// the generator runs on can also be served to the browser (GET .../inputs) for
// Live mode's client-side what-if re-solves. Server-only (imports prisma); the
// returned value is plain JSON-serializable data (dates are "YYYY-MM-DD").

import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPayPeriods } from "@/lib/pay-periods-server";
import { type AutoScheduleInput } from "@/lib/auto-scheduler";
import { effectiveFte, effectiveFixedHours } from "@/lib/fte";
import { parsePendingRequestMode, parseRequestConflictPolicy, parseOffStrategyOrder, type ScheduleRequestData } from "@/lib/schedule-requests";
import { effectiveTargetsForStaff, type DepartmentShiftTarget } from "@/lib/department-targets";
import { parseHoursPolicy } from "@/lib/autogen-hours-policy";
import { parseShiftShareBasis } from "@/lib/shift-share";
import { parseHolidayPolicy } from "@/lib/holiday-policy";
import { parseLeavePolicy } from "@/lib/leave-policy";
import { deriveEquityFactorCodes } from "@/lib/equity-factors";
import { payPeriodsCovering } from "@/lib/shift-balance";

/**
 * Assemble the engine input for [startDate, endDate], expanded outward to cover
 * any pay period that overlaps the range (so per-PP math sees whole periods).
 */
/** The reads this builder performs: the global client, or an interactive transaction so a caller that
 *  holds the day locks (request approval, card #67) sees one consistent snapshot under them. */
export type InputReadClient = PrismaClient | Prisma.TransactionClient;
export type PayPeriodLike = { startDate: Date; endDate: Date; targetHours: number };

/** [effectiveStart, effectiveEnd]: the requested range widened to whole overlapping pay periods —
 *  the range the engine input covers. Exported so a caller can lock exactly that range first. */
export function coveringRange(payPeriods: readonly PayPeriodLike[], startDate: string, endDate: string): { effectiveStart: string; effectiveEnd: string } {
  const overlappingPPs = payPeriods.filter((pp) => {
    const ppStart = pp.startDate.toISOString().split("T")[0];
    const ppEnd = pp.endDate.toISOString().split("T")[0];
    return ppEnd >= startDate && ppStart <= endDate;
  });

  const effectiveStart = overlappingPPs.length > 0
    ? overlappingPPs.reduce((min, pp) => {
        const s = pp.startDate.toISOString().split("T")[0];
        return s < min ? s : min;
      }, startDate)
    : startDate;
  const effectiveEnd = overlappingPPs.length > 0
    ? overlappingPPs.reduce((max, pp) => {
        const e = pp.endDate.toISOString().split("T")[0];
        return e > max ? e : max;
      }, endDate)
    : endDate;
  return { effectiveStart, effectiveEnd };
}

// Card #174: a month's run (runMonth "YYYY-MM") never writes before the month's 1st;
// earlier dates are read-only context. The engine enforces it via writableFrom.
export function writableFromOf(runMonth: string): string {
  return `${runMonth}-01`;
}

// Card #174: the forward spill an EARLIER month's run left in this month (unlocked
// auto cells stamped with an earlier autoMonth, dated on/after the month's 1st) is
// this run's to redo, so it is left out of the engine's fixed context. Manual,
// imported, request and locked rows, rows of this or a later run, anything before
// the month's 1st, and the cells of staff this run will not schedule (inactive or
// no longer auto-scheduled: the run would never redo them, yet their saved shift
// still counts toward the day's caps) stay fixed.
export function isPriorRunSpill(
  row: { date: string; isLocked: boolean; source: string | null; autoMonth: string | null },
  runMonth: string,
  staffIsScheduled = true,
): boolean {
  return (
    staffIsScheduled &&
    row.source === "auto" &&
    !row.isLocked &&
    row.autoMonth !== null &&
    row.autoMonth < runMonth &&
    row.date >= writableFromOf(runMonth)
  );
}

export async function buildAutoScheduleInput(
  startDate: string,
  endDate: string,
  opts: { client?: InputReadClient; payPeriods?: readonly PayPeriodLike[]; runMonth?: string } = {},
): Promise<AutoScheduleInput> {
  // Every table read goes through `db`; the pay periods come from the caller when it already read
  // them under its own locks (getPayPeriods may regenerate rows in a transaction of its own, so it
  // is never called inside another transaction).
  const db = opts.client ?? prisma;
  const allPayPeriods = opts.payPeriods ?? (await getPayPeriods());
  const { effectiveStart, effectiveEnd } = coveringRange(allPayPeriods, startDate, endDate);

  const [
    staff,
    shiftTypes,
    existingAssignments,
    holidays,
    desirabilityWeights,
    standingCommitments,
    staffOverrides,
    historicalAssignments,
    staffingRequirements,
    schedulingPrefsRow,
    staffEligibleShifts,
    availabilityRules,
    equityFactors,
    followRules,
    shiftEligibilityRules,
    shiftMinimumTargets,
    departmentTargets,
    scheduleRequests,
    requiredFollowers,
    autoGenFactors,
    followAvoids,
  ] = await Promise.all([
    db.staff.findMany({ where: { isActive: true }, include: { employmentType: true } }),
    db.shiftType.findMany(),
    db.assignment.findMany({
      where: {
        date: {
          gte: new Date(effectiveStart + "T00:00:00Z"),
          lte: new Date(effectiveEnd + "T00:00:00Z"),
        },
      },
    }),
    db.holiday.findMany(),
    db.desirabilityWeight.findMany(),
    db.standingCommitment.findMany(),
    db.staffShiftOverride.findMany(),
    db.assignment.findMany({
      where: {
        date: { lt: new Date(effectiveStart + "T00:00:00Z") },
      },
    }),
    db.staffingRequirement.findMany({ orderBy: [{ shiftTypeId: "asc" }, { dayKey: "asc" }] }),
    db.schedulingPreferences.findFirst(),
    db.staffEligibleShift.findMany(),
    db.availabilityRule.findMany(),
    db.equityFactor.findMany({ orderBy: { sortOrder: "asc" } }),
    db.shiftFollowRule.findMany(),
    db.shiftEligibilityRule.findMany(),
    db.shiftMinimumTarget.findMany(),
    db.departmentShiftTarget.findMany(),
    // Approved + pending requests overlapping the (effective) scheduling window.
    // Overlap = req.startDate <= windowEnd AND req.endDate >= windowStart. We always
    // load pending too; the scheduler's `pendingRequestMode` decides whether pending
    // requests exert force (and at what strength) — in "off" mode they're ignored.
    db.scheduleRequest.findMany({
      where: {
        status: { in: ["approved", "pending"] },
        startDate: { lte: new Date(effectiveEnd + "T00:00:00Z") },
        endDate: { gte: new Date(effectiveStart + "T00:00:00Z") },
      },
    }),
    db.requiredFollower.findMany(),
    db.autoGenFactor.findMany({ orderBy: { sortOrder: "asc" } }),
    db.shiftFollowAvoid.findMany(), // card #177: soft "avoid B after A"
  ]);

  const payPeriods = allPayPeriods;

  // Card #203: read-only context for "Keep counts even across months" and the spacing check.
  const isoDay = (d: Date): string => d.toISOString().split("T")[0];
  const balanceFrom = schedulingPrefsRow?.shiftBalanceFrom ? isoDay(schedulingPrefsRow.shiftBalanceFrom) : null;
  const evenOn = !!balanceFrom && shiftTypes.some((st) => st.evenAcrossMonths);
  const spreadOn = shiftTypes.some((st) => st.spreadOverMonth);
  const contextEnd = new Date(effectiveEnd + "T00:00:00Z");
  contextEnd.setUTCDate(contextEnd.getUTCDate() + 14);
  const [balanceRequestRows, spreadContextRows] = await Promise.all([
    evenOn
      ? db.scheduleRequest.findMany({
          where: {
            status: "approved",
            startDate: { lte: new Date(effectiveEnd + "T00:00:00Z") },
            endDate: { gte: new Date(balanceFrom + "T00:00:00Z") },
          },
        })
      : Promise.resolve([] as typeof scheduleRequests),
    spreadOn
      ? db.assignment.findMany({
          where: { date: { gt: new Date(effectiveEnd + "T00:00:00Z"), lte: contextEnd } },
        })
      : Promise.resolve([] as typeof existingAssignments),
  ]);

  const start = new Date(effectiveStart + "T12:00:00");
  const end = new Date(effectiveEnd + "T12:00:00");
  const dates: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }

  // Card #179: only staff this run schedules (active — the query — and auto-scheduled).
  const scheduledStaffIds = new Set(staff.filter((p) => p.isAutoScheduled).map((p) => p.id));
  // ONE shift snapshot for the whole input: every code below (assignments, staffing
  // requirements, equity factors) is derived from this list, never from a per-row join,
  // so a shift renamed between two queries cannot appear under two codes in one run.
  const shiftCodeMap = new Map<string, string>();
  for (const st of shiftTypes) shiftCodeMap.set(st.id, st.code);

  // Department defaults only reach a staffer when the shift is auto-schedulable.
  // If a shift isn't auto-schedulable, its department target is a no-op for
  // everyone; combined with per-staff eligibility below, a dept default only
  // affects people for whom that shift is actually auto-scheduled.
  const autoSchedulableShiftIds = new Set(shiftTypes.filter((st) => st.autoSchedulable).map((st) => st.id));

  const eligibilityMap = new Map<string, string[]>();
  for (const pes of staffEligibleShifts) {
    if (!eligibilityMap.has(pes.staffId)) {
      eligibilityMap.set(pes.staffId, []);
    }
    eligibilityMap.get(pes.staffId)!.push(pes.shiftTypeId);
  }

  // Card #75: a (staff, shift) pair with NO eligibility row is inert. Unticking someone for a
  // shift keeps their rules / minimum targets / standing commitments for it (hidden, so a
  // re-tick brings them back), but nothing here may act on them: an "eligible" rule would
  // otherwise grant the shift and a standing commitment would place it.
  const eligiblePairs = new Set(staffEligibleShifts.map((e) => `${e.staffId}:${e.shiftTypeId}`));
  const hasRow = (r: { staffId: string; shiftTypeId: string }) => eligiblePairs.has(`${r.staffId}:${r.shiftTypeId}`);

  const rulesMap = new Map<string, typeof availabilityRules>();
  for (const ar of availabilityRules) {
    if (!rulesMap.has(ar.staffId)) {
      rulesMap.set(ar.staffId, []);
    }
    rulesMap.get(ar.staffId)!.push(ar);
  }

  const eligRulesMap = new Map<string, typeof shiftEligibilityRules>();
  for (const er of shiftEligibilityRules) {
    if (!hasRow(er)) continue;
    if (!eligRulesMap.has(er.staffId)) {
      eligRulesMap.set(er.staffId, []);
    }
    eligRulesMap.get(er.staffId)!.push(er);
  }

  const minTargetsMap = new Map<string, typeof shiftMinimumTargets>();
  for (const mt of shiftMinimumTargets) {
    if (!hasRow(mt)) continue;
    if (!minTargetsMap.has(mt.staffId)) {
      minTargetsMap.set(mt.staffId, []);
    }
    minTargetsMap.get(mt.staffId)!.push(mt);
  }

  // Department-wide "Pay-period preferences": defaults expressed per 1.0 FTE that
  // apply to every staffer, scaled to their FTE and overridden by any per-staff
  // target sharing the same (shift, window, windowCount). Normalize the window
  // union once so the FTE-scaling helper stays typed.
  const deptTargets: DepartmentShiftTarget[] = departmentTargets.map((d) => ({
    shiftTypeId: d.shiftTypeId,
    minCount: d.minCount,
    maxCount: d.maxCount,
    window: d.window as "week" | "pay_period" | "month" | "days",
    windowDays: d.windowDays,
    windowCount: d.windowCount,
    strength: d.strength === "rule" ? "rule" : "preference",
    perFte: d.perFte,
  }));

  return {
    dates,
    staff: staff.map((p) => ({
      id: p.id,
      initials: p.initials,
      // Card #71: 0 for a type without an FTE % (no FTE-based target); fixed hours replace it.
      ftePercentage: effectiveFte(p, p.employmentType) ?? 0,
      fixedHoursPerPp: effectiveFixedHours(p, p.employmentType),
      inFairness: p.employmentType.includedInFairness,
      eligibleShiftTypeIds: eligibilityMap.get(p.id) ?? [],
      availabilityRules: (rulesMap.get(p.id) ?? []).map((ar) => ({
        type: ar.type as "available" | "unavailable",
        strength: ar.strength as "rule" | "preference",
        conditionStaffId: ar.conditionStaffId,
        conditionType: ar.conditionType as "working" | "not_working" | null,
        // WHEN columns — the sole recurrence representation (slice 7).
        whenKind: ar.whenKind,
        whenDays: ar.whenDays,
        whenPpWeek: ar.whenPpWeek,
        whenOrds: ar.whenOrds,
        whenCycleUnit: ar.whenCycleUnit,
        whenCycleN: ar.whenCycleN,
        whenCycleOffset: ar.whenCycleOffset,
      })),
      isActive: p.isActive,
      isAutoScheduled: p.isAutoScheduled,
      specialQualifications: p.specialQualifications,
      // Card #203: joining and tick dates (a person is owed a share only from then on).
      createdOn: p.createdAt ? isoDay(p.createdAt) : null,
      tempStartDate: p.tempStartDate ? isoDay(p.tempStartDate) : null,
      tempEndDate: p.tempEndDate ? isoDay(p.tempEndDate) : null,
      eligibleSince: Object.fromEntries(
        staffEligibleShifts.filter((e) => e.staffId === p.id && e.eligibleSince).map((e) => [e.shiftTypeId, isoDay(e.eligibleSince!)]),
      ),
      shiftEligibilityRules: (eligRulesMap.get(p.id) ?? []).map((er) => ({
        shiftTypeId: er.shiftTypeId,
        type: er.type as "eligible" | "ineligible",
        strength: er.strength as "rule" | "preference",
        whenKind: er.whenKind,
        whenDays: er.whenDays,
        whenPpWeek: er.whenPpWeek,
        whenOrds: er.whenOrds,
        whenCycleUnit: er.whenCycleUnit,
        whenCycleN: er.whenCycleN,
        whenCycleOffset: er.whenCycleOffset,
      })),
      // Per-staff targets merged with FTE-scaled department defaults (staff wins
      // on a key collision). Slice 1 feeds these into the EXISTING min/max
      // machinery in the engine shape; the strength/source carried by
      // effectiveTargetsForStaff is consumed in slice 2 (soft-vs-hard).
      shiftMinimumTargets: effectiveTargetsForStaff(
        (minTargetsMap.get(p.id) ?? []).map((mt) => ({
          shiftTypeId: mt.shiftTypeId,
          minCount: mt.minCount,
          maxCount: mt.maxCount,
          window: mt.window as "week" | "pay_period" | "month" | "days",
          windowDays: mt.windowDays,
          windowCount: mt.windowCount,
          strength: mt.strength === "preference" ? "preference" : "rule",
        })),
        deptTargets,
        effectiveFte(p, p.employmentType) ?? 0,
        // Dept defaults apply only to shifts this staffer is eligible for AND that
        // are auto-schedulable — so ORL targets never touch staff who don't do ORL.
        new Set((eligibilityMap.get(p.id) ?? []).filter((id) => autoSchedulableShiftIds.has(id))),
      ).map((t) => ({
        shiftTypeId: t.shiftTypeId,
        minCount: t.minCount,
        maxCount: t.maxCount,
        window: t.window,
        windowDays: t.windowDays,
        windowCount: t.windowCount,
        // strength drives soft-vs-hard enforcement in the engine: per-staff
        // targets are "rule" (hard), department defaults carry their own strength.
        strength: t.strength,
      })),
    })),
    shiftTypes: shiftTypes.map((st) => ({
      id: st.id,
      code: st.code,
      name: st.name,
      defaultHours: st.defaultHours,
      defaultHoursWeekend: st.defaultHoursWeekend,
      defaultHoursHoliday: st.defaultHoursHoliday,
      countsTowardFte: st.countsTowardFte,
      countsAsHolidayWork: st.countsAsHolidayWork,
      isLeave: st.isLeave,
      isOffShift: st.isOffShift,
      isFillShift: st.isFillShift,
      sortOrder: st.sortOrder,
      schedulePriority: st.schedulePriority,
      weekendPaired: st.weekendPaired,
      holidayWeekendPaired: st.holidayWeekendPaired,
      spreadOverMonth: st.spreadOverMonth,
      evenAcrossMonths: st.evenAcrossMonths,
      ignoresWorkingDays: st.ignoresWorkingDays,
      category: st.category,
      autoSchedulable: st.autoSchedulable,
    })),
    existingAssignments: existingAssignments
      .filter((a) => !opts.runMonth || !isPriorRunSpill(
        { date: a.date.toISOString().split("T")[0], isLocked: a.isLocked, source: a.source, autoMonth: a.autoMonth },
        opts.runMonth,
        scheduledStaffIds.has(a.staffId),
      ))
      .map((a) => ({
        staffId: a.staffId,
        date: a.date.toISOString().split("T")[0],
        shiftTypeId: a.shiftTypeId,
        code: shiftCodeMap.get(a.shiftTypeId) ?? "?",
        isLocked: a.isLocked,
        source: a.source,
      })),
    payPeriods: payPeriods.map((pp) => ({
      startDate: pp.startDate.toISOString().split("T")[0],
      endDate: pp.endDate.toISOString().split("T")[0],
      targetHours: pp.targetHours,
    })),
    holidays: holidays.map((h) => ({
      date: h.date.toISOString().split("T")[0],
    })),
    desirabilityWeights: desirabilityWeights.map((dw) => ({
      shiftTypeId: dw.shiftTypeId,
      dayOfWeek: dw.dayOfWeek,
      weight: dw.weight,
    })),
    standingCommitments: standingCommitments.filter(hasRow).map((sc) => ({
      staffId: sc.staffId,
      shiftTypeId: sc.shiftTypeId,
      whenKind: sc.whenKind,
      whenDays: sc.whenDays,
      whenPpWeek: sc.whenPpWeek,
      whenOrds: sc.whenOrds,
      whenCycleUnit: sc.whenCycleUnit,
      whenCycleN: sc.whenCycleN,
      whenCycleOffset: sc.whenCycleOffset,
    })),
    staffOverrides: staffOverrides.map((po) => ({
      staffId: po.staffId,
      shiftTypeId: po.shiftTypeId,
      durationHrs: po.durationHrs,
      durationHrsWeekday: po.durationHrsWeekday,
      durationHrsWeekend: po.durationHrsWeekend,
      durationHrsHoliday: po.durationHrsHoliday,
    })),
    // Card #204: the hidden day-preference table is retired (favoured days are the staff card's
    // Prefer rules). Always an empty list: a tab still running the old engine iterates it.
    dayPreferences: [],
    historicalAssignments: historicalAssignments.map((a) => ({
      staffId: a.staffId,
      date: a.date.toISOString().split("T")[0],
      shiftTypeId: a.shiftTypeId,
      code: shiftCodeMap.get(a.shiftTypeId) ?? "?",
      isLocked: a.isLocked,
    })),
    // Both keys go over the wire: the engine reads shiftTypeId; a browser tab opened before
    // the id-link deploy still runs the old bundle, which keys minimums and caps by code.
    // The code is the shift's CURRENT one (from shift_types), never the row's compat column.
    staffingRequirements: staffingRequirements.map((sr) => ({
      shiftTypeId: sr.shiftTypeId,
      shiftCode: shiftCodeMap.get(sr.shiftTypeId) ?? "?",
      dayKey: sr.dayKey,
      minCount: sr.minCount,
      preferredCount: sr.preferredCount,
      maxCount: sr.maxCount,
    })),
    schedulingPreferences: {
      prefer3DayWeekends: schedulingPrefsRow?.prefer3DayWeekends ?? true,
      prefer4DayWeekends: schedulingPrefsRow?.prefer4DayWeekends ?? true,
      preferSequentialOff: schedulingPrefsRow?.preferSequentialOff ?? true,
      sequentialOffWeight: schedulingPrefsRow?.sequentialOffWeight ?? 2,
      threeDayWeekendWeight: schedulingPrefsRow?.threeDayWeekendWeight ?? 5,
      fourDayWeekendWeight: schedulingPrefsRow?.fourDayWeekendWeight ?? 8,
      // Lenient parse: a missing/legacy/corrupt stored value falls back to the default.
      pendingRequestMode: parsePendingRequestMode(schedulingPrefsRow?.pendingRequestMode),
      maxLeavePerDay: schedulingPrefsRow?.maxLeavePerDay ?? 0,
      requestConflictPolicy: parseRequestConflictPolicy(schedulingPrefsRow?.requestConflictPolicy),
      shiftShareBasis: parseShiftShareBasis(schedulingPrefsRow?.shiftShareBasis),
      holidayPolicy: parseHolidayPolicy(schedulingPrefsRow?.holidayPolicy),
      leaveHoursPolicy: parseLeavePolicy(schedulingPrefsRow?.leaveHoursPolicy),
      shiftBalanceFrom: balanceFrom,
    },
    // Linked by shift id; the code the fairness pass keys on is the shift's CURRENT one.
    equityFactors: deriveEquityFactorCodes(
      equityFactors.map((f) => ({ factorType: f.factorType, shiftTypeId: f.shiftTypeId, weight: f.weight, enabled: f.enabled })),
      shiftTypes,
    ),
    followRules: followRules.map((r) => ({
      sourceShiftId: r.sourceShiftId,
      allowedShiftId: r.allowedShiftId,
      allowOffShifts: r.allowOffShifts,
      mode: r.mode,
    })),
    followAvoids: followAvoids.map((r) => ({ sourceShiftId: r.sourceShiftId, avoidShiftId: r.avoidShiftId })),
    scheduleRequests: scheduleRequests.map((r) => ({
      id: r.id,
      staffId: r.staffId,
      startDate: r.startDate.toISOString().split("T")[0],
      endDate: r.endDate.toISOString().split("T")[0],
      kind: r.kind as ScheduleRequestData["kind"],
      shiftTypeIds: r.shiftTypeIds,
      leaveShiftTypeId: r.leaveShiftTypeId,
      strength: r.strength as ScheduleRequestData["strength"],
      status: r.status as ScheduleRequestData["status"],
      autoApproved: r.autoApproved,
      receivedAt: r.receivedAt ? r.receivedAt.toISOString() : null,
      // Lenient parse: drops unknown/dup tokens (stale leave shifts can't be re-checked
      // here without the eligibility set, but the engine only acts on known tokens).
      offStrategyOrder: parseOffStrategyOrder(r.offStrategyOrder),
    })),
    requiredFollowers: requiredFollowers.map((r) => ({
      sourceShiftId: r.sourceShiftId,
      followerShiftId: r.followerShiftId,
      scope: r.scope,
      countsTowardTargets: r.countsTowardTargets,
    })),
    factorOrder: autoGenFactors.map((f) => ({
      key: f.key,
      sortOrder: f.sortOrder,
      enabled: f.enabled,
      hoursPolicy: parseHoursPolicy(f.hoursPolicy),
    })),
    ...(opts.runMonth ? { writableFrom: writableFromOf(opts.runMonth) } : {}),
    ...(evenOn
      ? {
          balanceRequests: balanceRequestRows.map((r) => ({
            id: r.id,
            staffId: r.staffId,
            startDate: isoDay(r.startDate),
            endDate: isoDay(r.endDate),
            kind: r.kind as ScheduleRequestData["kind"],
            shiftTypeIds: r.shiftTypeIds,
            leaveShiftTypeId: r.leaveShiftTypeId,
            strength: r.strength as ScheduleRequestData["strength"],
            status: r.status as ScheduleRequestData["status"],
          })),
          // The stored list rolls forward and drops old periods; extend it back to the start date
          // so earlier months keep their roster check (else worked counts lose their expected share).
          balancePayPeriods: payPeriodsCovering(
            allPayPeriods.map((pp) => ({ startDate: isoDay(pp.startDate), endDate: isoDay(pp.endDate) })),
            balanceFrom!,
            schedulingPrefsRow?.payPeriodLengthDays ?? 14,
          ).filter((pp) => pp.endDate >= balanceFrom! && pp.startDate <= effectiveEnd),
        }
      : {}),
    ...(spreadOn
      ? {
          spreadContext: spreadContextRows.map((a) => ({
            staffId: a.staffId,
            date: isoDay(a.date),
            shiftTypeId: a.shiftTypeId,
            code: shiftCodeMap.get(a.shiftTypeId) ?? "?",
            isLocked: a.isLocked,
            source: a.source,
          })),
        }
      : {}),
  };
}
