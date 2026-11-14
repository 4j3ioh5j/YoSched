import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleInput, type ScheduleStaff } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";
import type { ShiftEligibilityRule } from "../shift-eligibility";

// Card #204 (David): "No hard coded rules are ever allowed." The hidden staff day preference
// ("Tuesday: ORC", no screen showed it) no longer narrows who can take a shift; the visible
// staff-card rule "eligible · Prefer" on that weekday is what favours a person.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const ALL = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const staff = (id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-orc"], availabilityRules: ALL, isActive: true, isAutoScheduled: true, specialQualifications: [], ...o,
});
const ORC: TestShift = {
  id: "st-orc", code: "ORC", name: "ORC", defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
  countsTowardFte: false, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
  sortOrder: 0, schedulePriority: 10, weekendPaired: false, holidayWeekendPaired: false,
  ignoresWorkingDays: false, category: "clinical", autoSchedulable: true,
};
// The rule the migration writes for "Tuesday: ORC".
const preferTue: ShiftEligibilityRule = { shiftTypeId: "st-orc", type: "eligible", strength: "preference", ...wEvery(2) } as ShiftEligibilityRule;

function run(o: Partial<AutoScheduleInput>) {
  return autoSchedule(withDayCaps({
    dates: ["2025-06-03"], staff: [], shiftTypes: [ORC], existingAssignments: [],
    payPeriods: [{ startDate: "2025-06-01", endDate: "2025-06-14", targetHours: 0 }],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [],
    historicalAssignments: [],
    staffingRequirements: ["1", "2", "3"].map((dayKey) => ({ shiftTypeId: "st-orc", shiftCode: "ORC", dayKey, minCount: 1, preferredCount: 1, maxCount: 1 })),
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
    equityFactors: [], followRules: [], writableFrom: "2025-06-01",
    ...o,
  }));
}
const orcOn = (r: ReturnType<typeof run>, d: string) => r.suggestions.filter((s) => s.date === d).map((s) => s.staffId);

describe("day preferences are settings, never a hidden filter (card #204)", () => {
  it("a legacy day-preference row no longer hands the shift to that person", () => {
    // List order alone picks A; the old hidden row "B: Tuesday ORC" used to override it.
    const r = run({ staff: [staff("a"), staff("b")], dayPreferences: [{ staffId: "b", dayOfWeek: 2, preference: "ORC" }] });
    expect(orcOn(r, "2025-06-03")).toEqual(["a"]);
  });

  it("the visible staff-card Prefer rule on Tuesdays favours that person on Tuesdays", () => {
    const r = run({ staff: [staff("a"), staff("b", { shiftEligibilityRules: [preferTue] })] });
    expect(orcOn(r, "2025-06-03")).toEqual(["b"]);
  });

  it("…and never closes their other days", () => {
    const r = run({ dates: ["2025-06-02", "2025-06-04"], staff: [staff("b", { shiftEligibilityRules: [preferTue] })] });
    expect(orcOn(r, "2025-06-02")).toEqual(["b"]);
    expect(orcOn(r, "2025-06-04")).toEqual(["b"]);
  });
});
