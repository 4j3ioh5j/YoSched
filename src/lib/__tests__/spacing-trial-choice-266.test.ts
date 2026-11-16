// Card #266: the trial's choice logic, with the engine run replaced (coreForTest) so each
// candidate's quality and per-item maps are exactly what the test says.
import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleInput, type AutoScheduleResult, type QualityItems } from "../auto-scheduler";

const DATES = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16", "2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const st = (id: string, code: string, schedulePriority: number) => ({
  id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0, countsTowardFte: true, countsAsHolidayWork: true,
  isLeave: false, isOffShift: false, isFillShift: false, sortOrder: 0, schedulePriority, weekendPaired: false, holidayWeekendPaired: false,
  ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, spreadOverMonth: true, minGapDays: null,
});
const input = {
  dates: DATES, staff: [], shiftTypes: [st("st-a", "A", 1), st("st-b", "B", 2)], existingAssignments: [], payPeriods: [],
  holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [], historicalAssignments: [],
  staffingRequirements: [], equityFactors: [], followRules: [],
  schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
} as unknown as AutoScheduleInput;

type Setting = { n: number | null; s: string | null };
const settingOf = (inp: AutoScheduleInput, id: string): Setting => {
  const x = inp.shiftTypes.find((t) => t.id === id) as unknown as { minGapDays: number | null; minGapStrength?: string };
  return { n: x.minGapDays ?? null, s: x.minGapDays == null ? null : x.minGapStrength ?? null };
};
// Two units for P in each marked shift, so the trial tries both.
const units = () => new Map([["p", [{ start: DATES[0], end: DATES[0] }, { start: DATES[3], end: DATES[3] }]]]);

function fake(score: (a: Setting, b: Setting) => { rank: number; under: number }, seen: AutoScheduleInput[] = []) {
  return (inp: AutoScheduleInput, items: QualityItems): AutoScheduleResult => {
    seen.push(inp);
    const { rank, under } = score(settingOf(inp, "st-a"), settingOf(inp, "st-b"));
    items.underHours.set("p|2025-05-11", under);
    items.spacingUnits.set("st-a", units());
    items.spacingUnits.set("st-b", units());
    return { suggestions: [], warnings: [], quality: { rank: [rank], breakdown: {} } } as unknown as AutoScheduleResult;
  };
}

describe("the spacing trial's choice (card #266)", () => {
  it("guards each candidate against the OFF run, not against the best kept so far", () => {
    // Off: P is 8 h under. A at 2 days (Prefer) lowers it to 4 h and ranks better: kept.
    // B at 3 days (Hard), on top of that, gives 6 h: worse than the kept 4 but not worse than
    // off's 8, and it ranks better still, so it is kept.
    const r = autoSchedule(input, { coreForTest: fake((a, b) => {
      const aKept = a.n === 2 && a.s === "preference";
      if (aKept && b.n === 3 && b.s === "rule") return { rank: 8, under: 6 };
      if (aKept && b.n == null) return { rank: 9, under: 4 };
      return { rank: 10, under: 8 };
    }) });
    expect(r.quality.rank).toEqual([8]);
    expect(r.warnings.join("\n")).toMatch(/^A: kept 2 days apart \(Prefer\)/m);
    expect(r.warnings.join("\n")).toMatch(/^B: kept 3 days apart \(Hard\)/m);
  });

  it("searches one shift at a time: B's tries start from the setting kept for A", () => {
    const seen: AutoScheduleInput[] = [];
    autoSchedule(input, { coreForTest: fake((a) => (a.n === 5 && a.s === "rule" ? { rank: 9, under: 8 } : { rank: 10, under: 8 }), seen) });
    const bTries = seen.filter((inp) => settingOf(inp, "st-b").n != null);
    expect(bTries.length).toBeGreaterThan(0);
    for (const inp of bTries) expect(settingOf(inp, "st-a")).toEqual({ n: 5, s: "rule" });
  });
});
