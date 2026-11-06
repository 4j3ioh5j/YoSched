// Card #69 regression: see the describe block.
import { describe, it, expect } from "vitest";
import { autoSchedule as autoScheduleRaw, type ScheduleStaff, type AutoScheduleResult } from "../auto-scheduler";
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
const LEAVE = shift("st-vac", "VAC", { isLeave: true, countsTowardFte: true, autoSchedulable: false });

// Two weeks of weekdays in one 14-day pay period (Sun 2025-05-11 .. Sat 2025-05-24).
const DATES = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16",
  "2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];

type Existing = { staffId: string; date: string; shiftTypeId: string; code: string; isLocked: boolean; source: string };
function run(people: ScheduleStaff[], existing: Existing[] = [], weights: { shiftTypeId: string; dayOfWeek: number; weight: number }[] = []): AutoScheduleResult {
  return autoSchedule({
    dates: DATES,
    staff: people,
    shiftTypes: [OR, LEAVE, OFF],
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


// Card #69: a conditional availability rule ("AB only when CD is working") must read an
// off or leave cell (locked or not) as NOT working. Before the fix the engine's isAssigned
// counted a locked X / leave cell as "assigned", so AB was placed beside an absent CD.
const MON = "2025-05-12", TUE = "2025-05-13", WED = "2025-05-14";
const whenCdWorks = (t: "working" | "not_working") => [1, 2, 3, 4, 5].map((d) => ({
  type: "available" as const, strength: "rule" as const, conditionStaffId: "cd", conditionType: t, ...wEvery(d),
}));
const lockedCd = (date: string, st: TestShift): Existing => ({ staffId: "cd", date, shiftTypeId: st.id, code: st.code, isLocked: true, source: "manual" });
const orOn = (r: AutoScheduleResult, id: string, date: string) =>
  r.suggestions.some((s) => s.staffId === id && s.date === date && s.code === "OR");

describe("engine — conditional availability reads off/leave as not working (card #69)", () => {
  const existing = [lockedCd(MON, OFF), lockedCd(TUE, LEAVE), lockedCd(WED, OR)];

  it("'only when CD works': no OR for AB on CD's locked X or leave day; OR allowed beside CD's OR", () => {
    const r = run([staff("ab", { availabilityRules: whenCdWorks("working") }), staff("cd")], existing);
    expect(orOn(r, "ab", MON)).toBe(false);
    expect(orOn(r, "ab", TUE)).toBe(false);
    expect(orOn(r, "ab", WED)).toBe(true);
  });

  it("'only when CD is NOT working': AB may work CD's X and leave days, never beside CD's OR", () => {
    const r = run([staff("ab", { availabilityRules: whenCdWorks("not_working") }), staff("cd")], existing);
    expect(orOn(r, "ab", MON)).toBe(true);
    expect(orOn(r, "ab", TUE)).toBe(true);
    expect(orOn(r, "ab", WED)).toBe(false);
  });
});
