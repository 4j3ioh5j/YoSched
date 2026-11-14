import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";
import type { ShiftEligibilityRule } from "../shift-eligibility";

// Card #203 (David): CALL/ORC counts per FTE as even as possible, and as spread out as
// possible. "Old counts and fairness scores should only act as a tie breaker — never flood
// anyone with excess calls within a month." New staff start level.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const staff = (id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-call", "st-off", "st-al"], availabilityRules: avail(ALL_DAYS),
  isActive: true, isAutoScheduled: true, specialQualifications: [], ...o,
});
const shift = (id: string, code: string, o: Partial<TestShift> = {}): TestShift => ({
  id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
  countsTowardFte: false, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
  sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
  ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
});
const OFF = shift("st-off", "X", { isOffShift: true, autoSchedulable: false });
const AL = shift("st-al", "AL", { isLeave: true, autoSchedulable: false, category: "leave" });
const CALL = shift("st-call", "CALL", { schedulePriority: 10, evenAcrossMonths: true });
const PLAIN_CALL = shift("st-call", "CALL", { schedulePriority: 10 });

// Pay periods (target 0: no fill shift, so hours never interfere).
const PPS = [
  { startDate: "2025-05-04", endDate: "2025-05-17", targetHours: 0 },
  { startDate: "2025-05-18", endDate: "2025-05-31", targetHours: 0 },
  { startDate: "2025-06-01", endDate: "2025-06-14", targetHours: 0 },
  { startDate: "2025-06-15", endDate: "2025-06-28", targetHours: 0 },
  { startDate: "2025-06-29", endDate: "2025-07-12", targetHours: 0 },
];
const cell = (staffId: string, date: string, st: TestShift = CALL, source = "manual"): ScheduleAssignment =>
  ({ staffId, date, shiftTypeId: st.id, code: st.code, isLocked: false, source });
const needOn = (dayKeys: string[]) => dayKeys.map((dayKey) => ({ shiftTypeId: "st-call", shiftCode: "CALL", dayKey, minCount: 1, preferredCount: 1, maxCount: 1 }));
const PREFS = { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 };

function input(o: Partial<AutoScheduleInput> & { from?: string | null } = {}): AutoScheduleInput {
  const { from = "2025-05-01", ...rest } = o;
  return withDayCaps({
    dates: ["2025-06-02"], staff: [], shiftTypes: [OFF, AL, CALL], existingAssignments: [], payPeriods: PPS.slice(2),
    balancePayPeriods: PPS.map(({ startDate, endDate }) => ({ startDate, endDate })),
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [], staffingRequirements: needOn(["1"]),
    schedulingPreferences: { ...PREFS, shiftBalanceFrom: from },
    equityFactors: [], followRules: [], writableFrom: "2025-06-01",
    ...rest,
  });
}
const callOn = (r: ReturnType<typeof autoSchedule>, d: string) => r.suggestions.filter((s) => s.date === d && s.shiftTypeId === "st-call").map((s) => s.staffId);
const countFor = (r: ReturnType<typeof autoSchedule>, id: string) => r.suggestions.filter((s) => s.staffId === id && s.shiftTypeId === "st-call").length;

// May Mondays 5, 12, 19, 26: A and B each worked two, but B was on leave on the 12th and 26th
// — so those two were A's alone to take. A is owed one; B is one ahead.
const MAY = [cell("a", "2025-05-12"), cell("a", "2025-05-26"), cell("b", "2025-05-05"), cell("b", "2025-05-19"),
  cell("b", "2025-05-12", AL), cell("b", "2025-05-26", AL)];

describe("carried balance breaks the tie (card #203)", () => {
  it("the person owed from earlier months gets the even month's first CALL", () => {
    const r = autoSchedule(input({ staff: [staff("b"), staff("a")], historicalAssignments: MAY }));
    expect(callOn(r, "2025-06-02")).toEqual(["a"]);
    expect(r.balances?.["st-call"].a.carried).toBeCloseTo(-1);
    expect(r.balances?.["st-call"].b.carried).toBeCloseTo(1);
  });

  it("control: without the tick, raw history ties and the list order decides", () => {
    const r = autoSchedule(input({ staff: [staff("b"), staff("a")], historicalAssignments: MAY, shiftTypes: [OFF, AL, PLAIN_CALL] }));
    expect(callOn(r, "2025-06-02")).toEqual(["b"]);
    expect(r.balances).toBeUndefined();
  });

  it("no start date: earlier months don't count at all", () => {
    const r = autoSchedule(input({ staff: [staff("b"), staff("a")], historicalAssignments: MAY, from: null }));
    expect(callOn(r, "2025-06-02")).toEqual(["b"]);
    expect(r.balances?.["st-call"].a.carried).toBe(0);
  });

  it("cells before the start date don't count", () => {
    const r = autoSchedule(input({ staff: [staff("b"), staff("a")], historicalAssignments: MAY, from: "2025-05-27" }));
    expect(callOn(r, "2025-06-02")).toEqual(["b"]);
  });

  it("a hard Tuesday-only rule: owed only Tuesdays' share", () => {
    // May Tuesdays 6, 13, 20, 27: C (Tuesday-only) 3, A 1; Thursdays 8, 15, 22, 29: A all 4.
    // Truly: A got 5 of an owed 6 (owed one), C got 3 of an owed 2 (one ahead).
    // Ignoring the rule would make C look owed instead.
    const hist = [cell("c", "2025-05-06"), cell("c", "2025-05-13"), cell("c", "2025-05-20"), cell("a", "2025-05-27"),
      cell("a", "2025-05-08"), cell("a", "2025-05-15"), cell("a", "2025-05-22"), cell("a", "2025-05-29")];
    const tueOnly: ShiftEligibilityRule = { shiftTypeId: "st-call", type: "eligible", strength: "rule", ...wEvery(2) } as ShiftEligibilityRule;
    const r = autoSchedule(input({
      dates: ["2025-06-03"], staffingRequirements: needOn(["2"]),
      staff: [staff("c", { shiftEligibilityRules: [tueOnly] }), staff("a")], historicalAssignments: hist,
    }));
    expect(callOn(r, "2025-06-03")).toEqual(["a"]);
  });

  it("a hard weekday availability rule: no share of days they can't work", () => {
    // B never works Thursdays; A took the four May Thursdays and B two of the four Tuesdays.
    // A: got 6, owed 2 + 4 = 6 → level. B: got 2 of an owed 2 → level… unless the Thursdays
    // were (wrongly) owed to B too, which would make B look owed two.
    const hist = [cell("a", "2025-05-06"), cell("a", "2025-05-13"), cell("b", "2025-05-20"), cell("b", "2025-05-27"),
      cell("a", "2025-05-08"), cell("a", "2025-05-15"), cell("a", "2025-05-22"), cell("a", "2025-05-29")];
    const r = autoSchedule(input({
      // (B's X on May 5 puts B on the roster for the first May pay period.)
      staff: [staff("a"), staff("b", { availabilityRules: avail([0, 1, 2, 3, 5, 6]) })], historicalAssignments: [...hist, cell("b", "2025-05-05", OFF)],
    }));
    expect(r.balances?.["st-call"].b.carried).toBeCloseTo(0);
    expect(r.balances?.["st-call"].a.carried).toBeCloseTo(0);
  });

  it("an approved day off (hard OFF request) earns no share", () => {
    const hist = [cell("a", "2025-05-05"), cell("a", "2025-05-12")];
    const off = { id: "r1", staffId: "b", startDate: "2025-05-05", endDate: "2025-05-12", kind: "OFF" as const, shiftTypeIds: [], leaveShiftTypeId: null, strength: "hard" as const, status: "approved" as const };
    const r = autoSchedule(input({ staff: [staff("a"), staff("b")], historicalAssignments: [...hist, cell("b", "2025-05-19", OFF)], balanceRequests: [off] }));
    expect(r.balances?.["st-call"].b.carried).toBeCloseTo(0);
    expect(r.balances?.["st-call"].a.carried).toBeCloseTo(0);
  });
});

describe("never flooded within a month (card #203)", () => {
  // June Mondays 2, 9, 16, 23, 30 and Thursdays: ten CALLs between A and B. B is owed five
  // from May (A took all ten May Mondays/Thursdays while B was level-eligible).
  const may = ["2025-05-05", "2025-05-08", "2025-05-12", "2025-05-15", "2025-05-19", "2025-05-22", "2025-05-26", "2025-05-29"].map((d) => cell("a", d));
  const juneDays = ["2025-06-02", "2025-06-05", "2025-06-09", "2025-06-12", "2025-06-16", "2025-06-19", "2025-06-23", "2025-06-26", "2025-06-30"];
  const run = () => autoSchedule(input({
    dates: juneDays, staffingRequirements: needOn(["1", "4"]),
    staff: [staff("a"), staff("b")], historicalAssignments: [...may, cell("b", "2025-05-06", OFF), cell("b", "2025-05-20", OFF)],
  }));

  it("the owed person gets at most one more than an even split, and wins the first tie", () => {
    const r = run();
    expect(r.balances?.["st-call"].b.carried).toBeCloseTo(-4);
    expect(countFor(r, "b")).toBeLessThanOrEqual(5); // 9 slots: even is 4.5
    expect(countFor(r, "a")).toBeGreaterThanOrEqual(4);
    expect(callOn(r, "2025-06-02")).toEqual(["b"]);
  });

  it("FTE weighting: a 0.5 FTE takes a third of the month", () => {
    const r = autoSchedule(input({ dates: juneDays.slice(0, 6), staffingRequirements: needOn(["1", "4"]), staff: [staff("a"), staff("h", { ftePercentage: 0.5 })], from: null }));
    expect(countFor(r, "a")).toBe(4);
    expect(countFor(r, "h")).toBe(2);
  });

  it("zero-FTE staff keep the per-head fallback (no 0/0)", () => {
    const r = autoSchedule(input({ dates: juneDays.slice(0, 4), staffingRequirements: needOn(["1", "4"]), staff: [staff("a", { ftePercentage: 0 }), staff("b", { ftePercentage: 0 })], from: null }));
    expect(countFor(r, "a")).toBe(2);
    expect(countFor(r, "b")).toBe(2);
    expect(Number.isFinite(r.balances!["st-call"].a.run)).toBe(true);
  });
});

describe("this month = the calendar month (card #203)", () => {
  it("a frozen May CALL inside the covering pay period counts as carried, not this month", () => {
    // The run's pay period starts in May (May 25 – Jun 7): A's May 26 CALL is context.
    const r = autoSchedule(input({
      dates: ["2025-05-25", "2025-05-26", "2025-05-27", "2025-05-28", "2025-05-29", "2025-05-30", "2025-05-31", "2025-06-01", "2025-06-02"],
      payPeriods: [{ startDate: "2025-05-25", endDate: "2025-06-07", targetHours: 0 }],
      balancePayPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24" }, { startDate: "2025-05-25", endDate: "2025-06-07" }],
      staffingRequirements: needOn(["1"]),
      existingAssignments: [cell("a", "2025-05-26"), cell("b", "2025-05-26", OFF)],
      staff: [staff("a"), staff("b")], from: "2025-05-25",
    }));
    expect(r.balances?.["st-call"].a.run).toBeCloseTo(callOn(r, "2025-06-02")[0] === "a" ? 0.5 : -0.5);
    expect(r.balances?.["st-call"].a.carried).toBeCloseTo(0.5);
    // Within the band both are level this month; B (owed from May) wins.
    expect(callOn(r, "2025-06-02")).toEqual(["b"]);
  });
});

describe("new staff start level (card #203)", () => {
  it("someone who joined in June is neither owed nor ahead for May", () => {
    const hist = [cell("a", "2025-05-05"), cell("b", "2025-05-12")];
    const r = autoSchedule(input({ staff: [staff("n", { createdOn: "2025-06-01" }), staff("a"), staff("b")], historicalAssignments: hist }));
    expect(r.balances?.["st-call"].n.carried).toBe(0);
    expect(r.balances?.["st-call"].a.carried).toBeCloseTo(0);
  });

  it("ticked for the shift mid-May: no share before the tick", () => {
    const hist = [cell("a", "2025-05-05"), cell("a", "2025-05-12"), cell("a", "2025-05-19"), cell("n", "2025-05-26"), cell("n", "2025-05-05", OFF)];
    const r = autoSchedule(input({ staff: [staff("n", { eligibleSince: { "st-call": "2025-05-19" } }), staff("a")], historicalAssignments: hist }));
    // Slots 5, 12 were A's alone; 19 and 26 shared: A got 3 of 3, N 1 of 1.
    expect(r.balances?.["st-call"].n.carried).toBeCloseTo(0);
    expect(r.balances?.["st-call"].a.carried).toBeCloseTo(0);
  });

  it("a cell held before the tick is no slot at all (neither got nor expected)", () => {
    const hist = [cell("n", "2025-05-05"), cell("a", "2025-05-19"), cell("n", "2025-05-26")];
    const r = autoSchedule(input({ staff: [staff("n", { eligibleSince: { "st-call": "2025-05-19" } }), staff("a")], historicalAssignments: hist }));
    expect(r.balances?.["st-call"].n.carried).toBeCloseTo(0);
    expect(r.balances?.["st-call"].a.carried).toBeCloseTo(0);
  });

  it("temp staff: only inside their dates", () => {
    const hist = [cell("a", "2025-05-05"), cell("a", "2025-05-12"), cell("t", "2025-05-19"), cell("a", "2025-05-26")];
    const r = autoSchedule(input({ staff: [staff("t", { tempStartDate: "2025-05-18", tempEndDate: "2025-05-24" }), staff("a")], historicalAssignments: hist }));
    expect(r.balances?.["st-call"].t.carried).toBeCloseTo(0.5);
    expect(r.balances?.["st-call"].a.carried).toBeCloseTo(-0.5);
  });
});

describe("spread out as much as possible (card #203)", () => {
  const MARKED = shift("st-call", "CALL", { schedulePriority: 10, spreadOverMonth: true });
  it("among level people, the one whose last CALL is furthest back", () => {
    // A's last CALL 6 days before Mon Jun 16, B's 10 days before: under the old ±3-day rule both scored 0.
    const r = autoSchedule(input({
      dates: ["2025-06-16"], shiftTypes: [OFF, AL, MARKED], staff: [staff("a"), staff("b")], from: null,
      existingAssignments: [cell("a", "2025-06-10"), cell("b", "2025-06-06")],
    }));
    expect(callOn(r, "2025-06-16")).toEqual(["b"]);
  });

  it("last month's CALL counts even outside the covering pay period", () => {
    // Run Jun 2; A had a CALL on May 30 (history only), B nothing.
    const r = autoSchedule(input({
      dates: ["2025-06-02"], shiftTypes: [OFF, AL, MARKED], staff: [staff("a"), staff("b")], from: null,
      historicalAssignments: [cell("a", "2025-05-30")],
    }));
    expect(callOn(r, "2025-06-02")).toEqual(["b"]);
  });

  it("next month's CALL (forward context) counts, and is never written", () => {
    const r = autoSchedule(input({
      dates: ["2025-06-30"], payPeriods: [{ startDate: "2025-06-29", endDate: "2025-07-12", targetHours: 0 }],
      shiftTypes: [OFF, AL, MARKED], staff: [staff("a"), staff("b")], from: null,
      spreadContext: [cell("a", "2025-07-14")],
    }));
    expect(callOn(r, "2025-06-30")).toEqual(["b"]);
    expect(r.suggestions.some((s) => s.date === "2025-07-14")).toBe(false);
  });

  it("evenness this month still comes first", () => {
    const r = autoSchedule(input({
      dates: ["2025-06-16"], shiftTypes: [OFF, AL, MARKED], staff: [staff("a"), staff("b")], from: null,
      existingAssignments: [cell("a", "2025-06-02"), cell("b", "2025-06-15"), cell("b", "2025-06-12")],
    }));
    expect(callOn(r, "2025-06-16")).toEqual(["a"]); // B, with two, is out of the band despite worse spacing
  });
});

describe("replay: next month reads this month's saved cells the same way (card #203)", () => {
  it("June's carried balance equals May's end-of-run balance", () => {
    const MAYPP = [
      { startDate: "2025-04-20", endDate: "2025-05-03", targetHours: 0 },
      { startDate: "2025-05-04", endDate: "2025-05-17", targetHours: 0 },
      { startDate: "2025-05-18", endDate: "2025-05-31", targetHours: 0 },
    ];
    const mayDates: string[] = [];
    for (let d = new Date("2025-05-01T12:00:00"); d.getMonth() === 4; d.setDate(d.getDate() + 1)) mayDates.push(d.toISOString().slice(0, 10));
    const PRE = shift("st-pre", "PRE", { schedulePriority: 5 });
    const shifts = [OFF, AL, CALL, PRE];
    const people = [staff("a", { eligibleShiftTypeIds: ["st-call", "st-off", "st-al", "st-pre"], shiftMinimumTargets: [{ shiftTypeId: "st-call", minCount: 1, maxCount: null, window: "pay_period", windowDays: null }] }),
      staff("b", { eligibleShiftTypeIds: ["st-call", "st-off", "st-al", "st-pre"] }), staff("c", { ftePercentage: 0.5 })];
    const mayInput = input({
      dates: mayDates, payPeriods: MAYPP, balancePayPeriods: [...MAYPP, ...PPS.slice(2)].map(({ startDate, endDate }) => ({ startDate, endDate })),
      writableFrom: "2025-05-01", shiftTypes: shifts, staff: people, from: "2025-05-01",
      staffingRequirements: [...needOn(["1", "3"]), { shiftTypeId: "st-pre", shiftCode: "PRE", dayKey: "5", minCount: 1, preferredCount: 1, maxCount: 1 }],
      // A non-counting follower: every PRE is followed by a CALL that doesn't count toward targets.
      requiredFollowers: [{ sourceShiftId: "st-pre", followerShiftId: "st-call", scope: "each_day", countsTowardTargets: false }],
      existingAssignments: [cell("b", "2025-05-07"), cell("c", "2025-05-14", AL)],
      scheduleRequests: [{ id: "q", staffId: "c", startDate: "2025-05-14", endDate: "2025-05-14", kind: "LEAVE", shiftTypeIds: [], leaveShiftTypeId: "st-al", strength: "hard", status: "approved" }],
      historicalAssignments: [],
    });
    const may = autoSchedule(mayInput);
    expect(may.suggestions.some((s) => s.shiftTypeId === "st-call" && s.step === "follower")).toBe(true);
    // Save as the app does: assignments only — no step, no noCount.
    const saved: ScheduleAssignment[] = [
      ...mayInput.existingAssignments,
      ...may.suggestions.map((s) => ({ staffId: s.staffId, date: s.date, shiftTypeId: s.shiftTypeId, code: s.code, isLocked: false, source: "auto" })),
    ];
    const june = autoSchedule(input({ shiftTypes: shifts, staff: people, historicalAssignments: saved, from: "2025-05-01",
      balancePayPeriods: [...MAYPP, ...PPS.slice(2)].map(({ startDate, endDate }) => ({ startDate, endDate })),
      balanceRequests: mayInput.scheduleRequests }));
    for (const id of ["a", "b", "c"]) {
      const m = may.balances!["st-call"][id];
      expect(june.balances!["st-call"][id].carried).toBeCloseTo(m.run + m.carried);
    }
  });
});

describe("hours repair keeps the month even (card #203, R3-3)", () => {
  // Mon 2 Jun: x takes the CALL first (fewest hours; c was ahead in May). Tuesday's minimum then
  // pushes x over target, so the repair swaps x's CALL for a D with b or c — equal hours gain
  // either way. b already holds Friday's CALL; c doesn't. The repair must pick c.
  const H = (id: string, code: string, o: Partial<TestShift> = {}) => shift(id, code, { countsTowardFte: true, ...o });
  const DAY = H("st-day", "D", { schedulePriority: 20 });
  const LONG = H("st-long", "L", { defaultHours: 12, autoSchedulable: false });
  const FILL = H("st-fill", "F", { isFillShift: true });
  const run = (order: string[]) => {
    const C = H("st-call", "CALL", { schedulePriority: 10, defaultHours: 12, evenAcrossMonths: true });
    const elig = ["st-call", "st-day", "st-off", "st-long", "st-fill"];
    return autoSchedule(input({
      dates: ["2025-06-02", "2025-06-03", "2025-06-04", "2025-06-05", "2025-06-06"],
      staff: order.map((id) => staff(id, { eligibleShiftTypeIds: elig })),
      shiftTypes: [OFF, DAY, LONG, FILL, C],
      payPeriods: [{ startDate: "2025-06-01", endDate: "2025-06-14", targetHours: 40 }],
      existingAssignments: [
        cell("x", "2025-06-04", DAY), cell("x", "2025-06-05", DAY), cell("x", "2025-06-06", DAY),
        cell("b", "2025-06-03", DAY), cell("b", "2025-06-04", DAY), cell("b", "2025-06-05", OFF), cell("b", "2025-06-06", C),
        cell("c", "2025-06-03", DAY), cell("c", "2025-06-04", DAY), cell("c", "2025-06-05", OFF), cell("c", "2025-06-06", LONG),
      ],
      historicalAssignments: [cell("c", "2025-05-05", C), cell("x", "2025-05-05", OFF), cell("b", "2025-05-05", OFF)],
      staffingRequirements: [...needOn(["1"]),
        { shiftTypeId: "st-day", shiftCode: "D", dayKey: "1", minCount: 2, preferredCount: 2, maxCount: 2 },
        { shiftTypeId: "st-day", shiftCode: "D", dayKey: "2", minCount: 1, preferredCount: 1, maxCount: 1 }],
    }));
  };
  const mon = (r: ReturnType<typeof autoSchedule>) => r.suggestions.find((s) => s.date === "2025-06-02" && s.shiftTypeId === "st-call");

  it("the swapped CALL goes to the person behind this month, whatever the list order", () => {
    for (const order of [["x", "b", "c"], ["x", "c", "b"]]) {
      const r = run(order);
      expect(mon(r)).toMatchObject({ staffId: "c", step: "repair" });
      expect(r.balances?.["st-call"].b.run).toBeCloseTo(1 / 3);
    }
  });
});

describe("review r1 regressions (card #203)", () => {
  it("pay periods missing for older days: those days count on neither side (never got without expected)", () => {
    // MAY gives A −1 / B +1 when both May pay periods are known. Drop them (the rolling list
    // after a yearly regeneration): May can't be judged, so it counts for nobody.
    const r = autoSchedule(input({ staff: [staff("b"), staff("a")], historicalAssignments: MAY, balancePayPeriods: PPS.slice(2).map(({ startDate, endDate }) => ({ startDate, endDate })) }));
    expect(r.balances?.["st-call"].a.carried).toBe(0);
    expect(r.balances?.["st-call"].b.carried).toBe(0);
  });

  it("an approval-style re-solve spanning two months re-tallies the carried part as it places earlier-month cells", () => {
    // Run covers Thu May 29 and Mon Jun 2 (no month given: the later month, June, is "this
    // month"). Frozen May: A took May 5's CALL (A +½, B −½), so the run gives May 29 to B.
    // Carried is now level, so June 2 goes by the next tie-break (A, longest since a run CALL);
    // a carried total cached before May 29 was placed would hand B a second one.
    const run = (order: string[]) => autoSchedule(input({
      dates: ["2025-05-29", "2025-06-02"], writableFrom: undefined,
      payPeriods: [{ startDate: "2025-05-25", endDate: "2025-06-07", targetHours: 0 }],
      balancePayPeriods: [{ startDate: "2025-05-04", endDate: "2025-05-17" }, { startDate: "2025-05-18", endDate: "2025-05-24" }, { startDate: "2025-05-25", endDate: "2025-06-07" }],
      staff: order.map((id) => staff(id)),
      historicalAssignments: [cell("a", "2025-05-05"), cell("b", "2025-05-05", OFF)],
      staffingRequirements: needOn(["4", "1"]),
    }));
    for (const order of [["a", "b"], ["b", "a"]]) {
      const r = run(order);
      expect(callOn(r, "2025-05-29")).toEqual(["b"]);
      expect(callOn(r, "2025-06-02")).toEqual(["a"]);
      expect(r.balances?.["st-call"].a.carried).toBeCloseTo(0);
      expect(r.balances?.["st-call"].b.carried).toBeCloseTo(0);
    }
  });
});
