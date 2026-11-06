import { describe, it, expect } from "vitest";
import { autoSchedule, type ScheduleStaff, type ScheduleShiftType } from "../auto-scheduler";
import { checkDayStaffing } from "../constraints";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";

// Staffing Rules are linked to a shift's ID. These fixtures make a CODE-keyed lookup
// give the WRONG answer on purpose: each shift's code is the other shift's id, so any
// `map.get(shift.code)` left in the engine or the grid warnings reads the other shift's
// rules. (Renaming a code in Settings must never move a rule; the ids prove it.)
const A: ScheduleShiftType = {
  id: "st-a", code: "st-b", name: "A (fill)", defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
  countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: true, sortOrder: 0,
  schedulePriority: 1, weekendPaired: false, holidayWeekendPaired: false, ignoresWorkingDays: false, category: "clinical", autoSchedulable: true,
};
const B: ScheduleShiftType = { ...A, id: "st-b", code: "st-a", name: "B", isFillShift: false, schedulePriority: 2 };
const OFF: ScheduleShiftType = { ...A, id: "st-off", code: "X", name: "Off", isOffShift: true, isFillShift: false, countsTowardFte: false, autoSchedulable: false, schedulePriority: null };

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const staff = (id: string, initials: string): ScheduleStaff => ({
  id, initials, ftePercentage: 1, eligibleShiftTypeIds: ["st-a", "st-b", "st-off"],
  availabilityRules: [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })),
  isActive: true, isAutoScheduled: true, specialQualifications: [],
});
const MON = "2025-05-12";

describe("staffing rules follow the shift id, not the code", () => {
  it("the engine fills the minimum of the shift the rule is linked to, even though the other shift carries its id as a code", () => {
    const r = autoSchedule({
      dates: [MON],
      staff: [staff("p1", "AB"), staff("p2", "CD")],
      shiftTypes: [A, B, OFF],
      existingAssignments: [],
      payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
      holidays: [],
      desirabilityWeights: [],
      standingCommitments: [],
      staffOverrides: [],
      dayPreferences: [],
      historicalAssignments: [],
      // One B required on Mondays — by B's ID. A code-keyed lookup would hand this to A.
      staffingRequirements: [{ shiftTypeId: "st-b", dayKey: "1", minCount: 1 }],
      schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
      equityFactors: [],
      followRules: [],
    } as Parameters<typeof autoSchedule>[0]);
    const onMon = r.suggestions.filter((s) => s.date === MON);
    expect(onMon.filter((s) => s.shiftTypeId === "st-b")).toHaveLength(1);
    expect(onMon.filter((s) => s.shiftTypeId === "st-a")).toHaveLength(1);
  });

  it("the grid's day warning names the linked shift by its CURRENT code", () => {
    const shiftTypeMap = new Map([A, B, OFF].map((s) => [s.id, { ...s, maxPerDay: null }] as const));
    const w = checkDayStaffing({
      date: MON,
      staff: [staff("p1", "AB")],
      assignmentMap: new Map([[`p1:${MON}`, { shiftTypeId: "st-a", code: "st-b" }]]), // p1 works A (whose code is "st-b")
      shiftTypeMap: shiftTypeMap as unknown as Parameters<typeof checkDayStaffing>[0]["shiftTypeMap"],
      holidaySet: new Set(),
      staffingMins: [],
      staffingReqs: [{ shiftTypeId: "st-b", dayKey: "1", minCount: 1 }],
    });
    // B is short (nobody works st-b); A's cell must not be counted for B just because A's code reads "st-b".
    expect(w).toHaveLength(1);
    expect(w[0].message).toBe("0/1 st-a (weekday)"); // B's current code
  });
});
