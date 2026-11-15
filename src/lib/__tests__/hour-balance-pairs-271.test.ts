// Card #271: the hour-balance swaps (the per-pay-period swap pass and the compound repair's
// Phase A/B) never change one day of a group. A weekend-paired Sat+Sun pair is one unit:
// swapping its Saturday for another shift would leave a lone Sunday.
import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleInput, type ScheduleStaff } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

// Card #259 (David, Feb 2027 review): auto-schedule mixes shift lengths so pay-period hours land
// exactly — but only with shifts a person is already meant to get (decision #48): their own
// min target / preference up to its amount, or a staffing requirement still unmet that day.

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
const ORL = shift("st-orl", "ORL", { defaultHours: 12, schedulePriority: 25 });
const PRE = shift("st-pre", "PRE", { defaultHours: 10, schedulePriority: 40 });
const HOL = shift("st-hol", "HOL", { isLeave: true, autoSchedulable: false, defaultHoursHoliday: 8 });
const AL = shift("st-al", "AL", { isLeave: true, autoSchedulable: false });

// PP Sun 2025-05-11 .. Sat 2025-05-24.
const W1 = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
const W2 = ["2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const PP = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
const req = (shiftTypeId: string, code: string, min: number, max: number | null = null) =>
  ["1", "2", "3", "4", "5"].map((dayKey) => ({ shiftTypeId, shiftCode: code, dayKey, minCount: min, preferredCount: min, maxCount: max }));

function input(o: Partial<AutoScheduleInput> = {}): AutoScheduleInput {
  return withDayCaps({
    dates: [...W1, ...W2],
    staff: [],
    shiftTypes: [OR, OFF, ORL, PRE, HOL, AL],
    existingAssignments: [],
    payPeriods: [PP],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [], staffingRequirements: [],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3, holidayShiftId: "st-hol" },
    equityFactors: [], followRules: [],
    ...o,
  });
}


const SAT = "2025-05-17", SUN = "2025-05-18";
function pairShape(wkH: number, pFix: number, aFix: number, paired = true) {
  const CALL = shift("st-call", "CALL", { defaultHours: 8, defaultHoursWeekend: 8, weekendPaired: paired, schedulePriority: 20 });
  const WK = shift("st-wk", "WK", { defaultHours: wkH, defaultHoursWeekend: wkH, schedulePriority: 22 });
  const p = staff("p", { fixedHoursPerPp: pFix, eligibleShiftTypeIds: ["st-call", "st-wk", "st-orl", "st-off"], availabilityRules: avail([0, 1, 6]) });
  const a = staff("a", { fixedHoursPerPp: aFix, eligibleShiftTypeIds: ["st-call", "st-wk", "st-or", "st-off"], availabilityRules: avail([3, 4, 6]) });
  const ORONLY = ["st-or", "st-off", "st-hol", "st-al"];
  return input({
    dates: [...W1, SAT, SUN],
    staff: [p, a, staff("c", { fixedHoursPerPp: 40, eligibleShiftTypeIds: ORONLY }), staff("e", { fixedHoursPerPp: 40, eligibleShiftTypeIds: ORONLY })],
    shiftTypes: [OR, OFF, ORL, HOL, AL, CALL, WK],
    staffingRequirements: [...req("st-or", "OR", 1),
      { shiftTypeId: "st-orl", shiftCode: "ORL", dayKey: "1", minCount: 1, preferredCount: 1, maxCount: 1 },
      ...["6", "0"].map((dayKey) => ({ shiftTypeId: "st-call", shiftCode: "CALL", dayKey, minCount: 1, preferredCount: 1, maxCount: 1 })),
      { shiftTypeId: "st-wk", shiftCode: "WK", dayKey: "6", minCount: 1, preferredCount: 1, maxCount: 1 }],
  });
}
const weekend = (r: ReturnType<typeof autoSchedule>) =>
  r.suggestions.filter((s) => (s.date === SAT || s.date === SUN) && s.code !== "X").map((s) => `${s.staffId}:${s.date}:${s.code}`).sort();

describe("hour-balance swaps never split a weekend pair (card #271)", () => {
  // Shapes found by sweeping WK hours × P's and A's fixed hours: on 5acde0c each swaps
  // P's Saturday CALL for A's WK, leaving P a lone Sunday CALL.
  it.each([[12, 40, 24], [16, 40, 28], [20, 40, 32]])("WK %i h, P %i h, A %i h: P keeps both CALLs", (wkH, pFix, aFix) => {
    for (const skipShiftMixForTest of [true, false]) {
      const r = autoSchedule({ ...pairShape(wkH, pFix, aFix), skipShiftMixForTest });
      expect(weekend(r), `skipShiftMix ${skipShiftMixForTest}`).toEqual([`a:${SAT}:WK`, `p:${SAT}:CALL`, `p:${SUN}:CALL`]);
    }
  });
  it("the same shape without weekend pairing still swaps (the guard is only for groups)", () => {
    const r = autoSchedule(pairShape(12, 40, 24, false));
    expect(weekend(r)).toEqual([`a:${SAT}:CALL`, `p:${SAT}:WK`, `p:${SUN}:CALL`]);
  });
});
