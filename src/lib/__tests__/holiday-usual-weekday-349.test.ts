import { describe, it, expect } from "vitest";
import { autoSchedule, countedHoursFn, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

// Card #349 (decision #74, David): on a weekday holiday HOL goes to (1) full-time staff,
// (2) a part-timer who usually works that weekday (>= the Settings share of the last 26
// weeks, leave counting as worked), else (3) only if a plan with the holiday as an ordinary
// day would have them working it. AR (part-time, usually off Mondays) got HOL on Mon 2/15.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const staff = (id: string, initials: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials, ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off", "st-hol", "st-vac"],
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
const HOL = shift("st-hol", "HOL", { isLeave: true, autoSchedulable: false, defaultHoursHoliday: 8 });
const VAC = shift("st-vac", "VAC", { isLeave: true, autoSchedulable: false });

// PP Sun 2025-05-11 .. Sat 2025-05-24; Mon 2025-05-19 is the holiday.
const W1 = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
const W2 = ["2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const HOLIDAY = W2[0];
const PP = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
// The six Mondays before the pay period.
const PAST_MONDAYS = ["2025-03-31", "2025-04-07", "2025-04-14", "2025-04-21", "2025-04-28", "2025-05-05"];
const past = (staffId: string, codes: string[]): ScheduleAssignment[] => codes.map((code, i) => ({
  staffId, date: PAST_MONDAYS[i], code, isLocked: false, source: "manual",
  shiftTypeId: code === "OR" ? "st-or" : code === "VAC" ? "st-vac" : "st-off",
}));
const req = (shiftTypeId: string, code: string, min: number) =>
  ["1", "2", "3", "4", "5"].map((dayKey) => ({ shiftTypeId, shiftCode: code, dayKey, minCount: min, preferredCount: min, maxCount: null }));

function build(o: Partial<AutoScheduleInput> = {}, pct?: number): AutoScheduleInput {
  return withDayCaps({
    dates: [...W1, ...W2],
    staff: [
      staff("ft", "FT"),
      staff("cc", "CC", { ftePercentage: 0.5 }), // 5 of 6 Mondays worked
      staff("lv", "LV", { ftePercentage: 0.5 }), // 3 worked + 2 leave of 6: leave counts
      staff("ar", "AR", { ftePercentage: 0.4 }), // 2 of 6: usually off Mondays
      staff("rm", "RM", { ftePercentage: 0.2, availabilityRules: avail([1]) }), // no history; Mondays only
    ],
    shiftTypes: [OR, OFF, HOL, VAC],
    existingAssignments: [],
    payPeriods: [PP],
    holidays: [{ date: HOLIDAY }], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [
      ...past("cc", ["OR", "OR", "X", "OR", "OR", "OR"]),
      ...past("lv", ["OR", "VAC", "X", "OR", "VAC", "OR"]),
      ...past("ar", ["X", "OR", "X", "X", "OR", "X"]),
    ],
    staffingRequirements: req("st-or", "OR", 1),
    requiredFollowers: [],
    schedulingPreferences: {
      prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3,
      holidayShiftId: "st-hol", ...(pct === undefined ? {} : { holidayUsualWeekdayPct: pct }),
    },
    equityFactors: [], followRules: [],
    ...o,
  });
}

const codeOn = (r: ReturnType<typeof autoSchedule>, who: string, d: string) => r.suggestions.find((s) => s.staffId === who && s.date === d)?.code ?? "X";
function hoursOf(inp: AutoScheduleInput, r: ReturnType<typeof autoSchedule>, who: string): number {
  const h = countedHoursFn(inp);
  let t = 0;
  for (const s of r.suggestions) if (s.staffId === who && s.date >= PP.startDate && s.date <= PP.endDate) t += h(who, s.shiftTypeId, s.date);
  return t;
}
/** What a plan with the holiday as an ordinary day puts each person on. */
function shadow(inp: AutoScheduleInput) {
  return autoSchedule({ ...inp, holidays: [], schedulingPreferences: { ...inp.schedulingPreferences, holidayPolicy: "none" } });
}

describe("who is owed HOL on a weekday holiday (card #349, decision #74)", () => {
  it("full-timer, usual-Monday part-timers (leave counts) get HOL; AR, usually off Mondays, does not", () => {
    const inp = build();
    const r = autoSchedule(inp);
    const rows = JSON.stringify(Object.fromEntries(inp.staff.map((p) => [p.initials, [...W1, ...W2].map((d) => codeOn(r, p.id, d)).join(" ")])));
    expect(codeOn(r, "ft", HOLIDAY), rows).toBe("HOL");
    expect(codeOn(r, "cc", HOLIDAY), rows).toBe("HOL");
    expect(codeOn(r, "lv", HOLIDAY), rows).toBe("HOL");
    // AR: the ordinary-day plan leaves AR off that Monday, so AR is off (X) and works elsewhere.
    expect(codeOn(shadow(inp), "ar", HOLIDAY)).toBe("X");
    expect(codeOn(r, "ar", HOLIDAY), rows).toBe("X");
    for (const p of inp.staff) expect(hoursOf(inp, r, p.id), `${p.initials} ${rows}`).toBe(PP.targetHours * (p.ftePercentage));
  });
  it("RM (no history, Mondays only) gets HOL because the ordinary-day plan works RM that Monday", () => {
    const inp = build();
    expect(codeOn(shadow(inp), "rm", HOLIDAY)).toBe("OR");
    expect(codeOn(autoSchedule(inp), "rm", HOLIDAY)).toBe("HOL");
  });
  it("a usual-weekday share of 0 keeps the old rule: every available part-timer gets HOL", () => {
    const r = autoSchedule(build({}, 0));
    for (const id of ["ft", "cc", "lv", "ar", "rm"]) expect(codeOn(r, id, HOLIDAY), id).toBe("HOL");
  });
});

describe("the usual-weekday Setting accepts only a whole percent (card #349)", () => {
  it("0–100 integers only", async () => {
    const { isHolidayUsualWeekdayPct } = await import("../holiday-policy");
    for (const ok of [0, 1, 60, 100]) expect(isHolidayUsualWeekdayPct(ok), String(ok)).toBe(true);
    for (const bad of [-1, 101, 60.5, "60", null, undefined, NaN]) expect(isHolidayUsualWeekdayPct(bad), String(bad)).toBe(false);
  });
});
