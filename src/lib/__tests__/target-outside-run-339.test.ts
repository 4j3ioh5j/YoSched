import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";
import type { ShiftMinTarget } from "../shift-eligibility";

// Card #339 (David): a person's count target ("exactly 2 CALL per 12 months") must see the
// person's cells OUTSIDE the run. A CALL weekend hand-entered in June means building an
// earlier month gives them none; one earlier in the year (history) counts the same way.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const staff = (id: string, initials: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials, ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off", "st-call"],
  availabilityRules: avail([1, 2, 3, 4, 5]),
  isActive: true, isAutoScheduled: true, specialQualifications: [], ...o,
});
const shift = (id: string, code: string, o: Partial<TestShift> = {}): TestShift => ({
  id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
  countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
  sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
  ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
});
const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = shift("st-or", "OR", { schedulePriority: 30, isFillShift: true });
const CALL = shift("st-call", "CALL", { schedulePriority: 10 });

// The run: one pay period in May 2025 (Sun 05-11 .. Sat 05-24).
const W1 = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
const W2 = ["2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const PP = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };

const perYear = (minCount: number, maxCount: number | null): ShiftMinTarget =>
  ({ shiftTypeId: "st-call", minCount, maxCount, window: "month", windowCount: 12, strength: "rule" });
const cell = (staffId: string, date: string): ScheduleAssignment =>
  ({ staffId, date, shiftTypeId: "st-call", code: "CALL", isLocked: false, source: "manual" });

function input(o: Partial<AutoScheduleInput> = {}): AutoScheduleInput {
  return withDayCaps({
    dates: [...W1, ...W2],
    staff: [],
    shiftTypes: [OR, OFF, CALL],
    existingAssignments: [],
    payPeriods: [PP],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [], staffingRequirements: [],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
    equityFactors: [], followRules: [],
    ...o,
  });
}
const calls = (r: ReturnType<typeof autoSchedule>, staffId: string) =>
  r.suggestions.filter((s) => s.staffId === staffId && s.shiftTypeId === "st-call").map((s) => s.date);
const needCall = (dayKeys: string[]) =>
  dayKeys.map((dayKey) => ({ shiftTypeId: "st-call", shiftCode: "CALL", dayKey, minCount: 1, preferredCount: 1, maxCount: 1 }));

describe("card #339: count targets see the person's cells outside the run", () => {
  it("control: with nothing outside the run, 'exactly 2 per 12 months' places 2 CALL in May", () => {
    const r = autoSchedule(input({ staff: [staff("ab", "AB", { shiftMinimumTargets: [perYear(2, 2)] })] }));
    expect(calls(r, "ab")).toHaveLength(2);
  });

  it("a CALL weekend already in June (after the run): May gets none and no shortfall warning", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB", { shiftMinimumTargets: [perYear(2, 2)] })],
      targetContext: [cell("ab", "2025-06-14"), cell("ab", "2025-06-15")],
    }));
    expect(calls(r, "ab")).toEqual([]);
    expect(r.warnings.filter((w) => w.startsWith("AB:") && w.includes("CALL"))).toEqual([]);
  });

  it("one CALL already in June: May gets exactly one more (the minimum counts it, the cap allows one)", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB", { shiftMinimumTargets: [perYear(2, 2)] })],
      targetContext: [cell("ab", "2025-06-14")],
    }));
    expect(calls(r, "ab")).toHaveLength(1);
  });

  it("a CALL weekend earlier in the year (history): May gets none", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB", { shiftMinimumTargets: [perYear(2, 2)] })],
      historicalAssignments: [cell("ab", "2025-01-11"), cell("ab", "2025-01-12")],
    }));
    expect(calls(r, "ab")).toEqual([]);
    expect(r.warnings.filter((w) => w.startsWith("AB:") && w.includes("CALL"))).toEqual([]);
  });

  it("the cap counts a later cell: a needed CALL goes to someone else, not the capped person", () => {
    const people = [staff("ab", "AB", { shiftMinimumTargets: [perYear(0, 1)] }), staff("cd", "CD")];
    const control = autoSchedule(input({ staff: people, staffingRequirements: needCall(["2"]) }));
    expect(calls(control, "ab").length).toBeGreaterThan(0); // AB (listed first) takes one without the June cell
    const r = autoSchedule(input({ staff: people, staffingRequirements: needCall(["2"]), targetContext: [cell("ab", "2025-11-01")] }));
    expect(calls(r, "ab")).toEqual([]);
    expect(calls(r, "cd")).toHaveLength(2);
  });

  it("the cap counts history: a CALL last August blocks May under 'at most 1 per 12 months'", () => {
    const people = [staff("ab", "AB", { shiftMinimumTargets: [perYear(0, 1)] }), staff("cd", "CD")];
    const r = autoSchedule(input({ staff: people, staffingRequirements: needCall(["2"]), historicalAssignments: [cell("ab", "2024-08-10")] }));
    expect(calls(r, "ab")).toEqual([]);
    // ...but one from more than 12 months back does not.
    const old = autoSchedule(input({ staff: people, staffingRequirements: needCall(["2"]), historicalAssignments: [cell("ab", "2024-04-10")] }));
    expect(calls(old, "ab").length).toBeGreaterThan(0);
  });

  it("a cell outside the run on a date the grid also holds never counts twice", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB", { shiftMinimumTargets: [perYear(2, 2)] })],
      existingAssignments: [cell("ab", W1[0])],
      targetContext: [cell("ab", W1[0])],
    }));
    expect(calls(r, "ab")).toHaveLength(1); // W1[0] (existing) + one placed
  });
});

// Pay-period windows past either end of the stored pay-period list (Codex #1591): the engine
// extends the list for count targets and keeps the blocks anchored at the stored first period.
describe("card #339: pay-period targets see cells beyond the stored pay periods", () => {
  const perPPs = (n: number, minCount: number, maxCount: number | null): ShiftMinTarget =>
    ({ shiftTypeId: "st-call", minCount, maxCount, window: "pay_period", windowCount: n, strength: "rule" });
  const people = () => [staff("ab", "AB", { shiftMinimumTargets: [perPPs(2, 0, 1)] }), staff("cd", "CD")];

  it("'at most 1 per 2 pay periods': a CALL in the next, unstored pay period blocks May", () => {
    const control = autoSchedule(input({ staff: people(), staffingRequirements: needCall(["2"]) }));
    expect(calls(control, "ab").length).toBeGreaterThan(0);
    const r = autoSchedule(input({ staff: people(), staffingRequirements: needCall(["2"]), targetContext: [cell("ab", "2025-05-27")] }));
    expect(calls(r, "ab")).toEqual([]);
    expect(calls(r, "cd")).toHaveLength(2);
  });

  it("'at most 1 per 2 pay periods': a CALL in the previous, unstored pay period blocks May", () => {
    const r = autoSchedule(input({ staff: people(), staffingRequirements: needCall(["2"]), historicalAssignments: [cell("ab", "2025-05-05")] }));
    expect(calls(r, "ab")).toEqual([]);
  });

  it("'at most 1 per 2 pay periods': a CALL two pay periods later does not block May", () => {
    const r = autoSchedule(input({ staff: people(), staffingRequirements: needCall(["2"]), targetContext: [cell("ab", "2025-06-10")] }));
    expect(calls(r, "ab").length).toBeGreaterThan(0);
  });

  it("'at least 1 per 2 pay periods': the block runs past the stored list, so a CALL there meets it", () => {
    const one = [staff("ab", "AB", { shiftMinimumTargets: [perPPs(2, 1, null)] })];
    expect(calls(autoSchedule(input({ staff: one })), "ab")).toHaveLength(1);
    // The block is May + the next period (anchored at the stored first period, May).
    const r = autoSchedule(input({ staff: one, targetContext: [cell("ab", "2025-05-27")] }));
    expect(calls(r, "ab")).toEqual([]);
    expect(r.warnings.filter((w) => w.startsWith("AB:") && w.includes("CALL"))).toEqual([]);
  });

  it("'at least 1 per 2 pay periods': blocks stay anchored at the stored first period", () => {
    // The previous period (Apr 27..May 10) is in the block before May's, so its CALL does not count.
    const one = [staff("ab", "AB", { shiftMinimumTargets: [perPPs(2, 1, null)] })];
    const r = autoSchedule(input({ staff: one, historicalAssignments: [cell("ab", "2025-05-05")] }));
    expect(calls(r, "ab")).toHaveLength(1);
  });
});

describe("card #339: how far past the run the input reads for count targets", () => {
  it("covers N windows of each kind, the longest target wins, and nothing without targets", async () => {
    const { targetReachDays } = await import("../build-auto-schedule-input");
    expect(targetReachDays([{ window: "month", windowCount: 12 }], 14)).toBe(372); // a June CALL from any month of the year
    expect(targetReachDays([{ window: "pay_period", windowCount: 3 }], 14)).toBe(42);
    expect(targetReachDays([{ window: "week", windowCount: 2 }, { window: "days", windowDays: 28 }], 14)).toBe(28);
    expect(targetReachDays([{ window: "days", windowDays: 90 }, { window: "month", windowCount: 1 }], 14)).toBe(90);
    expect(targetReachDays([], 14)).toBe(0);
  });
});
