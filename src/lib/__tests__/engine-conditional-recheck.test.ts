// Card #73: conditional availability rules ("AB only when CD is / is NOT working") are checked
// when AB is placed; a later placement of CD (or CD's removal) used to break them silently.
// The engine now re-checks them on the finished grid: it frees the rule owner's engine-placed
// cell (warned), keeps standing / follower cells (warned), and never touches human cells.
import { describe, it, expect } from "vitest";
import { autoSchedule as autoScheduleRaw, type ScheduleStaff, type AutoScheduleResult } from "../auto-scheduler";
import { withDayCaps, type TestShift } from "./test-day-caps";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";

type Input = Parameters<typeof autoScheduleRaw>[0];
const autoSchedule = (input: Input) => autoScheduleRaw(withDayCaps(input));
const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const WEEKDAYS = [1, 2, 3, 4, 5];
const plain = () => WEEKDAYS.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));

function staff(id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff {
  return {
    id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
    eligibleShiftTypeIds: ["st-or", "st-off", "st-orc"],
    availabilityRules: plain(),
    isActive: true, isAutoScheduled: true, specialQualifications: [],
    ...o,
  };
}
function shift(id: string, code: string, o: Partial<TestShift> = {}): TestShift {
  return {
    id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
    countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
    sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
    ignoresWorkingDays: false, category: "clinical", autoSchedulable: true,
    ...o,
  };
}
const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = shift("st-or", "OR", { schedulePriority: 100, isFillShift: true });
const ORC = shift("st-orc", "ORC", { schedulePriority: 50 });
const LEAVE = shift("st-vac", "VAC", { isLeave: true, countsTowardFte: true, autoSchedulable: false });

const DATES = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16",
  "2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const MON = DATES[0];
const ORC_MIN = ["1", "2", "3", "4", "5"].map((dayKey) => ({ shiftTypeId: "st-orc", dayKey, minCount: 1 }));

type Existing = { staffId: string; date: string; shiftTypeId: string; code: string; isLocked: boolean; source: string };
function input(people: ScheduleStaff[], o: Partial<Input> = {}): Input {
  return {
    dates: DATES,
    staff: people,
    shiftTypes: [OR, ORC, LEAVE, OFF],
    existingAssignments: [],
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [],
    staffingRequirements: [],
    schedulingPreferences: {
      prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false,
      sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3,
      pendingRequestMode: "full", requestConflictPolicy: "reconcile",
    },
    equityFactors: [], followRules: [], requiredFollowers: [], scheduleRequests: [],
    ...o,
  } as Input;
}
const run = (people: ScheduleStaff[], o: Partial<Input> = {}): AutoScheduleResult => autoSchedule(input(people, o));

const cond = (on: string, t: "working" | "not_working") => WEEKDAYS.map((d) => ({
  type: "available" as const, strength: "rule" as const, conditionStaffId: on, conditionType: t, ...wEvery(d),
}));

// The finished grid: suggestions plus the human cells the engine kept.
function finalGrid(r: AutoScheduleResult, existing: Existing[] = []) {
  const g = new Map<string, string>();
  for (const e of existing) g.set(`${e.staffId}:${e.date}`, e.code);
  for (const s of r.suggestions) g.set(`${s.staffId}:${s.date}`, s.code);
  return g;
}
const AWAY = new Set(["X", "VAC"]);
const working = (g: Map<string, string>, id: string, d: string) => { const c = g.get(`${id}:${d}`); return !!c && !AWAY.has(c); };

describe("card #73 — conditional rules re-checked on the finished grid", () => {
  it("'AB only when CD is NOT working': no day has both working, each removal is warned (the reviewer's repro)", () => {
    const r = run([staff("ab", { availabilityRules: cond("cd", "not_working") }), staff("cd")]);
    const g = finalGrid(r);
    for (const d of DATES) expect(working(g, "ab", d) && working(g, "cd", d), d).toBe(false);
    const removed = DATES.filter((d) => !working(g, "ab", d));
    expect(removed.length).toBeGreaterThan(0);
    for (const d of removed) expect(r.warnings.some((w) => w.startsWith(`AB ${d}:`) && w.includes("CD"))).toBe(true);
  });

  it("every removed cell ends as X, with no orphan suggestion and one suggestion per cell", () => {
    const r = run([staff("ab", { availabilityRules: cond("cd", "not_working") }), staff("cd")]);
    const keys = r.suggestions.map((s) => `${s.staffId}:${s.date}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of DATES) expect(keys).toContain(`ab:${d}`);
    expect(r.stats.totalSlotsFilled).toBe(r.suggestions.length);
    const counted = Object.values(r.stats.byStep).reduce((a, b) => a + b, 0);
    expect(counted).toBeGreaterThanOrEqual(r.suggestions.length);
  });

  it("'only when CD IS working' chains: freeing one owner frees its dependents (fixpoint)", () => {
    // CD only when GH is NOT working; AB only when CD works; EF only when AB works. GH is placed
    // last, after CD, AB and EF were placed in that order, so the recheck frees CD, which
    // breaks AB, which breaks EF.
    const r = run([
      staff("cd", { availabilityRules: cond("gh", "not_working") }),
      staff("ab", { availabilityRules: cond("cd", "working") }),
      staff("ef", { availabilityRules: cond("ab", "working") }),
      staff("gh"),
    ]);
    const g = finalGrid(r);
    for (const d of DATES) {
      if (working(g, "cd", d)) expect(working(g, "gh", d), `cd ${d}`).toBe(false);
      if (working(g, "ab", d)) expect(working(g, "cd", d), `ab ${d}`).toBe(true);
      if (working(g, "ef", d)) expect(working(g, "ab", d), `ef ${d}`).toBe(true);
    }
    for (const who of ["CD", "AB", "EF"]) expect(r.warnings.some((w) => w.startsWith(`${who} `) && w.includes("removed")), who).toBe(true);
  });

  it("a dependent checked before its freed owner is caught on a later pass (fixpoint)", () => {
    // AB gets ORC from the staffing step (only AB may work ORC) while GH is still free; EF is
    // filled next to AB; GH is filled last and breaks AB. EF is listed first, so the first
    // pass sees AB still working; only the second pass frees EF.
    const noOrc = ["st-or", "st-off"];
    const r = run([
      staff("ef", { availabilityRules: cond("ab", "working"), eligibleShiftTypeIds: noOrc }),
      staff("ab", { availabilityRules: cond("gh", "not_working") }),
      staff("gh", { eligibleShiftTypeIds: noOrc }),
    ], { staffingRequirements: ORC_MIN });
    const g = finalGrid(r);
    for (const d of DATES) {
      if (working(g, "ab", d)) expect(working(g, "gh", d), `ab ${d}`).toBe(false);
      if (working(g, "ef", d)) expect(working(g, "ab", d), `ef ${d}`).toBe(true);
    }
    expect(r.warnings.some((w) => w.startsWith("AB ") && w.includes("removed"))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith("EF ") && w.includes("removed"))).toBe(true);
    // The ORC minimum AB held is now open: the coverage audit (after the recheck) reports and scores it.
    expect(r.warnings.some((w) => /ORC below its required minimum/.test(w))).toBe(true);
    expect(r.quality.breakdown.coverageShortfall).toBeGreaterThan(0);
  });

  it("a later placement that breaks the rule is undone for 'NOT working' with a staffing minimum on CD's shift", () => {
    const r = run([staff("ab", { availabilityRules: cond("cd", "not_working"), eligibleShiftTypeIds: ["st-or", "st-off"] }), staff("cd")], {
      staffingRequirements: ORC_MIN,
    });
    const g = finalGrid(r);
    for (const d of DATES) expect(working(g, "ab", d) && working(g, "cd", d), d).toBe(false);
  });

  it("human cells are never freed or warned: a locked AB OR beside CD's OR stays", () => {
    const existing: Existing[] = [{ staffId: "ab", date: MON, shiftTypeId: OR.id, code: "OR", isLocked: true, source: "manual" }];
    const r = run([staff("ab", { availabilityRules: cond("cd", "not_working") }), staff("cd")], { existingAssignments: existing });
    expect(r.suggestions.some((s) => s.staffId === "ab" && s.date === MON)).toBe(false);
    expect(r.warnings.some((w) => w.startsWith(`AB ${MON}:`))).toBe(false);
  });

  it("a standing commitment that the rule breaks is kept and warned, not freed", () => {
    const r = run([staff("ab", { availabilityRules: cond("cd", "not_working") }), staff("cd")], {
      standingCommitments: [{ staffId: "ab", shiftTypeId: ORC.id, ...wEvery(1) }] as unknown as Input["standingCommitments"],
    });
    const g = finalGrid(r);
    // ORC was placed on Mondays before CD; if CD then works a Monday, AB's ORC stays with a warning.
    let kept = 0;
    for (const d of DATES.filter((x) => new Date(x + "T00:00:00Z").getUTCDay() === 1)) {
      expect(g.get(`ab:${d}`)).toBe("ORC");
      if (working(g, "cd", d)) {
        kept++;
        expect(r.warnings.some((w) => w.startsWith(`AB ${d}: ORC breaks`) && w.includes("kept: standing commitment"))).toBe(true);
      }
    }
    expect(kept).toBeGreaterThan(0);
  });

  it("no conditional rules → nothing removed, no recheck warnings", () => {
    const r = run([staff("ab"), staff("cd")]);
    expect(r.warnings.filter((w) => w.includes("rule 'only when"))).toEqual([]);
  });

  it("a removal that would put a day off where a follow rule forbids it is kept and warned", () => {
    // After ORC only OR may follow (no day off). AB holds ORC Mon (staffing) and OR Tue; CD is
    // off Mon and filled Tue, which breaks AB's Tue. Freeing Tue would put X right after ORC.
    const TUE = DATES[1];
    const existing: Existing[] = [{ staffId: "cd", date: MON, shiftTypeId: OFF.id, code: "X", isLocked: true, source: "manual" }];
    const r = run([staff("ab", { availabilityRules: cond("cd", "not_working") }), staff("cd", { eligibleShiftTypeIds: ["st-or", "st-off"] })], {
      existingAssignments: existing,
      staffingRequirements: [{ shiftTypeId: "st-orc", dayKey: "1", minCount: 1 }] as unknown as Input["staffingRequirements"],
      followRules: [{ sourceShiftId: "st-orc", allowedShiftId: "st-or", allowOffShifts: false, mode: "allow" }],
    });
    const g = finalGrid(r, existing);
    expect(g.get(`ab:${MON}`)).toBe("ORC");
    expect(working(g, "cd", TUE)).toBe(true);
    expect(g.get(`ab:${TUE}`)).toBe("OR");
    expect(r.warnings.some((w) => w.startsWith(`AB ${TUE}: OR breaks`) && w.includes("kept: a day off is not allowed after the day before"))).toBe(true);
  });

  it("a weekend-paired cell is never split: kept and warned", () => {
    const SAT = "2025-05-17", SUN = "2025-05-18";
    const WK = shift("st-wk", "WK", { weekendPaired: true, schedulePriority: 10 });
    const all = [0, 1, 2, 3, 4, 5, 6];
    const r = run([
      staff("ab", { eligibleShiftTypeIds: ["st-wk", "st-off"], availabilityRules: all.map((d) => ({ type: "available" as const, strength: "rule" as const, conditionStaffId: "cd", conditionType: "not_working" as const, ...wEvery(d) })) }),
      staff("cd", { availabilityRules: all.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })) }),
    ], {
      dates: [...DATES.slice(0, 5), SAT, SUN, ...DATES.slice(5)],
      shiftTypes: [OR, ORC, WK, LEAVE, OFF] as Input["shiftTypes"],
      staffingRequirements: [{ shiftTypeId: "st-wk", dayKey: "6", minCount: 1 }, { shiftTypeId: "st-wk", dayKey: "0", minCount: 1 }] as unknown as Input["staffingRequirements"],
    });
    const g = finalGrid(r);
    expect([g.get(`ab:${SAT}`), g.get(`ab:${SUN}`)]).toEqual(["WK", "WK"]);
    for (const d of [SAT, SUN]) {
      if (working(g, "cd", d)) expect(r.warnings.some((w) => w.startsWith(`AB ${d}: WK breaks`) && w.includes("kept: weekend pair"))).toBe(true);
    }
    expect(working(g, "cd", SAT) || working(g, "cd", SUN)).toBe(true);
  });

  it("a kept break that a later removal heals is not warned (warnings after the fixpoint)", () => {
    // AB's standing ORC Mon breaks once CD is filled Mon; CD is then freed (GH came later),
    // which heals AB. AB is checked before CD in the same pass.
    const r = run([
      staff("ab", { availabilityRules: cond("cd", "not_working") }),
      staff("cd", { availabilityRules: cond("gh", "not_working") }),
      staff("gh"),
    ], { standingCommitments: [{ staffId: "ab", shiftTypeId: ORC.id, ...wEvery(1) }] as unknown as Input["standingCommitments"] });
    const g = finalGrid(r);
    expect(g.get(`ab:${MON}`)).toBe("ORC");
    expect(r.warnings.some((w) => w.startsWith(`CD ${MON}:`) && w.includes("removed"))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith(`AB ${MON}:`))).toBe(false);
  });
});
