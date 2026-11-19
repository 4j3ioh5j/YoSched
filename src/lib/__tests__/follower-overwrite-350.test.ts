import { describe, it, expect } from "vitest";
import { autoSchedule, countedHoursFn, type AutoScheduleInput, type ScheduleStaff } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

// Card #350: a required follower (the X owed the day after an ORC) is an off cell, and every
// later placement treated an off cell as free. STEP 2 put an ORC on ST's owed X, and a fill OR
// then landed on the next owed X: ORC→ORC, two suggestions for one person and day.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const staff = (id: string, initials: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials, ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off", "st-orc", "st-hol"],
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
const ORC = shift("st-orc", "ORC", { defaultHours: 16, schedulePriority: 20 });
const HOL = shift("st-hol", "HOL", { isLeave: true, autoSchedulable: false, defaultHoursHoliday: 8 });

// PP Sun 2025-05-11 .. Sat 2025-05-24; Mon 2025-05-19 is a holiday.
const W1 = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
const W2 = ["2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const PP = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
const req = (shiftTypeId: string, code: string, min: number, max: number | null = null) =>
  ["1", "2", "3", "4", "5"].map((dayKey) => ({ shiftTypeId, shiftCode: code, dayKey, minCount: min, preferredCount: min, maxCount: max }));

function build(): AutoScheduleInput {
  return withDayCaps({
    dates: [...W1, ...W2],
    staff: [
      staff("cl", "CL", { ftePercentage: 0.5, availabilityRules: avail([1, 2]) }),
      // ST prefers ORC on Tuesdays (the staff card's "eligible · Prefer" rule), so STEP 2 hands ST
      // both Tuesday ORCs before CL's hours are looked at — CL's only long-shift days.
      staff("st", "ST", { shiftEligibilityRules: [{ shiftTypeId: "st-orc", type: "eligible" as const, strength: "preference" as const, ...wEvery(2) }] }), staff("bc", "BC"), staff("dh", "DH"), staff("lm", "LM"),
    ],
    shiftTypes: [OR, OFF, ORC, HOL],
    existingAssignments: [],
    payPeriods: [PP],
    holidays: [{ date: W2[0] }], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [],
    staffingRequirements: [...req("st-orc", "ORC", 1, 1), ...req("st-or", "OR", 2)],
    requiredFollowers: [{ sourceShiftId: "st-orc", followerShiftId: "st-off", scope: "each_day", countsTowardTargets: true }],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3, holidayShiftId: "st-hol" },
    equityFactors: [], followRules: [],
  });
}

describe("a placed required follower is never filled over (card #350)", () => {
  it("one suggestion per person and day; every ORC is followed by X", () => {
    const inp = build();
    const r = autoSchedule(inp);
    const seen = new Map<string, string>();
    for (const s of r.suggestions) {
      const k = `${s.staffId}:${s.date}`;
      expect(seen.get(k), `${k} has ${seen.get(k)} and ${s.code}/${s.step}`).toBeUndefined();
      seen.set(k, `${s.code}/${s.step}`);
    }
    for (const s of r.suggestions.filter((x) => x.code === "ORC")) {
      const next = new Date(s.date + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
      const nd = next.toISOString().slice(0, 10);
      if ([...W1, ...W2].includes(nd)) expect(r.suggestions.find((x) => x.staffId === s.staffId && x.date === nd)?.code, `${s.staffId} after ORC ${s.date}`).toBe("X");
    }
  });
});
