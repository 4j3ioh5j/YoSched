import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleInput, type ScheduleStaff } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";
import { pinHardLegality } from "../scenario";
import type { ShiftEligibilityRule } from "../shift-eligibility";

// Card #188 (David, decision #35): "eligible · Prefer" favours those days and allows the others;
// "ineligible · Prefer" steers away but stays allowed. Hard rules are unchanged.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const staff = (id: string, initials: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials, ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off", "st-orc", "st-orl"],
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
const ORL = shift("st-orl", "ORL", { defaultHours: 12, schedulePriority: 25 });

// PP Sun 2025-05-11 .. Sat 2025-05-24. W1[0] Mon .. W1[4] Fri.
const W1 = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
const W2 = ["2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const PP = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };

function input(o: Partial<AutoScheduleInput> = {}): AutoScheduleInput {
  return withDayCaps({
    dates: [...W1, ...W2],
    staff: [],
    shiftTypes: [OR, OFF, ORC, ORL],
    existingAssignments: [],
    payPeriods: [PP],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [], staffingRequirements: [],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
    equityFactors: [], followRules: [],
    ...o,
  });
}
const rule = (shiftTypeId: string, dow: number, type: "eligible" | "ineligible", strength: "rule" | "preference"): ShiftEligibilityRule =>
  ({ shiftTypeId, type, strength, ...wEvery(dow) }) as ShiftEligibilityRule;
const need = (shiftTypeId: string, code: string, dayKeys: string[]) =>
  dayKeys.map((dayKey) => ({ shiftTypeId, shiftCode: code, dayKey, minCount: 1, preferredCount: 1, maxCount: 1 }));
const who = (r: ReturnType<typeof autoSchedule>, date: string, stId: string) =>
  r.suggestions.filter((s) => s.date === date && s.shiftTypeId === stId).map((s) => s.staffId);

describe("card #188: eligible · Prefer", () => {
  it("control: with no rules, AB (listed first) takes Tuesday's ORC", () => {
    const r = autoSchedule(input({ staff: [staff("ab", "AB"), staff("cd", "CD")], staffingRequirements: need("st-orc", "ORC", ["2"]) }));
    expect(who(r, W1[1], "st-orc")).toEqual(["ab"]);
  });

  it("favours the listed day: CD (listed second) with 'ORC · eligible · Prefer · Tue' gets Tuesday's ORC", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB"), staff("cd", "CD", { shiftEligibilityRules: [rule("st-orc", 2, "eligible", "preference")] })],
      staffingRequirements: need("st-orc", "ORC", ["2"]),
    }));
    expect(who(r, W1[1], "st-orc")).toEqual(["cd"]);
    expect(who(r, W2[1], "st-orc")).toEqual(["cd"]);
  });

  it("allows the other days: the only ORC person, 'eligible · Prefer · Tue', still covers Wednesday", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB", { shiftEligibilityRules: [rule("st-orc", 2, "eligible", "preference")] }), staff("cd", "CD", { eligibleShiftTypeIds: ["st-or", "st-off"] })],
      staffingRequirements: need("st-orc", "ORC", ["3"]),
    }));
    expect(who(r, W1[2], "st-orc")).toEqual(["ab"]);
  });

  it("Hard stays 'only these days': 'eligible · Hard · Tue' never covers Wednesday", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB", { shiftEligibilityRules: [rule("st-orc", 2, "eligible", "rule")] }), staff("cd", "CD", { eligibleShiftTypeIds: ["st-or", "st-off"] })],
      staffingRequirements: need("st-orc", "ORC", ["3"]),
    }));
    expect(who(r, W1[2], "st-orc")).toEqual([]);
  });

  it("beats share fairness: CD prefers Tuesday and gets it even after taking Monday's", () => {
    const r = autoSchedule(input({
      staff: [staff("cd", "CD", { shiftEligibilityRules: [rule("st-orc", 2, "eligible", "preference")] }), staff("ab", "AB")],
      staffingRequirements: need("st-orc", "ORC", ["1", "2"]),
    }));
    expect(who(r, W1[0], "st-orc")).toEqual(["cd"]); // first in the list, nobody prefers Monday
    expect(who(r, W1[1], "st-orc")).toEqual(["cd"]); // one more ORC than AB, but Tuesday is preferred
  });

  it("loses to an explicit request: AB's soft request for Tuesday's ORC beats CD's standing Prefer", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB"), staff("cd", "CD", { shiftEligibilityRules: [rule("st-orc", 2, "eligible", "preference")] })],
      staffingRequirements: need("st-orc", "ORC", ["2"]),
      scheduleRequests: [{ id: "q1", staffId: "ab", startDate: W1[1], endDate: W1[1], kind: "REQUEST_SHIFT", shiftTypeIds: ["st-orc"], leaveShiftTypeId: null, strength: "soft", status: "approved" }],
    }));
    expect(who(r, W1[1], "st-orc")).toEqual(["ab"]);
  });

  it("a person's minimum lands on their preferred day (Thursday), not the first free one", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB", {
        shiftEligibilityRules: [rule("st-orc", 4, "eligible", "preference")],
        shiftMinimumTargets: [{ shiftTypeId: "st-orc", minCount: 1, maxCount: null, window: "pay_period", windowDays: null, windowCount: 1 }],
      })],
    }));
    const orcDays = r.suggestions.filter((s) => s.staffId === "ab" && s.shiftTypeId === "st-orc").map((s) => s.date);
    expect(orcDays).toEqual([W1[3]]);
  });

  it("a person's minimum steers away from a soft-ineligible Monday", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB", {
        shiftEligibilityRules: [rule("st-orc", 1, "ineligible", "preference")],
        shiftMinimumTargets: [{ shiftTypeId: "st-orc", minCount: 1, maxCount: null, window: "pay_period", windowDays: null, windowCount: 1 }],
      })],
    }));
    const orcDays = r.suggestions.filter((s) => s.staffId === "ab" && s.shiftTypeId === "st-orc").map((s) => s.date);
    expect(orcDays).toEqual([W1[1]]);
  });

  it("paired shifts (ORL 12 h on an 8 h fill): the host is scored on the group it would get", () => {
    // One ORL group of 2: Monday + Thursday. CD (listed first) and AB tie on Monday; AB prefers
    // Thursday, so AB's real group scores higher and AB hosts.
    const r = autoSchedule(input({
      staff: [staff("cd", "CD"), staff("ab", "AB", { shiftEligibilityRules: [rule("st-orl", 4, "eligible", "preference")] })],
      dates: W1,
      staffingRequirements: need("st-orl", "ORL", ["1", "4"]),
    }));
    expect(who(r, W1[3], "st-orl")).toEqual(["ab"]);
  });
});

describe("card #188: ineligible · Prefer", () => {
  it("steers away: AB (listed first) with 'ORC · ineligible · Prefer · Tue' leaves Tuesday's ORC to CD", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB", { shiftEligibilityRules: [rule("st-orc", 2, "ineligible", "preference")] }), staff("cd", "CD")],
      staffingRequirements: need("st-orc", "ORC", ["2"]),
    }));
    expect(who(r, W1[1], "st-orc")).toEqual(["cd"]);
  });

  it("still used when nobody else can", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB", { shiftEligibilityRules: [rule("st-orc", 2, "ineligible", "preference")] }), staff("cd", "CD", { eligibleShiftTypeIds: ["st-or", "st-off"] })],
      staffingRequirements: need("st-orc", "ORC", ["2"]),
    }));
    expect(who(r, W1[1], "st-orc")).toEqual(["ab"]);
  });

  it("a lone soft rule no longer closes the other days: AB covers Wednesday", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB", { shiftEligibilityRules: [rule("st-orc", 2, "ineligible", "preference")] }), staff("cd", "CD", { eligibleShiftTypeIds: ["st-or", "st-off"] })],
      staffingRequirements: need("st-orc", "ORC", ["3"]),
    }));
    expect(who(r, W1[2], "st-orc")).toEqual(["ab"]);
  });
});

describe("card #188: rules never re-open a shift unticked in the activation panel", () => {
  it("an 'eligible · Hard' rule kept for an unticked shift doesn't let the scheduler use it", () => {
    const r = autoSchedule(input({
      staff: [staff("ab", "AB", { eligibleShiftTypeIds: ["st-or", "st-off"], shiftEligibilityRules: [rule("st-orc", 2, "eligible", "rule"), rule("st-orc", 2, "eligible", "preference")] })],
      staffingRequirements: need("st-orc", "ORC", ["2"]),
    }));
    expect(r.suggestions.some((s) => s.shiftTypeId === "st-orc")).toBe(false);
  });
});

describe("card #188: the hours swap repair respects the activation panel too", () => {
  it("CD, unticked for ORC but with a kept 'ORC · eligible · Hard · Tue' rule, is never swapped onto an ORC", () => {
    // AB (the only ORC person) is over with the Tuesday ORCs; CD (Mon–Thu only) is under. Swapping a
    // Tuesday ORC to CD would even the hours — but CD isn't ticked for ORC.
    const manualDays = [...W1, ...W2].filter((d) => d !== W1[1] && d !== W2[1]);
    const r = autoSchedule(input({
      staff: [
        staff("ab", "AB"),
        staff("cd", "CD", { eligibleShiftTypeIds: ["st-or", "st-off"], availabilityRules: avail([1, 2, 3, 4]), shiftEligibilityRules: [rule("st-orc", 2, "eligible", "rule")] }),
      ],
      existingAssignments: manualDays.map((d) => ({ staffId: "ab", date: d, shiftTypeId: "st-or", code: "OR", isLocked: false, source: "manual" as const })),
      staffingRequirements: need("st-orc", "ORC", ["2"]),
    }));
    expect(r.suggestions.filter((s) => s.staffId === "cd" && s.shiftTypeId === "st-orc")).toEqual([]);
    expect(who(r, W1[1], "st-orc")).toEqual(["ab"]);
  });
});

describe("card #188: a scenario pin on a non-preferred day is legal", () => {
  const legal = (rules: ShiftEligibilityRule[], date: string) =>
    pinHardLegality(staff("ab", "AB", { shiftEligibilityRules: rules }), ORC as never, date, [PP], () => false, [], "off", () => false);
  it("'eligible · Prefer · Tue': a Wednesday ORC pin is ok", () => {
    expect(legal([rule("st-orc", 2, "eligible", "preference")], W1[2])).toBe("ok");
  });
  it("'ineligible · Prefer · Tue': a Wednesday pin is ok, and a Tuesday pin too", () => {
    expect(legal([rule("st-orc", 2, "ineligible", "preference")], W1[2])).toBe("ok");
    expect(legal([rule("st-orc", 2, "ineligible", "preference")], W1[1])).toBe("ok");
  });
  it("'eligible · Hard · Tue': a Wednesday pin is still ineligible", () => {
    expect(legal([rule("st-orc", 2, "eligible", "rule")], W1[2])).toBe("ineligible");
  });
});
