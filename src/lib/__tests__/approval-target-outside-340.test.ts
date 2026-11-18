import { describe, it, expect } from "vitest";
import { decideApproval, type ApprovalRequest, type ContextCell } from "../request-approval-outcome";
import type { AutoScheduleInput, ScheduleStaff } from "../auto-scheduler";
import type { ShiftMinTarget } from "../shift-eligibility";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

// Card #340: approving a request checks the person's hard count targets against cells OUTSIDE
// the stored pay-period list too (the same as the engine since card #339). The server already
// loads those cells as fixed context; pay-period windows must index them, anchored at the
// stored first period.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const staff = (id: string, initials: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials, ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off", "st-orc"],
  availabilityRules: [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })),
  isActive: true, isAutoScheduled: true, specialQualifications: [], ...o,
});
const shift = (id: string, code: string, o: Partial<TestShift> = {}): TestShift => ({
  id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0, countsTowardFte: true,
  countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false, sortOrder: 0, schedulePriority: null,
  weekendPaired: false, holidayWeekendPaired: false, ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
});
const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = shift("st-or", "OR", { schedulePriority: 1, isFillShift: true });
const ORC = shift("st-orc", "ORC", { maxPerDay: 1 });

const MON = "2025-05-12";
const DATES = [MON, "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];

function input(targets: ShiftMinTarget[], existing: AutoScheduleInput["existingAssignments"] = []): AutoScheduleInput {
  return withDayCaps({
    dates: DATES,
    staff: [staff("p1", "AB", { shiftMinimumTargets: targets }), staff("p2", "CD")],
    shiftTypes: [OR, OFF, ORC],
    existingAssignments: existing,
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [], staffingRequirements: [],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
    equityFactors: [], followRules: [],
  });
}
const req = (kind: ApprovalRequest["kind"], shiftTypeIds: string[] = []): ApprovalRequest =>
  ({ id: "r1", staffId: "p1", kind, shiftTypeIds, leaveShiftTypeId: null, startDate: MON, endDate: MON, strength: "hard" });
const ctx = (date: string): ContextCell[] => [{ staffId: "p1", date, shiftTypeId: "st-orc", isLocked: false, source: "manual" }];
const perPPs = (n: number, minCount: number, maxCount: number | null): ShiftMinTarget =>
  ({ shiftTypeId: "st-orc", minCount, maxCount, window: "pay_period", windowCount: n, strength: "rule" });
const perYear = (maxCount: number): ShiftMinTarget =>
  ({ shiftTypeId: "st-orc", minCount: 0, maxCount, window: "month", windowCount: 12, strength: "rule" });

describe("card #340: approval checks count the person's cells outside the stored pay periods", () => {
  it("'at most 1 per 12 months': an ORC already in next February blocks approving one in May", () => {
    expect(decideApproval(input([perYear(1)]), req("REQUEST_SHIFT", ["st-orc"]), "st-orc", "resolve-pp", []).ok).toBe(true);
    const d = decideApproval(input([perYear(1)]), req("REQUEST_SHIFT", ["st-orc"]), "st-orc", "resolve-pp", ctx("2026-02-10"));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("AB would be over their ORC maximum");
  });

  it("'at most 1 per 2 pay periods': an ORC in the next, unstored pay period blocks approval", () => {
    const d = decideApproval(input([perPPs(2, 0, 1)]), req("REQUEST_SHIFT", ["st-orc"]), "st-orc", "resolve-pp", ctx("2025-05-27"));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("AB would be over their ORC maximum");
  });

  it("'at most 1 per 2 pay periods': an ORC in the previous, unstored pay period blocks approval", () => {
    const d = decideApproval(input([perPPs(2, 0, 1)]), req("REQUEST_SHIFT", ["st-orc"]), "st-orc", "resolve-pp", ctx("2025-05-05"));
    expect(d.ok).toBe(false);
  });

  it("'at most 1 per 2 pay periods': an ORC two pay periods later does not block", () => {
    const d = decideApproval(input([perPPs(2, 0, 1)]), req("REQUEST_SHIFT", ["st-orc"]), "st-orc", "resolve-pp", ctx("2025-06-10"));
    expect(d.ok, d.ok ? "" : d.reason).toBe(true);
  });

  it("'at least 1 per 2 pay periods': an ORC in the next, unstored period keeps the block met when May's goes", () => {
    const existing = [{ staffId: "p1", date: MON, shiftTypeId: "st-orc", code: "ORC", isLocked: false, source: "auto" }];
    // Control: nothing else in the block, so giving AB Monday off would leave the block short.
    const control = decideApproval(input([perPPs(2, 1, null)], existing), req("OFF"), "st-off", "resolve-day", []);
    expect(control.ok).toBe(false);
    const d = decideApproval(input([perPPs(2, 1, null)], existing), req("OFF"), "st-off", "resolve-day", ctx("2025-05-27"));
    expect(d.ok, d.ok ? "" : d.reason).toBe(true);
  });
});
