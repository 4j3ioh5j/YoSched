// Card #265 item 1: a weekend pair is gap-checked as one block with its Sunday. When a weekly
// maximum then drops the Sunday, the lone Saturday must still keep a Hard minimum gap.
import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
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
const manual = (staffId: string, date: string, shiftTypeId: string, code: string): ScheduleAssignment =>
  ({ staffId, date, shiftTypeId, code, isLocked: false, source: "manual" });

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


const SAT = "2025-05-17", SUN = "2025-05-18", MON = W2[0];
function shape(strength: "rule" | "preference", weeklyMax: number | null, withQ = false) {
  const CALL = shift("st-call", "CALL", { defaultHours: 8, defaultHoursWeekend: 8, weekendPaired: true, schedulePriority: 20, minGapDays: 5, minGapStrength: strength });
  const p = staff("p", { eligibleShiftTypeIds: [...ELIG, "st-call"], availabilityRules: avail([0, 1, 2, 3, 4, 5, 6]),
    shiftMinimumTargets: weeklyMax == null ? [] : [{ shiftTypeId: "st-call", minCount: 0, maxCount: weeklyMax, window: "week", windowDays: null, strength: "rule" }] });
  return input({
    dates: [...W1, SAT, SUN, ...W2],
    staff: [p, ...(withQ ? [staff("q", { eligibleShiftTypeIds: [...ELIG, "st-call"], availabilityRules: avail([0, 6]) })] : []), staff("c"), staff("e")],
    shiftTypes: [OR, OFF, ORL, HOL, AL, CALL],
    existingAssignments: [manual("p", MON, "st-call", "CALL")],
    staffingRequirements: [...req("st-or", "OR", 1), ...["6", "0"].map((dayKey) => ({ shiftTypeId: "st-call", shiftCode: "CALL", dayKey, minCount: 1, preferredCount: 1, maxCount: 1 }))],
  });
}
const callsOf = (r: ReturnType<typeof autoSchedule>) => r.suggestions.filter((s) => s.shiftTypeId === "st-call").map((s) => `${s.staffId}:${s.date}`).sort();

describe("a weekend pair cut short by a weekly maximum keeps a Hard minimum gap (card #265)", () => {
  it("Hard: P's lone Saturday would sit 2 days from their Monday CALL — it is not placed", () => {
    const r = autoSchedule(shape("rule", 1));
    expect(callsOf(r)).not.toContain(`p:${SAT}`);
    expect(r.warnings.join("\n")).toMatch(/a maximum would leave 2025-05-17 alone, too close to another CALL/);
    expect(r.warnings.join("\n")).not.toMatch(/2 days apart/);
  });
  it("Hard, with someone else free: Q takes the whole weekend instead", () => {
    const r = autoSchedule(shape("rule", 1, true));
    expect(callsOf(r)).toEqual([`q:${SAT}`, `q:${SUN}`]);
  });
  it("Prefer never blocks: P still takes the lone Saturday, and the audit names the close pair", () => {
    const r = autoSchedule(shape("preference", 1));
    expect(callsOf(r)).toEqual([`p:${SAT}`]);
    expect(r.warnings.join("\n")).toMatch(/2 days apart/);
  });
  it("control: without the weekly maximum P takes the whole weekend (Sat, Sun, Mon is one block)", () => {
    const r = autoSchedule(shape("rule", null));
    expect(callsOf(r)).toEqual([`p:${SAT}`, `p:${SUN}`]);
  });
});
