// Card #71: the engine reads the employment type's settings through the input builder:
// no FTE % → ftePercentage 0 (no target, no fill); fixed hours → an absolute PP target;
// not in fairness → never sways the equity spread used to rank candidates (qFairnessSpread).
import { describe, it, expect } from "vitest";
import { autoSchedule as autoScheduleRaw, targetFor, type ScheduleStaff, type AutoScheduleResult } from "../auto-scheduler";
import { withDayCaps, type TestShift } from "./test-day-caps";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";

const autoSchedule = (input: Parameters<typeof autoScheduleRaw>[0]) => autoScheduleRaw(withDayCaps(input));
const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));

function staff(id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff {
  return {
    id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
    eligibleShiftTypeIds: ["st-or", "st-off"],
    availabilityRules: [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })),
    isActive: true, isAutoScheduled: true, specialQualifications: [],
    ...o,
  };
}
function shift(id: string, code: string, o: Partial<TestShift> = {}): TestShift {
  return {
    id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
    countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
    sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
    ignoresWorkingDays: false, category: "clinical", autoSchedulable: true,
    ...o,
  };
}
const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = shift("st-or", "OR", { schedulePriority: 100, isFillShift: true });
const CALL = shift("st-call", "CALL", { autoSchedulable: false });

// Two weeks of weekdays in one 14-day pay period (Sun 2025-05-11 .. Sat 2025-05-24).
const DATES = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16",
  "2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];

type Existing = { staffId: string; date: string; shiftTypeId: string; code: string; isLocked: boolean; source: string };
function run(people: ScheduleStaff[], existing: Existing[] = [], weights: { shiftTypeId: string; dayOfWeek: number; weight: number }[] = []): AutoScheduleResult {
  return autoSchedule({
    dates: DATES,
    staff: people,
    shiftTypes: [OR, CALL, OFF],
    existingAssignments: existing,
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }],
    holidays: [], desirabilityWeights: weights, standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [],
    staffingRequirements: [],
    schedulingPreferences: {
      prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false,
      sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3,
      pendingRequestMode: "full", requestConflictPolicy: "reconcile",
    },
    equityFactors: [], followRules: [], requiredFollowers: [], scheduleRequests: [],
  });
}
const workHours = (r: AutoScheduleResult, id: string) =>
  r.suggestions.filter((s) => s.staffId === id && s.code === "OR").length * 8;

describe("targetFor", () => {
  it("fixed hours replace the FTE target and are not scaled by the PP's hours", () => {
    expect(targetFor({ ftePercentage: 0, fixedHoursPerPp: 40 }, { targetHours: 72 })).toBe(40);
  });
  it("a type without an FTE % (fte 0) and no fixed hours has no target", () => {
    expect(targetFor({ ftePercentage: 0, fixedHoursPerPp: null }, { targetHours: 80 })).toBe(0);
  });
  it("FTE target unchanged", () => {
    expect(targetFor({ ftePercentage: 0.5, fixedHoursPerPp: null }, { targetHours: 80 })).toBe(40);
  });
});

describe("auto-generate with employment-type settings", () => {
  it("an auto-scheduled person of a type without an FTE % gets no fill", () => {
    const r = run([staff("ft"), staff("nh", { ftePercentage: 0, inFairness: false })]);
    expect(workHours(r, "nh")).toBe(0);
    expect(workHours(r, "ft")).toBe(80);
  });
  it("an auto-scheduled person with fixed hours is filled to exactly their fixed hours", () => {
    const r = run([staff("ft"), staff("fx", { ftePercentage: 0, fixedHoursPerPp: 40, inFairness: false })]);
    expect(workHours(r, "fx")).toBe(40);
    expect(workHours(r, "ft")).toBe(80);
  });
});

describe("qFairnessSpread (candidate ranking) honours the fairness setting", () => {
  // Every weekday is locked for everyone, so the engine places nothing and the finished grid is
  // fixed; the spread then depends only on whose desirability scores are counted.
  const locked = (id: string, code: "OR" | "CALL", days: string[]): Existing[] =>
    days.map((date) => ({ staffId: id, date, shiftTypeId: code === "OR" ? "st-or" : "st-call", code, isLocked: true, source: "manual" }));
  const weights = [1, 2, 3, 4, 5].map((d) => ({ shiftTypeId: "st-call", dayOfWeek: d, weight: -5 }));
  const base: Existing[] = [...locked("a", "OR", DATES), ...locked("b", "OR", DATES.slice(0, 5)), ...locked("b", "CALL", DATES.slice(5))];
  const feeLocked = locked("fee", "CALL", DATES);
  const spread = (r: AutoScheduleResult) => r.quality.breakdown.fairnessSpread;

  it("an excluded person (auto-scheduled, heavy undesirable load) leaves the spread as if absent", () => {
    const absent = run([staff("a"), staff("b")], base, weights);
    const excluded = run([staff("a"), staff("b"), staff("fee", { ftePercentage: 0, inFairness: false })], [...base, ...feeLocked], weights);
    expect(spread(excluded)).toBe(spread(absent));
  });
  it("included, the same person changes the spread (the test can tell the difference)", () => {
    const absent = run([staff("a"), staff("b")], base, weights);
    const included = run([staff("a"), staff("b"), staff("fee", { ftePercentage: 1, inFairness: true })], [...base, ...feeLocked], weights);
    expect(spread(included)).not.toBe(spread(absent));
  });
});
