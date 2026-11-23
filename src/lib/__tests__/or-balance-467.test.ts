// Card #467: "Long weekends off" and "Even OR staffing across days", the two lowest priority
// factors. The grader reads the finished grid; a late pass moves one person's OR day from a
// heavier day to a lighter one when no higher factor gets worse.
import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleInput, type AutoScheduleResult, type ScheduleStaff, type AutoGenFactorConfig } from "../auto-scheduler";
import { dayBalanceSpread } from "../day-balance";
import { gradedIsOff, paddedOffCalendar, scoreOffRuns } from "../long-weekends";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import type { TestShift } from "./test-day-caps";

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const shift = (id: string, code: string, o: Partial<TestShift> = {}): TestShift => ({
  id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
  countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
  sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
  ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
});
const OR = shift("st-or", "OR", { schedulePriority: 30, isFillShift: true });
const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const ADM = shift("st-adm", "ADM");
const person = (id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off", "st-adm"], availabilityRules: avail([1, 2, 3, 4, 5]),
  isActive: true, isAutoScheduled: true, specialQualifications: [], ...o,
});
const WEEK = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"]; // Mon … Fri
const PREFS_OFF = { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 };
const PREFS_LW = { ...PREFS_OFF, prefer3DayWeekends: true, threeDayWeekendWeight: 5, preferSequentialOff: true, sequentialOffWeight: 2 };
const orReqs = (min: number, preferred = 0) => ["1", "2", "3", "4", "5"].map((dayKey) => ({ shiftTypeId: "st-or", dayKey, minCount: min, preferredCount: preferred }));
const order = (keys: string[]): AutoGenFactorConfig[] => keys.map((key, i) => ({ key, sortOrder: i, enabled: true }));
const DEFAULT8 = ["hardLimits", "coverage", "overHours", "underHours", "requests", "fairness", "longWeekends", "dayBalance"];
const BALANCE_FIRST = ["hardLimits", "coverage", "overHours", "underHours", "requests", "fairness", "dayBalance", "longWeekends"];

function input(o: Partial<AutoScheduleInput> = {}): AutoScheduleInput {
  return {
    dates: WEEK,
    staff: ["a", "b", "c", "d"].map((id) => person(id, { ftePercentage: 0.6 })),
    shiftTypes: [OR, OFF, ADM],
    existingAssignments: [],
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [],
    staffingRequirements: orReqs(1),
    schedulingPreferences: PREFS_OFF,
    equityFactors: [], followRules: [],
    ...o,
  };
}
const cell = (r: AutoScheduleResult, staffId: string, date: string) =>
  r.suggestions.filter((s) => s.staffId === staffId && s.date === date).map((s) => s.code).pop();
const orCounts = (r: AutoScheduleResult, staffIds: string[]) => WEEK.map((d) => staffIds.filter((id) => cell(r, id, d) === "OR").length);
const orDaysOf = (r: AutoScheduleResult, id: string) => WEEK.filter((d) => cell(r, id, d) === "OR").length;

describe("dayBalanceSpread", () => {
  it("is n·Σc² − (Σc)²: zero when even, larger as days pile up", () => {
    expect(dayBalanceSpread([6, 11, 6, 7, 8])).toBe(86);
    expect(dayBalanceSpread([7, 8, 7, 8, 8])).toBe(6);
    expect(dayBalanceSpread([7, 7, 7])).toBe(0);
    expect(dayBalanceSpread([])).toBe(0);
    expect(dayBalanceSpread([5])).toBe(0);
  });
});

describe("the long-weekend score of the finished grid", () => {
  const prefs = PREFS_LW;
  it("a worked Saturday or holiday is not off; a blank day in the run is", () => {
    expect(gradedIsOff(false, true, true, false)).toBe(false); // worked Saturday
    expect(gradedIsOff(false, true, false, true)).toBe(false); // worked holiday
    expect(gradedIsOff(true, true, false, false)).toBe(true); // X / leave
    expect(gradedIsOff(undefined, true, false, false)).toBe(true); // blank in the run: STEP 4's X
    expect(gradedIsOff(undefined, false, true, false)).toBe(true); // outside the run: a weekend
    expect(gradedIsOff(undefined, false, false, false)).toBe(false); // outside the run: a weekday
  });
  it("Friday off before a worked Saturday is no long weekend", () => {
    const off = new Set(["2025-05-16"]);
    const free = paddedOffCalendar("2025-05-12", "2025-05-16", [1, 2, 3, 4, 5], (d, nonWork) => nonWork || off.has(d));
    const workedSat = paddedOffCalendar("2025-05-12", "2025-05-16", [1, 2, 3, 4, 5], (d, nonWork) => (nonWork && d !== "2025-05-17") || off.has(d));
    expect(scoreOffRuns(free, prefs)).toBeGreaterThan(scoreOffRuns(workedSat, prefs));
    // Fri + Sun with Saturday worked: two one-day runs plus the earlier weekend.
    expect(scoreOffRuns(workedSat, prefs)).toBe(2);
  });
});

describe("the quality reports both new factors", () => {
  it("long weekends = minus everyone's score on the actual cells; day balance from the fill counts", () => {
    // Card #743's week: p1 0.6 FTE (two free days off), p2/p3 full time, p2 on a locked ADM Friday.
    const r = autoSchedule(input({
      staff: [person("p1", { ftePercentage: 0.6 }), person("p2"), person("p3")],
      staffingRequirements: [],
      schedulingPreferences: PREFS_LW,
      existingAssignments: [{ staffId: "p2", date: "2025-05-16", shiftTypeId: "st-adm", code: "ADM", isLocked: true }],
    }));
    // Long weekends win by default: p1 keeps Monday and Friday off.
    expect(WEEK.filter((d) => cell(r, "p1", d) === "X")).toEqual(["2025-05-12", "2025-05-16"]);
    // p1: Sat-Sun-Mon and Fri-Sat-Sun (9 each); p2, p3: two plain weekends (2 each).
    expect(r.quality.breakdown.longWeekends).toBe(-26);
    // No OR staffing requirement on any weekday → no day is evened out.
    expect(r.quality.breakdown.dayBalance).toBe(0);
    expect(r.quality.rank.length).toBe(8);
  });

  it("day balance counts the run's OR cells on weekdays with an OR requirement", () => {
    const r = autoSchedule(input());
    const counts = orCounts(r, ["a", "b", "c", "d"]);
    expect(r.quality.breakdown.dayBalance).toBe(dayBalanceSpread(counts));
  });
});

describe("the even-staffing pass", () => {
  it("evens out the OR headcount without changing anyone's hours", () => {
    const ids = ["a", "b", "c", "d"];
    const without = autoSchedule(input({ skipDayBalancePass: true }));
    const r = autoSchedule(input());
    for (const id of ids) expect(orDaysOf(r, id)).toBe(orDaysOf(without, id));
    expect(r.quality.breakdown.dayBalance).toBeLessThanOrEqual(without.quality.breakdown.dayBalance);
    const counts = orCounts(r, ids);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // Every higher factor is unchanged.
    expect(r.quality.rank.slice(0, 6)).toEqual(without.quality.rank.slice(0, 6));
  });

  it("long weekends win by default; ranking even staffing above them lets it trade them", () => {
    const ids = ["a", "b", "c", "d"];
    const lwFirst = autoSchedule(input({ schedulingPreferences: PREFS_LW, factorOrder: order(DEFAULT8) }));
    const balFirst = autoSchedule(input({ schedulingPreferences: PREFS_LW, factorOrder: order(BALANCE_FIRST) }));
    const none = autoSchedule(input({ schedulingPreferences: PREFS_LW, skipDayBalancePass: true }));
    // With long weekends above, the pass never makes them worse.
    expect(lwFirst.quality.breakdown.longWeekends).toBeLessThanOrEqual(none.quality.breakdown.longWeekends);
    // With even staffing above, days end at least as even, and never less even than with long weekends first.
    expect(balFirst.quality.breakdown.dayBalance).toBeLessThanOrEqual(lwFirst.quality.breakdown.dayBalance);
    const counts = orCounts(balFirst, ids);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    for (const id of ids) expect(orDaysOf(balFirst, id)).toBe(orDaysOf(none, id));
  });

  it("never moves a fill day onto a day the person asked (softly) to have off", () => {
    const ids = ["a", "b", "c", "d"];
    const soft = ids.flatMap((staffId, i) => WEEK.filter((_, j) => j === (i + 1) % 5 || j === (i + 3) % 5).map((d, k) => ({
      id: `q-${staffId}-${k}`, staffId, startDate: d, endDate: d, kind: "OFF" as const, shiftTypeIds: [], leaveShiftTypeId: null, strength: "soft" as const, status: "approved" as const,
    })));
    const without = autoSchedule(input({ scheduleRequests: soft, skipDayBalancePass: true }));
    const r = autoSchedule(input({ scheduleRequests: soft }));
    for (const q of soft) {
      if (cell(without, q.staffId, q.startDate) !== "OR") expect(cell(r, q.staffId, q.startDate)).not.toBe("OR");
    }
  });

  it("tries another light day when the lightest day can't take anyone ([11,6,7] case)", () => {
    // Everyone works Monday (locked, so counts never move there); Tuesday is light but nobody is
    // available Tuesday, so the move must go to Wednesday instead.
    const staff = ["a", "b", "c", "d"].map((id) => person(id, { ftePercentage: 0.6, availabilityRules: avail([1, 3, 4, 5]) }));
    const r = autoSchedule(input({ staff }));
    const without = autoSchedule(input({ staff, skipDayBalancePass: true }));
    expect(WEEK.filter((_, j) => j === 1).every((d) => ["a", "b", "c", "d"].every((id) => cell(r, id, d) !== "OR"))).toBe(true);
    expect(r.quality.breakdown.dayBalance).toBeLessThanOrEqual(without.quality.breakdown.dayBalance);
    const counts = orCounts(r, ["a", "b", "c", "d"]).filter((_, j) => j !== 1);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("keeps a conditional rule ('EF only when AB works') intact", () => {
    const ef = person("ef", { ftePercentage: 0.6, availabilityRules: [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, conditionStaffId: "a", conditionType: "working" as const, ...wEvery(d) })) });
    const staff = [person("a", { ftePercentage: 0.6 }), person("b", { ftePercentage: 0.6 }), person("c", { ftePercentage: 0.6 }), ef];
    const r = autoSchedule(input({ staff }));
    for (const d of WEEK) if (cell(r, "ef", d) === "OR") expect(cell(r, "a", d)).toBe("OR");
  });

  it("never takes a day below its OR minimum", () => {
    const r = autoSchedule(input({ staffingRequirements: orReqs(2) }));
    for (const c of orCounts(r, ["a", "b", "c", "d"])) expect(c).toBeGreaterThanOrEqual(2);
  });
});

describe("the Live input bundle and the Settings labels (card #467)", () => {
  it("sends the two new rows only to a browser that lists them", async () => {
    const { factorsForClient, FACTORS_HEADER, LATER_FACTOR_KEYS } = await import("../autogen-factor-order");
    const { DEFAULT_FACTOR_ORDER } = await import("../auto-scheduler");
    expect(FACTORS_HEADER).toBe("x-yosched-factors");
    const rows = DEFAULT_FACTOR_ORDER.map((key, i) => ({ key, sortOrder: i }));
    // An older tab (no header) gets the six rows its engine knows.
    expect(factorsForClient(rows, null).map((r) => r.key)).toEqual(DEFAULT_FACTOR_ORDER.slice(0, 6));
    expect(factorsForClient(rows, "").map((r) => r.key)).not.toContain("dayBalance");
    // This build lists every key it knows.
    expect(factorsForClient(rows, DEFAULT_FACTOR_ORDER.join(",")).map((r) => r.key)).toEqual([...DEFAULT_FACTOR_ORDER]);
    // A browser that knows only one of them gets only that one; other rows are never dropped.
    expect(factorsForClient(rows, "longWeekends").map((r) => r.key)).toEqual(DEFAULT_FACTOR_ORDER.slice(0, 7));
    expect(factorsForClient([{ key: "spacing" }, { key: "bogus" }], null).map((r) => r.key)).toEqual(["spacing", "bogus"]);
    expect([...LATER_FACTOR_KEYS]).toEqual(DEFAULT_FACTOR_ORDER.slice(6));
  });

  it("every factor has a Settings label", async () => {
    const { FACTOR_META } = await import("../autogen-priority");
    const { DEFAULT_FACTOR_ORDER } = await import("../auto-scheduler");
    for (const k of DEFAULT_FACTOR_ORDER) expect(FACTOR_META[k]?.label, k).toBeTruthy();
    expect(FACTOR_META.longWeekends.label).toBe("Long weekends off");
    expect(FACTOR_META.dayBalance.label).toBe("Even OR staffing across days");
  });
});

// Codex #2401 regressions: a move is kept only when day balance improves and NO factor ranked
// above it gets worse; fairness counts the X a blank day becomes; avoided pairs never grow.
describe("the even-staffing pass never pays with a higher factor (Codex #2401)", () => {
  const FORTNIGHT = [...WEEK, "2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
  const base = (o: Partial<AutoScheduleInput> = {}) => input({
    dates: FORTNIGHT,
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }],
    schedulingPreferences: PREFS_LW,
    ...o,
  });
  const avoidedPairs = (r: AutoScheduleResult, ids: string[], a: string, b: string) => {
    let n = 0;
    for (const id of ids) for (let i = 0; i + 1 < FORTNIGHT.length; i++) {
      if (cell(r, id, FORTNIGHT[i]) === a && cell(r, id, FORTNIGHT[i + 1]) === b) n++;
    }
    return n;
  };

  it("an OR desirability weight never lets fairness pay for worse long weekends (default order)", () => {
    const w = { desirabilityWeights: [{ shiftTypeId: "st-or", dayOfWeek: 3, weight: 2 }] };
    const r = autoSchedule(base(w));
    const without = autoSchedule(base({ ...w, skipDayBalancePass: true }));
    expect(r.quality.breakdown.fairnessSpread).toBeLessThanOrEqual(without.quality.breakdown.fairnessSpread);
    expect(r.quality.breakdown.longWeekends).toBeLessThanOrEqual(without.quality.breakdown.longWeekends);
    for (let i = 0; i < 7; i++) if (r.quality.rank[i] !== without.quality.rank[i]) expect(r.quality.rank[i]).toBeLessThan(without.quality.rank[i]);
  });

  it("fairness counts the X a blank day becomes", () => {
    const w = { desirabilityWeights: [
      { shiftTypeId: "st-or", dayOfWeek: 1, weight: 2 }, { shiftTypeId: "st-or", dayOfWeek: 2, weight: 2 },
      { shiftTypeId: "st-off", dayOfWeek: 1, weight: 2 },
    ] };
    const r = autoSchedule(base(w));
    const without = autoSchedule(base({ ...w, skipDayBalancePass: true }));
    expect(r.quality.breakdown.fairnessSpread).toBeLessThanOrEqual(without.quality.breakdown.fairnessSpread);
  });

  it("never adds a soft-avoided pair (OR before X)", () => {
    const avoid = { followAvoids: [{ sourceShiftId: "st-or", avoidShiftId: "st-off" }] };
    const ids = ["a", "b", "c", "d"];
    const r = autoSchedule(base(avoid));
    const without = autoSchedule(base({ ...avoid, skipDayBalancePass: true }));
    expect(avoidedPairs(r, ids, "OR", "X")).toBeLessThanOrEqual(avoidedPairs(without, ids, "OR", "X"));
  });
});
