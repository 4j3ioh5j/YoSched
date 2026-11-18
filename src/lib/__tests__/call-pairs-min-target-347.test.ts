// Card #347 (David, Feb 2027 review): CALL is a weekend shift, paired Saturday + Sunday (with the
// Friday or Monday when a holiday touches the weekend), and it also covers single holidays. The
// per-person minimum-target step placed it one day at a time on plain weekdays when no weekend was
// free. For a weekend-paired shift that step now places only whole free weekends; with none free it
// leaves the target to a later month of the window (warning only once the window ends in the run).
import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";
import type { ShiftMinTarget } from "../shift-eligibility";

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const ELIG = ["st-or", "st-off", "st-hol", "st-call"];
const staff = (id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ELIG, availabilityRules: avail([1, 2, 3, 4, 5]),
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
const HOL = shift("st-hol", "HOL", { isLeave: true, autoSchedulable: false, defaultHoursHoliday: 8 });
const CALL = shift("st-call", "CALL", {
  defaultHours: 8, defaultHoursWeekend: 8, defaultHoursHoliday: 8, weekendPaired: true, holidayWeekendPaired: true,
  ignoresWorkingDays: true, schedulePriority: 20,
});

// PP Sun 2025-05-11 .. Sat 2025-05-24; Wed 2025-05-14 is a single holiday.
const W1 = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
const SAT = "2025-05-17", SUN = "2025-05-18";
const W2 = ["2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const HOLIDAY = W1[2];
const PP = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
const manual = (staffId: string, date: string): ScheduleAssignment =>
  ({ staffId, date, shiftTypeId: "st-call", code: "CALL", isLocked: false, source: "manual" });
const callReqs = (weekendMin: number) => [
  ...["1", "2", "3", "4", "5"].map((dayKey) => ({ shiftTypeId: "st-call", shiftCode: "CALL", dayKey, minCount: 0, preferredCount: 0, maxCount: 1 })),
  ...["6", "0"].map((dayKey) => ({ shiftTypeId: "st-call", shiftCode: "CALL", dayKey, minCount: weekendMin, preferredCount: 0, maxCount: 1 })),
  { shiftTypeId: "st-call", shiftCode: "CALL", dayKey: "holiday", minCount: 1, preferredCount: 0, maxCount: 1 },
];
const target = (window: ShiftMinTarget["window"]): ShiftMinTarget =>
  ({ shiftTypeId: "st-call", minCount: 2, maxCount: 2, window, windowDays: null, windowCount: 1, strength: "rule" });
const callStaff = (id: string, t: ShiftMinTarget[]) => staff(id, { availabilityRules: avail([0, 1, 2, 3, 4, 5, 6]), shiftMinimumTargets: t });

function input(o: { targets: ShiftMinTarget[]; weekendMin: number; weekendTaken: boolean }): AutoScheduleInput {
  return withDayCaps({
    dates: [...W1, SAT, SUN, ...W2],
    staff: [callStaff("a", o.targets), callStaff("b", o.targets), callStaff("p", []), staff("c"), staff("e")],
    shiftTypes: [OR, OFF, HOL, CALL],
    existingAssignments: o.weekendTaken ? [manual("p", SAT), manual("p", SUN)] : [],
    payPeriods: [PP],
    holidays: [{ date: HOLIDAY }], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [],
    staffingRequirements: [
      ...["1", "2", "3", "4", "5"].map((dayKey) => ({ shiftTypeId: "st-or", shiftCode: "OR", dayKey, minCount: 1, preferredCount: 1, maxCount: null })),
      ...callReqs(o.weekendMin),
    ],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3, holidayShiftId: "st-hol" },
    equityFactors: [], followRules: [],
  });
}
const calls = (r: ReturnType<typeof autoSchedule>) => r.suggestions.filter((s) => s.shiftTypeId === "st-call");
const plainWeekdayCalls = (r: ReturnType<typeof autoSchedule>) =>
  calls(r).filter((s) => ![SAT, SUN, HOLIDAY].includes(s.date)).map((s) => `${s.staffId}:${s.date}`);

describe("CALL from a minimum target lands only on whole weekends (card #347)", () => {
  it("no free weekend, window runs past this schedule: no weekday CALL and no warning yet", () => {
    const r = autoSchedule(input({ targets: [target("month")], weekendMin: 1, weekendTaken: true }));
    expect(plainWeekdayCalls(r)).toEqual([]);
    expect(r.warnings.join("\n")).not.toMatch(/^(A|B): .*CALL/m);
  });

  it("no free weekend, window ends in this schedule: no weekday CALL, the Hard target warns", () => {
    const r = autoSchedule(input({ targets: [target("week")], weekendMin: 1, weekendTaken: true }));
    expect(plainWeekdayCalls(r)).toEqual([]);
    expect(r.warnings.join("\n")).toMatch(/A: only [01]\/2 CALL in week \(2025-05-12\.\.2025-05-18\)/);
  });

  it("a free weekend: the target places Saturday and Sunday together for one person", () => {
    const r = autoSchedule(input({ targets: [target("week")], weekendMin: 0, weekendTaken: false }));
    expect(plainWeekdayCalls(r)).toEqual([]);
    const weekend = calls(r).filter((s) => s.date === SAT || s.date === SUN);
    expect(weekend).toHaveLength(2);
    expect(weekend[0].staffId).toBe(weekend[1].staffId);
  });

  it("a single weekday holiday still gets its CALL", () => {
    for (const weekendTaken of [true, false]) {
      const r = autoSchedule(input({ targets: [target("month")], weekendMin: 1, weekendTaken }));
      expect(calls(r).filter((s) => s.date === HOLIDAY)).toHaveLength(1);
    }
  });
});
