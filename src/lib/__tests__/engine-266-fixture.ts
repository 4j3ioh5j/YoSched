// Card #266: a small month with two marked (spread-over-month) shifts, so the spacing trial runs
// an off run and two candidate batches. Shared by the engine pool and Live-edit step tests.
import type { AutoScheduleInput, ScheduleStaff } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const ELIG = ["st-or", "st-off", "st-orl", "st-hol", "st-al"];
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
const AL = shift("st-al", "AL", { isLeave: true, autoSchedulable: false });
const req = (shiftTypeId: string, code: string, min: number, max: number | null = null) =>
  ["1", "2", "3", "4", "5"].map((dayKey) => ({ shiftTypeId, shiftCode: code, dayKey, minCount: min, preferredCount: min, maxCount: max }));
const D = (n: number) => new Date(Date.parse("2025-05-12T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const weekdays = (n: number) => Array.from({ length: n }, (_, i) => D(i)).filter((d) => ![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay()));
const PPS = [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }, { startDate: "2025-05-25", endDate: "2025-06-07", targetHours: 80 }];
const LIVE = ["hardLimits", "coverage", "underHours", "requests", "spacing", "overHours", "fairness"].map((key, i) => ({ key, sortOrder: i, enabled: true, ...(key === "underHours" ? { hoursPolicy: "prohibited" as const } : {}) }));

/** Two marked shifts, so the trial has an off run and two candidate batches. */
export function fixture(days = 20): AutoScheduleInput {
  const ORL = shift("st-orl", "ORL", { defaultHours: 12, schedulePriority: 25, spreadOverMonth: true });
  const ORC = shift("st-orc", "ORC", { defaultHours: 10, schedulePriority: 27, spreadOverMonth: true });
  return withDayCaps({
    dates: weekdays(days),
    staff: ["a", "b", "c", "d", "e", "f"].map((id) => staff(id, { eligibleShiftTypeIds: [...ELIG, "st-orc"] })),
    shiftTypes: [OR, OFF, ORL, ORC, HOL, AL],
    existingAssignments: [],
    payPeriods: PPS,
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [],
    staffingRequirements: [...req("st-or", "OR", 1), ...req("st-orl", "ORL", 2, 2), ...req("st-orc", "ORC", 1, 1)],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3, holidayShiftId: "st-hol" },
    equityFactors: [], followRules: [],
    factorOrder: LIVE,
  });
}

