import { describe, it, expect } from "vitest";
import { autoSchedule, LEAVE_OFF_STEP, countedHoursFn, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
import { decideApproval, type ApprovalRequest } from "../request-approval-outcome";
import { excessLeaveDays, couldWorkOn, parseLeavePolicy, isLeavePolicy } from "../leave-policy";
import { assignmentSatisfiesRequestOnDate, checkRequestConflict, isRequestSatisfied, releasableDates, reconcileApprovalAction, releasableOffDates, type ScheduleRequestData } from "../schedule-requests";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

// Card #175 (David): "days that would already be X stay X, days they would have
// worked become AL" — requested leave is charged only for days the person would
// work, and never past their pay-period hours target.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const staff = (id: string, initials: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials, ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off", "st-al"],
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
const OR = shift("st-or", "OR", { schedulePriority: 1, isFillShift: true });
const AL = shift("st-al", "AL", { isLeave: true, autoSchedulable: false });

// PP Sun 2025-05-11 .. Sat 2025-05-24 (two working weeks).
const W1 = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
const W2 = ["2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const PP = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };

const leaveReq = (staffId: string, start: string, end: string, o: Partial<ScheduleRequestData> = {}): ScheduleRequestData =>
  ({ id: `q-${staffId}-${start}`, staffId, startDate: start, endDate: end, kind: "LEAVE", shiftTypeIds: [], leaveShiftTypeId: "st-al", strength: "hard", status: "approved", ...o });
const locked = (staffId: string, date: string, shiftTypeId = "st-or", code = "OR"): ScheduleAssignment =>
  ({ staffId, date, shiftTypeId, code, isLocked: true, source: "manual" });

function input(o: Partial<AutoScheduleInput> = {}, prefs: Partial<AutoScheduleInput["schedulingPreferences"]> = {}): AutoScheduleInput {
  return withDayCaps({
    dates: [...W1, ...W2],
    staff: [staff("p1", "SH"), staff("p2", "CD")],
    shiftTypes: [OR, OFF, AL],
    existingAssignments: [],
    payPeriods: [PP],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [], staffingRequirements: [],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3, ...prefs },
    equityFactors: [], followRules: [],
    ...o,
  });
}

type Cell = { shiftTypeId: string; step?: string };
/** The final grid for one person: loaded cells overlaid by suggestions. */
function finalGrid(inp: AutoScheduleInput, r: ReturnType<typeof autoSchedule>, who: string): Map<string, Cell> {
  const g = new Map<string, Cell>();
  for (const a of inp.existingAssignments) if (a.staffId === who) g.set(a.date, { shiftTypeId: a.shiftTypeId });
  for (const s of r.suggestions) if (s.staffId === who) g.set(s.date, { shiftTypeId: s.shiftTypeId, step: s.step });
  return g;
}
function ppHours(inp: AutoScheduleInput, r: ReturnType<typeof autoSchedule>, who: string): number {
  const h = countedHoursFn(inp);
  let t = 0;
  for (const [d, c] of finalGrid(inp, r, who)) if (d >= PP.startDate && d <= PP.endDate) t += h(who, c.shiftTypeId, d);
  return t;
}

describe("engine: requested leave on a day off anyway is X (card #175)", () => {
  // 0.8 FTE (64h/PP), works Mon–Thu, a week of AL Mon–Fri.
  const sh08 = () => staff("p1", "SH", { ftePercentage: 0.8, availabilityRules: avail([1, 2, 3, 4]) });
  const run = (prefs = {}) => {
    const inp = input({ staff: [sh08(), staff("p2", "CD")], scheduleRequests: [leaveReq("p1", W1[0], W1[4])] }, prefs);
    return { inp, r: autoSchedule(inp) };
  };

  it("Friday (not a working day) is X, Mon–Thu AL, and the PP lands on 64/64", () => {
    const { inp, r } = run();
    const g = finalGrid(inp, r, "p1");
    expect(g.get(W1[4])).toEqual({ shiftTypeId: "st-off", step: LEAVE_OFF_STEP });
    for (const d of W1.slice(0, 4)) expect(g.get(d)?.shiftTypeId).toBe("st-al");
    expect(ppHours(inp, r, "p1")).toBe(64);
  });

  it("the X honours the leave request", () => {
    const req = leaveReq("p1", W1[0], W1[4]);
    expect(assignmentSatisfiesRequestOnDate(req, "st-off", (id) => id === "st-off")).toBe(true);
    expect(assignmentSatisfiesRequestOnDate(req, null, (id) => id === "st-off")).toBe(false);
    expect(assignmentSatisfiesRequestOnDate(req, "st-or", (id) => id === "st-off")).toBe(false);
  });

  it("exactly one suggestion per converted cell (STEP 4 adds no duplicate X)", () => {
    const { r } = run();
    expect(r.suggestions.filter((s) => s.staffId === "p1" && s.date === W1[4])).toHaveLength(1);
  });

  it('policy "always" keeps the old output: leave on every requested day', () => {
    const { inp, r } = run({ leaveHoursPolicy: "always" });
    const g = finalGrid(inp, r, "p1");
    expect(g.get(W1[4])?.step).not.toBe(LEAVE_OFF_STEP);
    expect(r.suggestions.some((s) => s.step === LEAVE_OFF_STEP)).toBe(false);
  });

  it("a conditional AVAILABLE rule counts as working: leave is charged", () => {
    const rules = [...avail([1, 2, 3, 4]), { type: "available" as const, strength: "rule" as const, ...wEvery(5), conditionStaffId: "p2", conditionType: "working" as const }];
    expect(couldWorkOn(rules, W1[4], [PP])).toBe(true);
  });

  it("engine: a Friday that is workable only when CD works is charged leave, never pre-judged X", () => {
    const rules = [...avail([1, 2, 3, 4]), { type: "available" as const, strength: "rule" as const, ...wEvery(5), conditionStaffId: "p2", conditionType: "working" as const }];
    const inp = input({ staff: [staff("p1", "SH", { ftePercentage: 0.8, availabilityRules: rules }), staff("p2", "CD")], scheduleRequests: [leaveReq("p1", W1[0], W1[4])] });
    const r = autoSchedule(inp);
    expect(finalGrid(inp, r, "p1").get(W1[4])?.shiftTypeId).toBe("st-al");
  });

  it("a conditional UNAVAILABLE rule is ignored: leave is charged", () => {
    const rules = [...avail([1, 2, 3, 4, 5]), { type: "unavailable" as const, strength: "rule" as const, ...wEvery(5), conditionStaffId: "p2", conditionType: "working" as const }];
    expect(couldWorkOn(rules, W1[4], [PP])).toBe(true);
    expect(couldWorkOn(avail([1, 2, 3, 4]), W1[4], [PP])).toBe(false);
  });
});

describe("engine: leave never past the pay-period target (card #175)", () => {
  // SH shape: week 2 locked by hand (40h); a week of AL on top.
  const run = (fixed: number, extra: ScheduleAssignment[] = [], o: Partial<AutoScheduleInput> = {}) => {
    const inp = input({
      staff: [staff("p1", "SH", { fixedHoursPerPp: fixed }), staff("p2", "CD")],
      existingAssignments: [...W2.map((d) => locked("p1", d)), ...extra],
      scheduleRequests: [leaveReq("p1", W1[0], W1[4])],
      ...o,
    });
    return { inp, r: autoSchedule(inp) };
  };

  it("over by 16: the two LATEST leave days become X; total exactly on target", () => {
    const { inp, r } = run(64);
    const g = finalGrid(inp, r, "p1");
    expect(W1.map((d) => g.get(d)?.shiftTypeId)).toEqual(["st-al", "st-al", "st-al", "st-off", "st-off"]);
    expect(g.get(W1[3])?.step).toBe(LEAVE_OFF_STEP);
    expect(ppHours(inp, r, "p1")).toBe(64);
    for (const d of [W1[3], W1[4]]) expect(r.suggestions.filter((s) => s.staffId === "p1" && s.date === d)).toHaveLength(1);
  });

  it("over by only 4: nothing converts (never under target)", () => {
    const { inp, r } = run(76);
    const g = finalGrid(inp, r, "p1");
    expect(W1.every((d) => g.get(d)?.shiftTypeId === "st-al")).toBe(true);
  });

  it('policy "always": no conversion even when over', () => {
    const { inp, r } = run(64, [], { schedulingPreferences: { ...input().schedulingPreferences, leaveHoursPolicy: "always" } });
    const g = finalGrid(inp, r, "p1");
    expect(W1.every((d) => g.get(d)?.shiftTypeId === "st-al")).toBe(true);
  });

  it("a locked leave cell already on the grid is never converted — this run's own leave goes first", () => {
    const { inp, r } = run(64, [{ ...locked("p1", W1[4], "st-al", "AL"), source: "request" }]);
    const g = finalGrid(inp, r, "p1");
    expect(W1.map((d) => g.get(d)?.shiftTypeId)).toEqual(["st-al", "st-al", "st-off", "st-off", "st-al"]);
    expect(r.suggestions.find((s) => s.staffId === "p1" && s.date === W1[4])).toBeUndefined();
  });

  it("a frozen earlier-month day is never written", () => {
    const { r } = run(64, [], { writableFrom: W1[2] });
    expect(r.suggestions.filter((s) => s.date < W1[2])).toEqual([]);
  });
});

describe("excessLeaveDays (card #175)", () => {
  const L = (date: string, hours = 8) => ({ date, hours });
  it("latest first, while over by at least that day's hours", () => {
    expect(excessLeaveDays(64, 40, [L("a1"), L("a2"), L("a3"), L("a4"), L("a5")])).toEqual(["a5", "a4"]);
  });
  it("never under target", () => {
    expect(excessLeaveDays(76, 40, [L("a1"), L("a2"), L("a3"), L("a4"), L("a5")])).toEqual([]);
    expect(excessLeaveDays(80, 40, [L("a1"), L("a2"), L("a3"), L("a4"), L("a5")])).toEqual([]);
  });
  it("skips a zero-hour day and a day too big for the remaining excess", () => {
    expect(excessLeaveDays(44, 40, [L("a1", 0), L("a2", 12), L("a3", 4)])).toEqual(["a3"]);
  });
});

describe("leave policy parsing (card #175)", () => {
  it("strict for writes, lenient for reads", () => {
    expect(isLeavePolicy("always")).toBe(true);
    expect(isLeavePolicy("sometimes")).toBe(false);
    expect(parseLeavePolicy("sometimes")).toBe("up-to-target");
    expect(parseLeavePolicy(null)).toBe("up-to-target");
  });
});

describe("releasableOffDates (card #175)", () => {
  const T = { kind: "LEAVE" as const, startDate: W1[0], endDate: W1[4] };
  it("a LEAVE releases its request-placed X on every covered date", () => {
    expect(releasableOffDates(T, [], "st-off")).toEqual(W1);
  });
  it("keeps the X where another approved OFF or LEAVE still claims it", () => {
    const other = [
      { kind: "OFF" as const, shiftTypeIds: [], leaveShiftTypeId: null, startDate: W1[1], endDate: W1[1] },
      { kind: "LEAVE" as const, shiftTypeIds: [], leaveShiftTypeId: "st-al", startDate: W1[3], endDate: W1[4] },
      { kind: "REQUEST_SHIFT" as const, shiftTypeIds: ["st-or"], leaveShiftTypeId: null, startDate: W1[2], endDate: W1[2] },
    ];
    expect(releasableOffDates(T, other, "st-off")).toEqual([W1[0], W1[2]]);
  });
  it("other kinds and no off shift release nothing extra", () => {
    expect(releasableOffDates({ ...T, kind: "OFF" }, [], "st-off")).toEqual([]);
    expect(releasableOffDates(T, [], null)).toEqual([]);
  });
});

// ── Approval writes leave too: the same cap at approval time (card #175) ──

describe("approval: leave only on days they'd work, up to target (card #175)", () => {
  const auto = (staffId: string, date: string, shiftTypeId = "st-or", code = "OR"): ScheduleAssignment =>
    ({ staffId, date, shiftTypeId, code, isLocked: false, source: "auto" });
  const ask = (start: string, end = start): ApprovalRequest =>
    ({ id: "r1", staffId: "p1", kind: "LEAVE", shiftTypeIds: [], leaveShiftTypeId: "st-al", startDate: start, endDate: end, strength: "hard" });
  // 0.8 FTE = 64h; already 64h of OR: Mon–Thu both weeks.
  const at64 = W1.slice(0, 4).concat(W2.slice(0, 4)).map((d) => auto("p1", d));
  const approve = (o: Partial<AutoScheduleInput>, req: ApprovalRequest, policy?: "always") => {
    const base = input(o, policy ? { leaveHoursPolicy: policy } : {});
    const d = decideApproval(base, req, "st-al", "resolve-pp", []);
    expect(d.ok, d.ok ? "" : d.reason).toBe(true);
    if (!d.ok) throw new Error(d.reason);
    return d.writes.filter((w) => w.staffId === "p1");
  };
  const p08 = (days = [1, 2, 3, 4, 5]) => staff("p1", "SH", { ftePercentage: 0.8, availabilityRules: avail(days) });

  it("at 64/64, approving leave on a blank workable day writes X, not AL", () => {
    const w = approve({ staff: [p08(), staff("p2", "CD")], existingAssignments: at64 }, ask(W2[4]));
    expect(w).toEqual([{ staffId: "p1", date: W2[4], shiftTypeId: "st-off", source: "request" }]);
  });

  it("a worked day becomes AL (the leave replaces the work's hours)", () => {
    const w = approve({ staff: [p08(), staff("p2", "CD")], existingAssignments: at64 }, ask(W2[3]));
    expect(w).toEqual([{ staffId: "p1", date: W2[3], shiftTypeId: "st-al", source: "request" }]);
  });

  it("a day their rules say they don't work becomes X even under target", () => {
    const w = approve({ staff: [p08([1, 2, 3, 4]), staff("p2", "CD")] }, ask(W1[3], W1[4]));
    expect(w.find((x) => x.date === W1[4])?.shiftTypeId).toBe("st-off");
    expect(w.find((x) => x.date === W1[3])?.shiftTypeId).toBe("st-al");
  });

  it("an existing X is kept, never turned into AL", () => {
    const w = approve({ staff: [p08(), staff("p2", "CD")], existingAssignments: [auto("p1", W1[2], "st-off", "X")] }, ask(W1[2]));
    expect(w.every((x) => x.shiftTypeId !== "st-al")).toBe(true);
  });

  it("a week of leave over target: the latest days are X, total on target", () => {
    // 40h of OR in week 2, a week of AL (40h) in week 1: 80 against 64 → over by 16.
    const wk2 = W2.map((d) => auto("p1", d));
    const w = approve({ staff: [p08(), staff("p2", "CD")], existingAssignments: wk2 }, ask(W1[0], W1[4]));
    const byDate = new Map(w.map((x) => [x.date, x.shiftTypeId]));
    expect(W1.map((d) => byDate.get(d))).toEqual(["st-al", "st-al", "st-al", "st-off", "st-off"]);
  });

  it("a latest day another approval forbids as X stays AL, and the excess moves to an earlier day", () => {
    // 40h of OR in week 2 + a week of AL = 80 against 64 → two days to convert. Friday is
    // also under an approved "no X" request, so Wed and Thu convert instead.
    const wk2 = W2.map((d) => auto("p1", d));
    const noX: ScheduleRequestData = { id: "n1", staffId: "p1", startDate: W1[4], endDate: W1[4], kind: "NEGATE_SHIFT", shiftTypeIds: ["st-off"], leaveShiftTypeId: null, strength: "hard", status: "approved" };
    const w = approve({ staff: [p08(), staff("p2", "CD")], existingAssignments: wk2, scheduleRequests: [noX] }, ask(W1[0], W1[4]));
    const byDate = new Map(w.map((x) => [x.date, x.shiftTypeId]));
    expect(W1.map((d) => byDate.get(d))).toEqual(["st-al", "st-al", "st-off", "st-off", "st-al"]);
  });

  it('policy "always": AL on every requested day', () => {
    const w = approve({ staff: [p08([1, 2, 3, 4]), staff("p2", "CD")], existingAssignments: at64 }, ask(W2[4]), "always");
    expect(w).toEqual([{ staffId: "p1", date: W2[4], shiftTypeId: "st-al", source: "request" }]);
  });
});

describe("request sync: an auto-approved leave whose day is X stays approved (card #175)", () => {
  it("X on every covered day satisfies the leave, so reconciliation never reverts it", () => {
    const req = leaveReq("p1", W1[3], W1[4], { autoApproved: true });
    const isOff = (id: string) => id === "st-off";
    const cellOn = (d: string) => (d === W1[4] ? "st-off" : "st-al");
    const satisfied = isRequestSatisfied(req, cellOn, isOff);
    expect(satisfied).toBe(true);
    expect(reconcileApprovalAction({ id: req.id, status: "approved", autoApproved: true }, satisfied)).toBe("none");
    // …and a blank day still reverts it.
    expect(isRequestSatisfied(req, (d) => (d === W1[4] ? null : "st-al"), isOff)).toBe(false);
  });
});

describe("releasing an OFF never yanks the X an approved LEAVE relies on (card #175)", () => {
  const leave = { kind: "LEAVE" as const, shiftTypeIds: [], leaveShiftTypeId: "st-al", startDate: W1[3], endDate: W1[4] };
  it("deleting an OFF keeps the X on the days an approved LEAVE covers", () => {
    expect(releasableDates({ startDate: W1[2], endDate: W1[4] }, "st-off", [leave], "st-off")).toEqual([W1[2]]);
  });
  it("releasing the leave shift itself still ignores LEAVEs of other shifts", () => {
    expect(releasableDates({ startDate: W1[3], endDate: W1[4] }, "st-or", [leave], "st-off")).toEqual([W1[3], W1[4]]);
  });
});

describe("no request-violation warning for X on a leave day (card #175)", () => {
  it("checkRequestConflict accepts X for an approved hard LEAVE", () => {
    const c = checkRequestConflict({ requests: [leaveReq("p1", W1[0], W1[0])], staffId: "p1", date: W1[0], assignedShiftTypeId: "st-off", isOffShift: true, codeOf: (id) => id });
    expect(c).toEqual([]);
  });
});
