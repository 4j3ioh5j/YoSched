import { describe, it, expect } from "vitest";
import { buildDayCapLookup, dayKeyOf, dayKeyLabel, dayCapMessage } from "../day-cap";
import { dayCapViolations } from "../max-per-day";

// Staffing Rules "Max": per (shift, dayKey) cap. 2025-05-12 = Monday, 2025-05-17 = Saturday.
const MON = "2025-05-12";
const TUE = "2025-05-13";
const SAT = "2025-05-17";
const row = (shiftTypeId: string, dayKey: string, maxCount: number | null) => ({ shiftTypeId, dayKey, maxCount });

describe("dayKeyOf / labels", () => {
  it("uses the weekday, Sunday = 0", () => {
    expect(dayKeyOf(MON, new Set())).toBe("1");
    expect(dayKeyOf(SAT, new Set())).toBe("6");
    expect(dayKeyOf("2025-05-11", new Set())).toBe("0");
  });
  it("a holiday beats its weekday", () => {
    expect(dayKeyOf(MON, new Set([MON]))).toBe("holiday");
  });
  it("labels days and holidays; an unknown key reads 'per day'", () => {
    expect(dayKeyLabel("1")).toBe("on Mondays");
    expect(dayKeyLabel("holiday")).toBe("on holidays");
    expect(dayKeyLabel("bogus")).toBe("per day");
    expect(dayCapMessage("ORC", 1, MON, [])).toBe("Only 1 ORC allowed on Mondays");
    expect(dayCapMessage("ORC", 1, MON, [MON])).toBe("Only 1 ORC allowed on holidays");
  });
});

describe("buildDayCapLookup", () => {
  it("no row, a NULL Max, or an unknown shift id all mean no limit", () => {
    const capOf = buildDayCapLookup([row("st-orc", "1", null)], []);
    expect(capOf("st-orc", MON)).toBeNull(); // NULL Max
    expect(capOf("st-orc", TUE)).toBeNull(); // no row
    expect(capOf("st-ghost", MON)).toBeNull(); // unknown shift
  });

  it("0 means none allowed (not 'no limit')", () => {
    const capOf = buildDayCapLookup([row("st-orc", "6", 0)], []);
    expect(capOf("st-orc", SAT)).toBe(0);
    expect(dayCapViolations([{ staffId: "a", date: SAT, shiftTypeId: "st-orc" }], [], capOf)).toHaveLength(1);
  });

  it("differs by day: Mon 2, Sat 1", () => {
    const capOf = buildDayCapLookup([row("st-orc", "1", 2), row("st-orc", "6", 1)], []);
    const two = (date: string) => [
      { staffId: "a", date, shiftTypeId: "st-orc" },
      { staffId: "b", date, shiftTypeId: "st-orc" },
    ];
    expect(dayCapViolations(two(MON), [], capOf)).toHaveLength(0);
    expect(dayCapViolations(two(SAT), [], capOf)).toEqual([{ staffId: "b", date: SAT, shiftTypeId: "st-orc" }]);
  });

  it("on a holiday the holiday Max wins over the weekday Max, both ways", () => {
    const reqs = [row("st-orc", "1", 1), row("st-orc", "holiday", 3)];
    expect(buildDayCapLookup(reqs, [MON])("st-orc", MON)).toBe(3);
    expect(buildDayCapLookup(reqs, [])("st-orc", MON)).toBe(1);
    // No holiday row: a holiday Monday has no limit (it does NOT fall back to Monday's).
    expect(buildDayCapLookup([row("st-orc", "1", 1)], [MON])("st-orc", MON)).toBeNull();
  });

  it("is keyed by code, so a cap on ORC never limits OR", () => {
    const capOf = buildDayCapLookup([row("st-orc", "1", 1)], []);
    expect(capOf("st-or", MON)).toBeNull();
  });
});

// ── Engine: auto-generate honours a per-day Max that differs by weekday ──
import { autoSchedule, type ScheduleStaff, type ScheduleShiftType, type AutoScheduleInput } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";

describe("auto-generate reads Staffing Rules Max per day", () => {
  const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
  const staff = (id: string): ScheduleStaff => ({
    id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true, eligibleShiftTypeIds: ["st-orc", "st-off"],
    availabilityRules: [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })),
    isActive: true, isAutoScheduled: true, specialQualifications: [],
  });
  const shift = (id: string, code: string, o: Partial<ScheduleShiftType> = {}): ScheduleShiftType => ({
    id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
    countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
    sortOrder: 0, schedulePriority: 20, weekendPaired: false, holidayWeekendPaired: false,
    ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
  });
  const input = (holidays: string[] = []): AutoScheduleInput => ({
    dates: [MON, TUE],
    staff: [staff("aa"), staff("bb"), staff("cc")],
    shiftTypes: [shift("st-orc", "ORC"), shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false, schedulePriority: null })],
    existingAssignments: [],
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }],
    holidays: holidays.map((date) => ({ date, name: "H" })) as AutoScheduleInput["holidays"],
    desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [], historicalAssignments: [],
    // Want three ORC each day; Max is 2 on Mondays, 1 on Tuesdays, 0 on holidays.
    staffingRequirements: [
      { shiftTypeId: "st-orc", dayKey: "1", minCount: 3, maxCount: 2 },
      { shiftTypeId: "st-orc", dayKey: "2", minCount: 3, maxCount: 1 },
      { shiftTypeId: "st-orc", dayKey: "holiday", minCount: 0, maxCount: 0 },
    ],
    schedulingPreferences: {
      prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false,
      sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3,
      pendingRequestMode: "full", requestConflictPolicy: "reconcile",
    },
    equityFactors: [], followRules: [],
  } as unknown as AutoScheduleInput);
  const orc = (r: ReturnType<typeof autoSchedule>, date: string) => r.suggestions.filter((s) => s.code === "ORC" && s.date === date).length;

  it("places 2 ORC on Monday and 1 on Tuesday", () => {
    const r = autoSchedule(input());
    expect(orc(r, MON)).toBe(2);
    expect(orc(r, TUE)).toBe(1);
  });

  it("a holiday Monday uses the holiday Max (0), not Monday's", () => {
    const r = autoSchedule(input([MON]));
    expect(orc(r, MON)).toBe(0);
    expect(orc(r, TUE)).toBe(1);
  });
});

// ── Direct placement paths that skip isAvailable must still honour the day's Max ──
import { standingToWhen } from "../recurrence";

describe("Max applies to standing commitments and required followers", () => {
  const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
  const staff = (id: string, elig: string[]): ScheduleStaff => ({
    id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true, eligibleShiftTypeIds: elig,
    availabilityRules: [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })),
    isActive: true, isAutoScheduled: true, specialQualifications: [],
  });
  const shift = (id: string, code: string, o: Partial<ScheduleShiftType> = {}): ScheduleShiftType => ({
    id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
    countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
    sortOrder: 0, schedulePriority: 20, weekendPaired: false, holidayWeekendPaired: false,
    ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
  });
  const ORC = shift("st-orc", "ORC");
  const ADM = shift("st-adm", "ADM", { autoSchedulable: false, schedulePriority: null });
  const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false, schedulePriority: null });
  const base = (o: Partial<AutoScheduleInput>): AutoScheduleInput => ({
    dates: [MON, TUE],
    staff: [staff("aa", ["st-orc", "st-adm", "st-off"])],
    shiftTypes: [ORC, ADM, OFF],
    existingAssignments: [],
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [], historicalAssignments: [],
    staffingRequirements: [],
    schedulingPreferences: {
      prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false,
      sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3,
      pendingRequestMode: "full", requestConflictPolicy: "reconcile",
    },
    equityFactors: [], followRules: [],
    ...o,
  } as unknown as AutoScheduleInput);
  const at = (r: ReturnType<typeof autoSchedule>, date: string, code: string) =>
    r.suggestions.filter((s) => s.date === date && s.code === code).length;
  const standing = [{ staffId: "aa", shiftTypeId: "st-orc", ...whenToColumns(standingToWhen({ dayOfWeek: 1, frequency: "weekly" })) }];

  it("a Monday standing ORC is not placed when Monday's ORC Max is 0, and says why", () => {
    const r = autoSchedule(base({
      standingCommitments: standing,
      staffingRequirements: [{ shiftTypeId: "st-orc", dayKey: "1", minCount: 0, maxCount: 0 }],
    } as Partial<AutoScheduleInput>));
    expect(at(r, MON, "ORC")).toBe(0);
    expect(r.warnings.some((w) => w.includes("standing ORC") && w.includes("Max"))).toBe(true);
  });

  it("control: with no Max the standing ORC is placed", () => {
    const r = autoSchedule(base({ standingCommitments: standing } as Partial<AutoScheduleInput>));
    expect(at(r, MON, "ORC")).toBe(1);
  });

  // ORC comes from Monday's coverage minimum; its follower is placed inline.
  const orcMonMin = { shiftTypeId: "st-orc", dayKey: "1", minCount: 1 };
  const follower = {
    staffingRequirements: [orcMonMin],
    requiredFollowers: [{ sourceShiftId: "st-orc", followerShiftId: "st-adm", scope: "each_day", countsTowardTargets: true }],
  };

  it("a required ADM after ORC is not placed when Tuesday's ADM Max is 0, and says why", () => {
    const r = autoSchedule(base({
      ...follower,
      staffingRequirements: [orcMonMin, { shiftTypeId: "st-adm", dayKey: "2", minCount: 0, maxCount: 0 }],
    } as Partial<AutoScheduleInput>));
    expect(at(r, MON, "ORC")).toBe(1);
    expect(at(r, TUE, "ADM")).toBe(0);
    expect(r.warnings.some((w) => w.includes("required ADM") && w.includes("Max"))).toBe(true);
  });

  it("control: with no Max the required ADM follows the ORC", () => {
    const r = autoSchedule(base(follower as Partial<AutoScheduleInput>));
    expect(at(r, TUE, "ADM")).toBe(1);
  });
});
