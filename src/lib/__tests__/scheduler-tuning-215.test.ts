import { describe, it, expect } from "vitest";
import { autoSchedule, countedHoursFn, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";
import { TUNING_DEFAULTS } from "../scheduler-tuning";
import { checkDayStaffing } from "../constraints";

// Card #215 (David): "they need to go into settings and removed from being hardcoded". Each
// tuning number is a Settings value; the defaults reproduce what the engine always did, and
// each value, once changed, moves the engine.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const ALL = [0, 1, 2, 3, 4, 5, 6];
const staff = (id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off", "st-call"], availabilityRules: avail(ALL),
  isActive: true, isAutoScheduled: true, specialQualifications: [], ...o,
});
const shift = (id: string, code: string, o: Partial<TestShift> = {}): TestShift => ({
  id, code, name: code, defaultHours: 8, defaultHoursWeekend: 8, defaultHoursHoliday: 8,
  countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
  sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
  ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
});
const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = shift("st-or", "OR", { schedulePriority: 30, isFillShift: true });
const PREFS = { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 };
const base = (o: Partial<AutoScheduleInput>): AutoScheduleInput => withDayCaps({
  dates: [], staff: [], shiftTypes: [OFF], existingAssignments: [], payPeriods: [],
  holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
  historicalAssignments: [], staffingRequirements: [], schedulingPreferences: PREFS, equityFactors: [], followRules: [], ...o,
});
const need = (shiftTypeId: string, dayKeys: string[]) => dayKeys.map((dayKey) => ({ shiftTypeId, dayKey, minCount: 1, preferredCount: 1, maxCount: 1 }));
const holder = (r: ReturnType<typeof autoSchedule>, d: string, st: string) => r.suggestions.filter((s) => s.date === d && s.shiftTypeId === st).map((s) => s.staffId);

describe("defaults reproduce the engine as it was (card #215)", () => {
  it("explicit default settings give the same schedule as none", () => {
    const CALL = shift("st-call", "CALL", { schedulePriority: 10, weekendPaired: true, evenAcrossMonths: true, spreadOverMonth: true, countsTowardFte: false });
    const dates = ["2025-06-06", "2025-06-07", "2025-06-08", "2025-06-09", "2025-06-10", "2025-06-13", "2025-06-14", "2025-06-15"];
    const inp = (prefs: AutoScheduleInput["schedulingPreferences"]) => base({
      dates, staff: [staff("a"), staff("b"), staff("c")], shiftTypes: [OFF, CALL],
      payPeriods: [{ startDate: "2025-06-01", endDate: "2025-06-14", targetHours: 0 }, { startDate: "2025-06-15", endDate: "2025-06-28", targetHours: 0 }],
      staffingRequirements: need("st-call", ["0", "1", "2", "5", "6"]), schedulingPreferences: prefs,
    });
    const a = autoSchedule(inp(PREFS));
    const b = autoSchedule(inp({ ...PREFS, ...TUNING_DEFAULTS }));
    expect(b.suggestions).toEqual(a.suggestions);
    expect(b.warnings).toEqual(a.warnings);
  });
});

describe("weekend from Settings (card #215)", () => {
  // Fri 2025-06-06, Sat 07, Sun 08.
  const FRI = "2025-06-06", SAT = "2025-06-07", SUN = "2025-06-08";
  const CALL = shift("st-call", "CALL", { schedulePriority: 10, weekendPaired: true, countsTowardFte: false });
  const inp = (weekendStartDow?: number) => base({
    dates: [FRI, SAT, SUN], staff: [staff("a"), staff("b"), staff("c")], shiftTypes: [OFF, CALL],
    payPeriods: [{ startDate: "2025-06-01", endDate: "2025-06-14", targetHours: 0 }],
    staffingRequirements: need("st-call", ["5", "6", "0"]),
    schedulingPreferences: weekendStartDow === undefined ? PREFS : { ...PREFS, weekendStartDow },
  });

  it("default: Saturday and Sunday are paired", () => {
    const r = autoSchedule(inp());
    expect(holder(r, SAT, "st-call")).toEqual(holder(r, SUN, "st-call"));
    expect(holder(r, FRI, "st-call")).not.toEqual(holder(r, SAT, "st-call"));
  });

  it("Friday + Saturday: Friday and Saturday are paired, Sunday is a weekday on its own", () => {
    const r = autoSchedule(inp(5));
    expect(holder(r, FRI, "st-call")).toHaveLength(1);
    expect(holder(r, SAT, "st-call")).toEqual(holder(r, FRI, "st-call"));
    expect(holder(r, SUN, "st-call")).not.toEqual(holder(r, SAT, "st-call"));
  });

  it("weekend hours follow the setting, request approval's hour count included", () => {
    const WK = shift("st-wk", "WK", { defaultHours: 8, defaultHoursWeekend: 4 });
    const hours = (weekendStartDow: number) => countedHoursFn({ shiftTypes: [WK], staffOverrides: [], holidays: [], schedulingPreferences: { ...PREFS, weekendStartDow } });
    expect([FRI, SAT, SUN].map((d) => hours(6)("a", "st-wk", d))).toEqual([8, 4, 4]);
    expect([FRI, SAT, SUN].map((d) => hours(5)("a", "st-wk", d))).toEqual([4, 4, 8]);
  });

  it("the grid's staffing warning names the day type by the setting", () => {
    const common = { staff: [], assignmentMap: new Map(), shiftTypeMap: new Map([["st-call", { id: "st-call", code: "CALL", isOffShift: false }]]) as never, holidaySet: new Set<string>(), staffingReqs: [{ shiftTypeId: "st-call", dayKey: "5", minCount: 1 }] as never };
    expect(checkDayStaffing({ ...common, date: FRI, weekendStartDow: 6 })[0].message).toContain("(weekday)");
    expect(checkDayStaffing({ ...common, date: FRI, weekendStartDow: 5 })[0].message).toContain("(weekend)");
  });
});

describe("soft request weights from Settings (card #215)", () => {
  const W = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
  const inp = (o: Partial<AutoScheduleInput> = {}) => base({
    dates: W, staff: [staff("a", { availabilityRules: avail([1, 2, 3, 4, 5]) })], shiftTypes: [OR, OFF],
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-17", targetHours: 32 }], ...o,
  });
  const row = (r: ReturnType<typeof autoSchedule>) => W.map((d) => r.suggestions.find((s) => s.date === d)?.code ?? "-").join(" ");
  const SOFT_OFF = [{ id: "q", staffId: "a", startDate: W[2], endDate: W[2], kind: "OFF" as const, strength: "soft" as const, status: "approved" as const, shiftTypeIds: [], leaveShiftTypeId: null }];

  it("a soft day-off request pulls the day off; weight 0 stops it", () => {
    expect(row(autoSchedule(inp()))).toBe("X OR OR OR OR");
    expect(row(autoSchedule(inp({ scheduleRequests: SOFT_OFF })))).toBe("OR OR X OR OR");
    expect(row(autoSchedule(inp({ scheduleRequests: SOFT_OFF, schedulingPreferences: { ...PREFS, softRequestOffWeight: 0 } })))).toBe("X OR OR OR OR");
  });

  it("a soft avoid pair steers the fill's days off; weight 0 stops it", () => {
    const ORL = shift("st-orl", "ORL", { schedulePriority: 25 });
    const ab = staff("a", { availabilityRules: avail([1, 2, 3, 4, 5]), eligibleShiftTypeIds: ["st-or", "st-off", "st-orl"] });
    const pre: ScheduleAssignment[] = [{ staffId: "a", date: W[0], shiftTypeId: "st-orl", code: "ORL", isLocked: false, source: "manual" }];
    const run = (o: Partial<AutoScheduleInput>) => row(autoSchedule(inp({ staff: [ab], shiftTypes: [OR, OFF, ORL], existingAssignments: pre, ...o })));
    const AVOID = [{ sourceShiftId: "st-orl", avoidShiftId: "st-off" }];
    const plain = run({});
    expect(plain.split(" ")[1]).toBe("X"); // without the avoid the X comes right after the ORL
    expect(run({ followAvoids: AVOID }).split(" ")[1]).toBe("OR");
    expect(run({ followAvoids: AVOID, schedulingPreferences: { ...PREFS, softAvoidFollowWeight: 0 } })).toBe(plain);
  });
});

describe("few-people warning threshold from Settings (card #215)", () => {
  it("a shift only one person can work is named as the cause; threshold 0 never names it", () => {
    const ICU = shift("st-icu", "ICU", { defaultHours: 10, schedulePriority: 5 });
    const W = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
    const inp = (o: Partial<AutoScheduleInput["schedulingPreferences"]> = {}) => base({
      dates: W, shiftTypes: [OR, ICU, OFF],
      staff: [staff("p1", { eligibleShiftTypeIds: ["st-or", "st-icu", "st-off"] }), staff("p2", { eligibleShiftTypeIds: ["st-or", "st-off"] })],
      payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
      staffingRequirements: need("st-icu", ["1", "2", "3", "4", "5"]), schedulingPreferences: { ...PREFS, ...o },
    });
    const over = (r: ReturnType<typeof autoSchedule>) => r.warnings.find((w) => w.startsWith("P1") && w.includes("over target"));
    expect(over(autoSchedule(inp()))).toContain("ICU (only 1 eligible)");
    expect(over(autoSchedule(inp({ scarcePoolSize: 0 })))).toContain("no legal rebalance available");
    expect(over(autoSchedule(inp({ scarcePoolSize: 0 })))).not.toContain("ICU");
  });
});

describe("spacing reach and even band from Settings (card #215)", () => {
  // Two people, a CALL on Monday 2025-06-16. A worked a marked CALL 6 days before, B 10 days
  // before. Reach 14 sees both: A is closer, so B goes. Reach 5 sees neither: the list order (A).
  const MON = "2025-06-16";
  const SPREAD = shift("st-call", "CALL", { schedulePriority: 10, spreadOverMonth: true, countsTowardFte: false });
  const hist = (id: string, d: string): ScheduleAssignment => ({ staffId: id, date: d, shiftTypeId: "st-call", code: "CALL", isLocked: false, source: "manual" });
  const spreadInp = (spreadRadiusDays?: number) => base({
    dates: [MON], staff: [staff("a"), staff("b")], shiftTypes: [OFF, SPREAD],
    payPeriods: [{ startDate: "2025-06-15", endDate: "2025-06-28", targetHours: 0 }],
    historicalAssignments: [hist("a", "2025-06-10"), hist("b", "2025-06-06")],
    staffingRequirements: need("st-call", ["1"]),
    schedulingPreferences: spreadRadiusDays === undefined ? PREFS : { ...PREFS, spreadRadiusDays },
  });

  it("reach 14 (default) keeps the CALL away from A's; reach 5 sees neither", () => {
    expect(holder(autoSchedule(spreadInp()), MON, "st-call")).toEqual(["b"]);
    expect(holder(autoSchedule(spreadInp(5)), MON, "st-call")).toEqual(["a"]);
  });

  // Even shift: in June A already holds a CALL (one ahead of B this month), but B was owed
  // nothing and A is owed from May. Band 1: A is passed over (B). Band 2: both are inside the
  // band and the carried balance decides (A).
  const EVEN = shift("st-call", "CALL", { schedulePriority: 10, evenAcrossMonths: true, countsTowardFte: false });
  const AL = shift("st-al", "AL", { isLeave: true, autoSchedulable: false, category: "leave", countsTowardFte: false });
  const evenInp = (evenBandCalls?: number) => base({
    dates: ["2025-06-09"], staff: [staff("b", { eligibleShiftTypeIds: ["st-call", "st-off", "st-al"] }), staff("a", { eligibleShiftTypeIds: ["st-call", "st-off", "st-al"] })],
    shiftTypes: [OFF, AL, EVEN], writableFrom: "2025-06-01",
    existingAssignments: [hist("a", "2025-06-02")],
    payPeriods: [{ startDate: "2025-06-01", endDate: "2025-06-14", targetHours: 0 }],
    balancePayPeriods: [{ startDate: "2025-05-04", endDate: "2025-05-17" }, { startDate: "2025-05-18", endDate: "2025-05-31" }, { startDate: "2025-06-01", endDate: "2025-06-14" }],
    historicalAssignments: [hist("a", "2025-05-12"), hist("a", "2025-05-26"), hist("b", "2025-05-05"), hist("b", "2025-05-19"),
      { ...hist("b", "2025-05-12"), shiftTypeId: "st-al", code: "AL" }, { ...hist("b", "2025-05-26"), shiftTypeId: "st-al", code: "AL" },
      { ...hist("b", "2025-05-02"), shiftTypeId: "st-al", code: "AL" }],
    staffingRequirements: need("st-call", ["1"]),
    schedulingPreferences: { ...PREFS, shiftBalanceFrom: "2025-05-01", ...(evenBandCalls === undefined ? {} : { evenBandCalls }) },
  });

  it("band 1 (default) passes over the person one ahead this month; band 2 lets the carried balance decide", () => {
    expect(holder(autoSchedule(evenInp()), "2025-06-09", "st-call")).toEqual(["b"]);
    expect(holder(autoSchedule(evenInp(2)), "2025-06-09", "st-call")).toEqual(["a"]);
  });
});
