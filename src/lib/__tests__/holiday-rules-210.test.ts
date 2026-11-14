import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment, type AutoScheduleResult } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";
import type { HolidayRuleSpec } from "../holiday-rules";

// Card #210 (David): holiday rules. "Thanksgiving 1" = the holiday's CALL + the Saturday's CALL
// (one person); "Thanksgiving 2" = the Friday's ORC + the Sunday's CALL (one person). Rules are
// settings data (user-named, editable), linked to a holiday TYPE by id.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const staff = (id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-call", "st-orc", "st-off"], availabilityRules: avail(ALL_DAYS),
  isActive: true, isAutoScheduled: true, specialQualifications: [], ...o,
});
const shift = (id: string, code: string, o: Partial<TestShift> = {}): TestShift => ({
  id, code, name: code, defaultHours: 8, defaultHoursWeekend: 8, defaultHoursHoliday: 8,
  countsTowardFte: false, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
  sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
  ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
});
const OFF = shift("st-off", "X", { isOffShift: true, autoSchedulable: false });
const CALL = shift("st-call", "CALL", { schedulePriority: 10, weekendPaired: true, holidayWeekendPaired: true });
const ORC = shift("st-orc", "ORC", { schedulePriority: 20, defaultHours: 16 });

// Thanksgiving 2026: Thu 26 Nov. The Friday after is NOT a holiday row (as on the live list).
const MON = "2026-11-23", THU = "2026-11-26", FRI = "2026-11-27", SAT = "2026-11-28", SUN = "2026-11-29";
const WEEK = ["2026-11-23", "2026-11-24", "2026-11-25", THU, FRI, SAT, SUN];
const TG = "ht-thanksgiving";
const TG1: HolidayRuleSpec = { id: "r1", name: "Thanksgiving 1", holidayTypeId: TG, sortOrder: 0, days: [{ offset: 0, shiftTypeId: "st-call" }, { offset: 2, shiftTypeId: "st-call" }] };
const TG2: HolidayRuleSpec = { id: "r2", name: "Thanksgiving 2", holidayTypeId: TG, sortOrder: 1, days: [{ offset: 1, shiftTypeId: "st-orc" }, { offset: 3, shiftTypeId: "st-call" }] };

// Live staffing: CALL weekend + holiday min 1 max 1, weekdays min 0 max 1; ORC weekdays min 1
// max 1, weekend + holiday max 0.
const req = (shiftTypeId: string, dayKey: string, minCount: number, maxCount: number) => ({ shiftTypeId, dayKey, minCount, maxCount });
const LIVE_REQS = [
  ...["0", "6", "holiday"].map((k) => req("st-call", k, 1, 1)),
  ...["1", "2", "3", "4", "5"].map((k) => req("st-call", k, 0, 1)),
  ...["1", "2", "3", "4", "5"].map((k) => req("st-orc", k, 1, 1)),
  ...["0", "6", "holiday"].map((k) => req("st-orc", k, 0, 0)),
];
const PREFS = { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 };
const PPS = [{ startDate: "2026-11-22", endDate: "2026-12-05", targetHours: 0 }];

const cell = (staffId: string, date: string, shiftTypeId = "st-call", source = "manual"): ScheduleAssignment =>
  ({ staffId, date, shiftTypeId, code: shiftTypeId === "st-call" ? "CALL" : shiftTypeId === "st-orc" ? "ORC" : "X", isLocked: false, source });

function input(o: Partial<AutoScheduleInput> = {}): AutoScheduleInput {
  return withDayCaps({
    dates: WEEK, staff: [staff("a"), staff("b"), staff("c"), staff("d")], shiftTypes: [OFF, CALL, ORC],
    existingAssignments: [], payPeriods: PPS, holidays: [{ date: THU, holidayTypeId: TG }],
    desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [], staffingRequirements: LIVE_REQS, schedulingPreferences: PREFS,
    equityFactors: [], followRules: [], holidayRules: [TG1, TG2],
    ...o,
  });
}
/** Who holds `shiftTypeId` on `date` at the end (the run's suggestions, else an existing cell). */
function holders(r: AutoScheduleResult, inp: AutoScheduleInput, date: string, shiftTypeId: string): string[] {
  const out = new Set(r.suggestions.filter((s) => s.date === date && s.shiftTypeId === shiftTypeId).map((s) => s.staffId));
  for (const a of inp.existingAssignments) if (a.date === date && a.shiftTypeId === shiftTypeId) out.add(a.staffId);
  return [...out];
}
const one = (r: AutoScheduleResult, inp: AutoScheduleInput, date: string, st: string): string => {
  const h = holders(r, inp, date, st);
  expect(h, `${st} on ${date}`).toHaveLength(1);
  return h[0];
};

describe("holiday rules place each group on one person (card #210)", () => {
  it("no rules: output identical to a run without the field", () => {
    const withEmpty = autoSchedule(input({ holidayRules: [] }));
    const without = autoSchedule(input({ holidayRules: undefined }));
    expect(withEmpty.suggestions).toEqual(without.suggestions);
    expect(withEmpty.warnings).toEqual(without.warnings);
  });

  it("Thanksgiving 1 = Thu + Sat CALL one person; Thanksgiving 2 = Fri ORC + Sun CALL one person", () => {
    const inp = input();
    const r = autoSchedule(inp);
    const t1 = one(r, inp, THU, "st-call");
    expect(one(r, inp, SAT, "st-call")).toBe(t1);
    const t2 = one(r, inp, FRI, "st-orc");
    expect(one(r, inp, SUN, "st-call")).toBe(t2);
    // The rule cells carry their own step (repairs never move them).
    expect(r.suggestions.filter((s) => s.step === "holiday-rule")).toHaveLength(4);
  });

  it("a rule day with no normal demand still gets its slot (Fri CALL min 0)", () => {
    const FRI_CALL: HolidayRuleSpec = { id: "r3", name: "Long weekend", holidayTypeId: TG, days: [{ offset: 0, shiftTypeId: "st-call" }, { offset: 1, shiftTypeId: "st-call" }] };
    const inp = input({ holidayRules: [FRI_CALL] });
    const r = autoSchedule(inp);
    expect(one(r, inp, FRI, "st-call")).toBe(one(r, inp, THU, "st-call"));
  });

  it("a rule day whose shift is not allowed that day (max 0): warning, the rest is left to the normal fill", () => {
    const BAD: HolidayRuleSpec = { id: "r4", name: "Bad rule", holidayTypeId: TG, days: [{ offset: 0, shiftTypeId: "st-call" }, { offset: 2, shiftTypeId: "st-orc" }] };
    const inp = input({ holidayRules: [BAD] });
    const r = autoSchedule(inp);
    expect(r.warnings.some((w) => w.includes("Bad rule") && w.includes("ORC") && w.includes("not allowed") && w.includes(SAT))).toBe(true);
    expect(holders(r, inp, SAT, "st-orc")).toEqual([]);
    expect(holders(r, inp, THU, "st-call")).toHaveLength(1);
  });

  it("a hand-entered Thursday CALL keeps its Saturday for the same person", () => {
    const inp = input({ existingAssignments: [cell("c", THU)] });
    const r = autoSchedule(inp);
    expect(one(r, inp, SAT, "st-call")).toBe("c");
  });

  it("a hand split (Thu for one person, Sat for another) is left alone", () => {
    const inp = input({ existingAssignments: [cell("c", THU), cell("d", SAT)] });
    const r = autoSchedule(inp);
    expect(holders(r, inp, SAT, "st-call")).toEqual(["d"]);
    expect(r.suggestions.some((s) => s.staffId === "c" && s.date === SAT && s.shiftTypeId === "st-call")).toBe(false);
  });

  it("anchor can't take the paired day: warning, and the day is filled by someone else", () => {
    const offSat = { id: "q1", staffId: "c", startDate: SAT, endDate: SAT, kind: "OFF" as const, shiftTypeIds: [], leaveShiftTypeId: null, strength: "hard" as const, status: "approved" as const };
    const inp = input({ existingAssignments: [cell("c", THU)], scheduleRequests: [offSat] });
    const r = autoSchedule(inp);
    expect(r.warnings.some((w) => w.includes("Thanksgiving 1") && w.includes("C"))).toBe(true);
    const sat = one(r, inp, SAT, "st-call");
    expect(sat).not.toBe("c");
    // Sunday's own group is untouched: Fri ORC + Sun CALL still one person.
    expect(one(r, inp, SUN, "st-call")).toBe(one(r, inp, FRI, "st-orc"));
  });

  it("only a Thu + Sat rule: the Sunday split from its weekend pair is still filled", () => {
    const inp = input({ holidayRules: [TG1] });
    const r = autoSchedule(inp);
    expect(one(r, inp, SAT, "st-call")).toBe(one(r, inp, THU, "st-call"));
    expect(holders(r, inp, SUN, "st-call")).toHaveLength(1);
  });

  it("a Friday holiday bridged to its weekend, with the Saturday claimed by a rule: every day still filled", () => {
    // Friday holiday type "Day after" with a rule Fri CALL + Sat CALL? No: a rule of ANOTHER type
    // claims Saturday; the bridge (Fri holiday + Sat + Sun) is dissolved and each day filled.
    const FRI_HOL = "ht-other";
    const SAT_ONLY: HolidayRuleSpec = { id: "r5", name: "Other", holidayTypeId: TG, days: [{ offset: 0, shiftTypeId: "st-call" }, { offset: 2, shiftTypeId: "st-call" }] };
    const inp = input({ holidays: [{ date: THU, holidayTypeId: TG }, { date: FRI, holidayTypeId: FRI_HOL }], holidayRules: [SAT_ONLY] });
    const r = autoSchedule(inp);
    expect(one(r, inp, SAT, "st-call")).toBe(one(r, inp, THU, "st-call"));
    expect(holders(r, inp, FRI, "st-call")).toHaveLength(1);
    expect(holders(r, inp, SUN, "st-call")).toHaveLength(1);
  });

  it("a hand-entered Sunday after the end of the run anchors the Friday ORC (read-only context)", () => {
    const dates = WEEK.slice(0, 6); // Mon–Sat
    const inp = input({ dates, holidayRuleContext: [cell("d", SUN)] });
    const r = autoSchedule(inp);
    expect(one(r, inp, FRI, "st-orc")).toBe("d");
    expect(r.suggestions.some((s) => s.date === SUN)).toBe(false); // context is never written
  });

  it("an earlier, completed month's cell anchors too but is never written", () => {
    // The run starts on Saturday (writableFrom); Thursday's CALL is history.
    const inp = input({ dates: [SAT, SUN], writableFrom: SAT, historicalAssignments: [cell("b", THU)] });
    const r = autoSchedule(inp);
    expect(one(r, inp, SAT, "st-call")).toBe("b");
  });
});

describe("mixed-shift groups check each day's own shift (card #210)", () => {
  it("someone eligible only for CALL is never given the ORC day — not as a pick, not as an anchor", () => {
    const callOnly = staff("c", { eligibleShiftTypeIds: ["st-call", "st-off"] });
    // No anchor: c can't host Thanksgiving 2.
    const inp1 = input({ staff: [callOnly, staff("a")], holidayRules: [TG2] });
    const r1 = autoSchedule(inp1);
    expect(one(r1, inp1, FRI, "st-orc")).toBe("a");
    // Anchor: c holds Sunday by hand → warning; Friday's ORC goes to an ORC-eligible person.
    const inp2 = input({ staff: [callOnly, staff("a")], holidayRules: [TG2], existingAssignments: [cell("c", SUN)] });
    const r2 = autoSchedule(inp2);
    expect(one(r2, inp2, FRI, "st-orc")).toBe("a");
    expect(r2.warnings.some((w) => w.includes("Thanksgiving 2") && w.includes("C") && w.includes("ORC"))).toBe(true);
  });

  it("hours are priced per day's own shift: Fri ORC (16 h) + Sun CALL (8 h) is 24 h, not 16 h", () => {
    const CALL8 = shift("st-call", "CALL", { schedulePriority: 10, weekendPaired: true, holidayWeekendPaired: true, countsTowardFte: true });
    const ORC16 = shift("st-orc", "ORC", { schedulePriority: 20, defaultHours: 16, countsTowardFte: true });
    const OR = shift("st-or", "OR", { isFillShift: true, schedulePriority: 1 });
    // a has 20 h of room and would be picked first (b already holds a CALL this week); b has room.
    const inp = input({
      shiftTypes: [OFF, OR, CALL8, ORC16],
      staff: [staff("a", { fixedHoursPerPp: 20, eligibleShiftTypeIds: ["st-call", "st-orc", "st-off", "st-or"] }), staff("b", { eligibleShiftTypeIds: ["st-call", "st-orc", "st-off", "st-or"] })],
      payPeriods: [{ startDate: "2026-11-22", endDate: "2026-12-05", targetHours: 80 }],
      existingAssignments: [cell("b", MON)],
      holidayRules: [TG2],
      factorOrder: [{ key: "overHours", sortOrder: 0, enabled: true, hoursPolicy: "prohibited" }],
    });
    const r = autoSchedule(inp);
    expect(one(r, inp, FRI, "st-orc")).toBe("b");
    expect(one(r, inp, SUN, "st-call")).toBe("b");
  });

  it("a person-level hours override is used for the ORC day", () => {
    const CALL8 = shift("st-call", "CALL", { schedulePriority: 10, weekendPaired: true, holidayWeekendPaired: true, countsTowardFte: true });
    const ORC16 = shift("st-orc", "ORC", { schedulePriority: 20, defaultHours: 16, countsTowardFte: true });
    const OR = shift("st-or", "OR", { isFillShift: true, schedulePriority: 1 });
    // With a's ORC worth 8 h (override), Fri ORC + Sun CALL is 16 h and fits a's 20 h.
    const inp = input({
      shiftTypes: [OFF, OR, CALL8, ORC16],
      staff: [staff("a", { fixedHoursPerPp: 20, eligibleShiftTypeIds: ["st-call", "st-orc", "st-off", "st-or"] }), staff("b", { eligibleShiftTypeIds: ["st-call", "st-orc", "st-off", "st-or"] })],
      payPeriods: [{ startDate: "2026-11-22", endDate: "2026-12-05", targetHours: 80 }],
      existingAssignments: [cell("b", MON)],
      staffOverrides: [{ staffId: "a", shiftTypeId: "st-orc", durationHrs: 8, durationHrsWeekday: 8, durationHrsWeekend: 8, durationHrsHoliday: 8 }],
      holidayRules: [TG2],
      factorOrder: [{ key: "overHours", sortOrder: 0, enabled: true, hoursPolicy: "prohibited" }],
    });
    const r = autoSchedule(inp);
    expect(one(r, inp, FRI, "st-orc")).toBe("a");
    expect(one(r, inp, SUN, "st-call")).toBe("a");
  });
});

describe("followers and rollback (card #210)", () => {
  const followX = [{ sourceShiftId: "st-orc", followerShiftId: "st-off", scope: "each_day", countsTowardTargets: false }];

  it("the Friday ORC's required follower is placed with the group", () => {
    const inp = input({ requiredFollowers: followX });
    const r = autoSchedule(inp);
    const t2 = one(r, inp, FRI, "st-orc");
    expect(one(r, inp, SUN, "st-call")).toBe(t2);
    expect(r.suggestions.some((s) => s.staffId === t2 && s.date === SAT && s.shiftTypeId === "st-off")).toBe(true);
  });

  it("a day that fails once the earlier days and their follower are placed rolls the whole group back (no half-placed group)", () => {
    const CLASH: HolidayRuleSpec = { id: "r6", name: "Clash", holidayTypeId: TG, days: [{ offset: 1, shiftTypeId: "st-orc" }, { offset: 2, shiftTypeId: "st-call" }] };
    // Only a day off may follow ORC, so the Saturday CALL can't sit after the Friday ORC: the
    // check before placing sees an empty Friday; the trial places ORC (and its X) and then fails.
    const onlyOffAfterOrc = [{ sourceShiftId: "st-orc", allowedShiftId: null, allowOffShifts: true, mode: "allow" }];
    const inp = input({ holidayRules: [CLASH], requiredFollowers: followX, followRules: onlyOffAfterOrc });
    const r = autoSchedule(inp);
    expect(r.suggestions.filter((s) => s.step === "holiday-rule")).toEqual([]);
    expect(r.warnings.some((w) => w.includes("Clash"))).toBe(true);
    // Both days are still covered by the normal passes.
    expect(holders(r, inp, FRI, "st-orc")).toHaveLength(1);
    expect(holders(r, inp, SAT, "st-call")).toHaveLength(1);
  });

  it("repairs never move a rule cell: every rule cell survives to the end", () => {
    const inp = input();
    const r = autoSchedule(inp);
    const rule = r.suggestions.filter((s) => s.step === "holiday-rule");
    expect(rule).toHaveLength(4);
    for (const s of rule) expect(r.suggestions.filter((x) => x.date === s.date && x.staffId === s.staffId)).toHaveLength(1);
  });
});

describe("group ranking keeps the even-across-months balance (card #203 + #210)", () => {
  // June 2025 run; a is owed one CALL from May (b was on leave on two of a's days).
  const AL = shift("st-al", "AL", { isLeave: true, autoSchedulable: false, category: "leave" });
  const may = [cell("a", "2025-05-12"), cell("a", "2025-05-26"), cell("b", "2025-05-05"), cell("b", "2025-05-19"),
    { ...cell("b", "2025-05-12"), shiftTypeId: "st-al", code: "AL" }, { ...cell("b", "2025-05-26"), shiftTypeId: "st-al", code: "AL" }];
  const JUNE_PPS = [
    { startDate: "2025-05-04", endDate: "2025-05-17", targetHours: 0 }, { startDate: "2025-05-18", endDate: "2025-05-31", targetHours: 0 },
    { startDate: "2025-06-01", endDate: "2025-06-14", targetHours: 0 },
  ];
  const H = "ht-june";
  const RULE: HolidayRuleSpec = { id: "rj", name: "June pair", holidayTypeId: H, days: [{ offset: 0, shiftTypeId: "st-call" }, { offset: 1, shiftTypeId: "st-call" }] };
  const run = (even: boolean) => {
    const C = shift("st-call", "CALL", { schedulePriority: 10, evenAcrossMonths: even });
    const inp = input({
      dates: ["2025-06-02", "2025-06-03"], staff: [staff("b", { eligibleShiftTypeIds: ["st-call", "st-off", "st-al"] }), staff("a", { eligibleShiftTypeIds: ["st-call", "st-off", "st-al"] })],
      shiftTypes: [OFF, AL, C], payPeriods: JUNE_PPS.slice(2), balancePayPeriods: JUNE_PPS.map(({ startDate, endDate }) => ({ startDate, endDate })),
      holidays: [{ date: "2025-06-02", holidayTypeId: H }], historicalAssignments: may, writableFrom: "2025-06-01",
      staffingRequirements: [req("st-call", "holiday", 1, 1), req("st-call", "2", 0, 1)],
      schedulingPreferences: { ...PREFS, shiftBalanceFrom: "2025-05-01" }, holidayRules: [RULE],
    });
    return { inp, r: autoSchedule(inp) };
  };

  it("the owed person (by balance) gets the group, not the one with fewer all-time CALLs", () => {
    const { inp, r } = run(true);
    expect(one(r, inp, "2025-06-02", "st-call")).toBe("a");
    expect(one(r, inp, "2025-06-03", "st-call")).toBe("a");
  });

  it("control: without the tick, raw counts tie and the list order decides", () => {
    const { inp, r } = run(false);
    expect(one(r, inp, "2025-06-02", "st-call")).toBe("b");
  });
});
