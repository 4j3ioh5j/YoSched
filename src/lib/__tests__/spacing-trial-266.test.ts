// Card #266: every generate trials the spacing of marked shifts and keeps the best result whose
// items above spacing are no worse than the off run's.
import { describe, it, expect } from "vitest";
import { autoSchedule, autoScheduleOnceWithItemsForTest, compareScheduleQuality, spacingGuardBlocks, effectiveFactorKeys, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
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


const D = (n: number) => new Date(Date.parse("2025-05-12T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const weekdays = (n: number) => Array.from({ length: n }, (_, i) => D(i)).filter((d) => ![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay()));
const PPS = [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }, { startDate: "2025-05-25", endDate: "2025-06-07", targetHours: 80 }];
const LIVE = ["hardLimits", "coverage", "underHours", "requests", "spacing", "overHours", "fairness"].map((key, i) => ({ key, sortOrder: i, enabled: true, ...(key === "underHours" ? { hoursPolicy: "prohibited" as const } : {}) }));
function orlShape(o: { days?: number; hosts?: number; orlMin?: number; gap?: number | null; marked?: boolean; live?: boolean } = {}) {
  const { days = 12, hosts = 4, orlMin = 2, gap = null, marked = true, live = false } = o;
  const ORLm = shift("st-orl", "ORL", { defaultHours: 12, schedulePriority: 25, spreadOverMonth: marked, ...(gap != null ? { minGapDays: gap, minGapStrength: "rule" as const } : {}) });
  return input({
    dates: weekdays(days),
    payPeriods: PPS,
    staff: ["a", "b", "c", "d", "e"].map((id, i) => staff(id, i < hosts ? {} : { eligibleShiftTypeIds: ["st-or", "st-off", "st-hol", "st-al"] })),
    shiftTypes: [OR, OFF, ORLm, HOL, AL],
    staffingRequirements: [...req("st-or", "OR", 1), ...req("st-orl", "ORL", orlMin, orlMin)],
    ...(live ? { factorOrder: LIVE } : {}),
  });
}
const keptOf = (r: ReturnType<typeof autoSchedule>, code: string) => {
  const m = r.warnings.map((w) => new RegExp(`^${code}: kept (\\d+) days apart \\((Hard|Prefer)\\)`).exec(w)).find(Boolean);
  return m ? { n: Number(m[1]), strength: m[2] === "Hard" ? ("rule" as const) : ("preference" as const) } : null;
};
const withGap = (inp: AutoScheduleInput, id: string, n: number, strength: "rule" | "preference"): AutoScheduleInput =>
  ({ ...inp, shiftTypes: inp.shiftTypes.map((s) => (s.id === id ? { ...s, minGapDays: n, minGapStrength: strength } : s)) });
const strip = (r: ReturnType<typeof autoSchedule>) => ({ ...r, warnings: r.warnings.filter((w) => !/^[A-Z0-9]+: (kept|spacing left)/.test(w)) });

describe("the spacing trial (card #266)", () => {
  it("no marked shift → exactly one run's result", () => {
    const inp = orlShape({ marked: false });
    expect(autoSchedule(inp)).toEqual(autoScheduleOnceWithItemsForTest(inp).result);
  });
  it("spacingTrial: false → exactly one run's result, even with a marked shift", () => {
    const inp = orlShape();
    expect(autoSchedule(inp, { spacingTrial: false })).toEqual(autoScheduleOnceWithItemsForTest(inp).result);
  });
  it("an admin-set gap is the admin's rule: no trial for that shift", () => {
    const inp = orlShape({ gap: 3 });
    expect(autoSchedule(inp)).toEqual(autoScheduleOnceWithItemsForTest(inp).result);
  });
  it("keeps a wider spacing when it ranks better, and names it", () => {
    const inp = orlShape();
    const off = autoScheduleOnceWithItemsForTest(inp).result;
    const r = autoSchedule(inp);
    const kept = keptOf(r, "ORL");
    expect(kept, r.warnings.join("\n")).not.toBeNull();
    expect(compareScheduleQuality(r.quality, off.quality)).toBeLessThan(0);
    // The kept result is exactly the run with that setting.
    expect(strip(r)).toEqual(autoScheduleOnceWithItemsForTest(withGap(inp, "st-orl", kept!.n, kept!.strength)).result);
  });
  it("the same input twice → identical output", () => {
    const inp = orlShape();
    expect(autoSchedule(inp)).toEqual(autoSchedule(inp));
  });
  it("the off run is kept with a reason when nothing wider ranks better", () => {
    const r = autoSchedule(orlShape({ orlMin: 1 }));
    expect(r.warnings).toContain("ORL: spacing left as generated; no wider spacing gave a better schedule");
  });
  // Sweep: whatever is kept, no item of a factor ranked above spacing is worse than off.
  for (const live of [false, true]) for (const days of [12, 19]) for (const hosts of [2, 3, 4]) for (const orlMin of [1, 2]) {
    it(`sweep ${live ? "live" : "default"} order, ${days} days, ${hosts} hosts, ORL ${orlMin}: kept result passes the guard`, () => {
      const inp = orlShape({ days, hosts, orlMin, live });
      const off = autoScheduleOnceWithItemsForTest(inp);
      const r = autoSchedule(inp);
      const kept = keptOf(r, "ORL");
      if (!kept) { expect(strip(r)).toEqual(off.result); return; }
      const run = autoScheduleOnceWithItemsForTest(withGap(inp, "st-orl", kept.n, kept.strength));
      const order = effectiveFactorKeys(inp.factorOrder);
      expect(spacingGuardBlocks(run.items, off.items, order.slice(0, order.indexOf("spacing")))).toBeNull();
      expect(r.quality.breakdown.coverageShortfall).toBeLessThanOrEqual(off.result.quality.breakdown.coverageShortfall);
    }, 30000);
  }
});

describe("items equal totals (card #266)", () => {
  for (const [days, hosts, orlMin] of [[12, 2, 2], [12, 4, 1], [19, 3, 2]] as const) {
    it(`${days} days, ${hosts} hosts, ORL ${orlMin}`, () => {
      const { result, items } = autoScheduleOnceWithItemsForTest(orlShape({ days, hosts, orlMin }));
      const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
      const b = result.quality.breakdown;
      expect(sum(items.coverage)).toBe(b.coverage);
      expect(sum(items.coverageRaw)).toBe(b.coverageShortfall);
      expect(sum(items.hardLimits)).toBe(b.hardLimits);
      expect(sum(items.overHours)).toBe(b.overHours);
      expect(sum(items.underHours)).toBe(b.underHours);
      expect(items.fairness).toBe(b.fairnessSpread);
    });
  }
});

describe("raw coverage is guarded even where the graded term waives it (Codex #1261)", () => {
  // Over two weeks A covers the marked 8-hour M shift on Mondays and Wednesdays; B (also able to)
  // has locked leave on those days, so a gap there is "sanctioned" and the graded coverage stays 0.
  // A gap rule that moves A's Wednesdays to OR would open real gaps: the trial must not keep it.
  it("never keeps a trial that opens a real shortfall", () => {
    const M = shift("st-m", "M", { defaultHours: 8, schedulePriority: 20, spreadOverMonth: true });
    const days = weekdays(12);
    const mw = days.filter((d) => [1, 3].includes(new Date(d + "T12:00:00Z").getUTCDay()));
    const inp = input({
      dates: days,
      staff: [staff("a", { fixedHoursPerPp: 32, eligibleShiftTypeIds: [...ELIG, "st-m"] }), staff("b", { eligibleShiftTypeIds: [...ELIG, "st-m"] }), staff("c")],
      shiftTypes: [OR, OFF, ORL, HOL, AL, M],
      existingAssignments: mw.map((d) => ({ ...manual("b", d, "st-al", "AL"), isLocked: true })),
      staffingRequirements: [...req("st-or", "OR", 1), ...["1", "3"].map((dayKey) => ({ shiftTypeId: "st-m", shiftCode: "M", dayKey, minCount: 1, preferredCount: 1, maxCount: 1 }))],
      factorOrder: LIVE,
    });
    const off = autoScheduleOnceWithItemsForTest(inp).result;
    const r = autoSchedule(inp);
    expect(r.quality.breakdown.coverageShortfall).toBeLessThanOrEqual(off.quality.breakdown.coverageShortfall);
    // And the trial really had such a candidate: Hard 3 alone opens a raw gap the graded term hides.
    const hard3 = autoScheduleOnceWithItemsForTest(withGap(inp, "st-m", 3, "rule")).result;
    expect(hard3.quality.breakdown.coverageShortfall, "fixture: Hard 3 opens a raw gap").toBeGreaterThan(off.quality.breakdown.coverageShortfall);
    expect(hard3.quality.breakdown.coverage, "fixture: the graded term waives it").toBe(off.quality.breakdown.coverage);
  });
});
