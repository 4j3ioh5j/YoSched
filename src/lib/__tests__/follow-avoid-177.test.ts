import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

// Card #177 (David, Feb 2027 review): a soft "avoid B the day after A" follow rule. The
// engine steers away from the pair but still uses it when that's the only way.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const staff = (id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off", "st-orc", "st-orl"], availabilityRules: avail([1, 2, 3, 4, 5]),
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

// PP Sun 2025-05-11 .. Sat 2025-05-24.
const W1 = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
const W2 = ["2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const PP = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
const manual = (staffId: string, date: string, shiftTypeId: string, code: string): ScheduleAssignment =>
  ({ staffId, date, shiftTypeId, code, isLocked: false, source: "manual" });
const reqOn = (shiftTypeId: string, code: string, dayKeys: string[]) =>
  dayKeys.map((dayKey) => ({ shiftTypeId, shiftCode: code, dayKey, minCount: 1, preferredCount: 1, maxCount: 1 }));
const AVOID_ORL_ORC = [{ sourceShiftId: "st-orl", avoidShiftId: "st-orc" }];

function input(o: Partial<AutoScheduleInput> = {}): AutoScheduleInput {
  return withDayCaps({
    dates: [...W1, ...W2], staff: [], shiftTypes: [OR, OFF, ORC, ORL], existingAssignments: [], payPeriods: [PP],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [], staffingRequirements: [],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
    equityFactors: [], followRules: [],
    ...o,
  });
}
const at = (r: ReturnType<typeof autoSchedule>, inp: AutoScheduleInput, who: string, d: string) =>
  r.suggestions.find((s) => s.staffId === who && s.date === d)?.code ?? inp.existingAssignments.find((a) => a.staffId === who && a.date === d)?.code;
const orcOn = (r: ReturnType<typeof autoSchedule>, d: string) => r.suggestions.find((s) => s.date === d && s.shiftTypeId === "st-orc")?.staffId;

describe("pickStaff steers away from an avoided pair (card #177)", () => {
  for (const mon of ["ab", "cd"]) {
    it(`${mon.toUpperCase()} worked an ORL Monday: Tuesday's ORC goes to the other person only when ORL→ORC is avoided`, () => {
      const inp = input({ staff: [staff("ab"), staff("cd")], existingAssignments: [manual(mon, W1[0], "st-orl", "ORL")], staffingRequirements: reqOn("st-orc", "ORC", ["2"]) });
      expect(orcOn(autoSchedule(inp), W1[1])).toBe(mon); // without the rule the ORL holder wins
      const r = autoSchedule({ ...inp, followAvoids: AVOID_ORL_ORC });
      expect(orcOn(r, W1[1])).toBe(mon === "ab" ? "cd" : "ab");
      expect(r.warnings.filter((w) => w.includes("avoided pair"))).toEqual([]);
    });
  }

  it("still uses the pair when the ORL holder is the only one who can work ORC, and names it", () => {
    const inp = input({
      staff: [staff("ab"), staff("cd", { eligibleShiftTypeIds: ["st-or", "st-off"] })],
      existingAssignments: [manual("ab", W1[0], "st-orl", "ORL")],
      staffingRequirements: reqOn("st-orc", "ORC", ["2"]),
      followAvoids: AVOID_ORL_ORC,
    });
    const r = autoSchedule(inp);
    expect(orcOn(r, W1[1])).toBe("ab");
    expect(r.warnings).toContain(`AB ${W1[1]}: ORC after ORL (an avoided pair)`);
  });

  it("a pair that is both blocked and avoided stays blocked", () => {
    const inp = input({
      staff: [staff("ab"), staff("cd", { eligibleShiftTypeIds: ["st-or", "st-off"] })],
      existingAssignments: [manual("ab", W1[0], "st-orl", "ORL")],
      staffingRequirements: reqOn("st-orc", "ORC", ["2"]),
      followRules: [{ sourceShiftId: "st-orl", allowedShiftId: "st-orc", allowOffShifts: false, mode: "block" }],
      followAvoids: AVOID_ORL_ORC,
    });
    const r = autoSchedule(inp);
    expect(orcOn(r, W1[1])).toBeUndefined();
    expect(at(r, inp, "ab", W1[1])).not.toBe("ORC");
  });

  it("an avoid list that never applies changes nothing", () => {
    const inp = input({ staff: [staff("ab"), staff("cd")], existingAssignments: [manual("ab", W1[0], "st-orl", "ORL")], staffingRequirements: reqOn("st-orc", "ORC", ["2"]) });
    expect(autoSchedule({ ...inp, followAvoids: [{ sourceShiftId: "st-orc", avoidShiftId: "st-orl" }] })).toEqual(autoSchedule(inp));
  });
});

const row = (r: ReturnType<typeof autoSchedule>, inp: AutoScheduleInput, who: string) =>
  [...W1, ...W2].map((d) => at(r, inp, who, d) ?? "-").join(" ");
const MIN_ORC = { shiftMinimumTargets: [{ shiftTypeId: "st-orc", minCount: 1, maxCount: null, window: "pay_period", windowDays: null }] } as Partial<ScheduleStaff>;

describe("the avoid ranks below hard rules and minimums (card #177)", () => {
  it("a hard ORC minimum outranks the avoid: the ORL holder still gets Tuesday's ORC", () => {
    const base = { existingAssignments: [manual("ab", W1[0], "st-orl", "ORL")], staffingRequirements: reqOn("st-orc", "ORC", ["2"]), followAvoids: AVOID_ORL_ORC };
    // Without the minimum the avoid moves the ORC to CD …
    expect(orcOn(autoSchedule(input({ ...base, staff: [staff("ab"), staff("cd")] })), W1[1])).toBe("cd");
    // … with AB owing an ORC this pay period, the minimum wins, and the pair is reported.
    const r = autoSchedule(input({ ...base, staff: [staff("ab", MIN_ORC), staff("cd")] }));
    expect(orcOn(r, W1[1])).toBe("ab");
    expect(r.warnings).toContain(`AB ${W1[1]}: ORC after ORL (an avoided pair)`);
  });
});

describe("day choice steers away from an avoided pair (card #177)", () => {
  it("a minimum-target ORC takes a day that isn't right after the ORL", () => {
    const inp = input({ staff: [staff("ab", MIN_ORC)], existingAssignments: [manual("ab", W1[0], "st-orl", "ORL")] });
    const orcDays = (r: ReturnType<typeof autoSchedule>) => r.suggestions.filter((s) => s.shiftTypeId === "st-orc").map((s) => s.date);
    expect(orcDays(autoSchedule(inp))).toEqual([W1[1]]);
    const r = autoSchedule({ ...inp, followAvoids: AVOID_ORL_ORC });
    expect(orcDays(r)).toHaveLength(1);
    expect(orcDays(r)[0]).not.toBe(W1[1]);
    expect(r.warnings.filter((w) => w.includes("avoided pair"))).toEqual([]);
  });

  it("the fill picks its days off so the day after the ORL isn't one (its own X days count)", () => {
    const ORL8 = shift("st-orl", "ORL", { defaultHours: 8, schedulePriority: 25 });
    const inp = input({ shiftTypes: [OR, OFF, ORC, ORL8], staff: [staff("ab", { ftePercentage: 0.5 })], existingAssignments: [manual("ab", W1[0], "st-orl", "ORL")] });
    const r0 = autoSchedule(inp);
    expect(at(r0, inp, "ab", W1[1])).toBe("X"); // without the rule the X days start right after the ORL
    const r = autoSchedule({ ...inp, followAvoids: [{ sourceShiftId: "st-orl", avoidShiftId: "st-off" }] });
    expect(at(r, inp, "ab", W1[1])).toBe("OR");
    // Same hours: the avoid only moves which days are off.
    const count = (s: string) => s.split(" ").filter((c) => c === "OR").length;
    expect(count(row(r, inp, "ab"))).toBe(count(row(r0, inp, "ab")));
    expect(r.warnings.filter((w) => w.includes("avoided pair"))).toEqual([]);
  });
});

describe("minimum-target days are re-scored after each placement (card #187)", () => {
  it("two owed ORCs with ORC→ORC avoided don't land on consecutive days", () => {
    const MIN2 = { shiftMinimumTargets: [{ shiftTypeId: "st-orc", minCount: 2, maxCount: null, window: "pay_period", windowDays: null }] } as Partial<ScheduleStaff>;
    const inp = input({ staff: [staff("ab", MIN2)], payPeriods: [{ ...PP, targetHours: 32 }] });
    const orcDays = (r: ReturnType<typeof autoSchedule>) => r.suggestions.filter((s) => s.shiftTypeId === "st-orc").map((s) => s.date).sort();
    expect(orcDays(autoSchedule(inp))).toEqual([W1[0], W1[1]]); // without the rule: the first two days
    const r = autoSchedule({ ...inp, followAvoids: [{ sourceShiftId: "st-orc", avoidShiftId: "st-orc" }] });
    const days = orcDays(r);
    expect(days).toHaveLength(2);
    expect(days[0]).toBe(W1[0]);
    expect(days[1]).not.toBe(W1[1]);
    expect(r.warnings.filter((w) => w.includes("avoided pair"))).toEqual([]);
  });
});
