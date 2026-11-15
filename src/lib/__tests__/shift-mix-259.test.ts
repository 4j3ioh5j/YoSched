import { describe, it, expect } from "vitest";
import { autoSchedule, countedHoursFn, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
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

function hoursOf(inp: AutoScheduleInput, r: ReturnType<typeof autoSchedule>, who: string): number {
  const h = countedHoursFn(inp);
  const g = new Map<string, string>();
  for (const a of inp.existingAssignments) if (a.staffId === who) g.set(a.date, a.shiftTypeId);
  for (const s of r.suggestions) if (s.staffId === who) g.set(s.date, s.shiftTypeId);
  let t = 0;
  for (const [d, sid] of g) if (d >= PP.startDate && d <= PP.endDate) t += h(who, sid, d);
  return t;
}
function grid(inp: AutoScheduleInput, r: ReturnType<typeof autoSchedule>): string {
  const code = new Map(inp.shiftTypes.map((s) => [s.id, s.code]));
  const g = new Map<string, string>();
  for (const a of inp.existingAssignments) g.set(`${a.staffId}:${a.date}`, code.get(a.shiftTypeId)! + "*");
  for (const s of r.suggestions) g.set(`${s.staffId}:${s.date}`, s.code);
  return inp.staff.map((p) => `${p.initials.padEnd(3)} ${String(hoursOf(inp, r, p.id)).padStart(3)} | ` + [...W1, ...W2].map((d) => (g.get(`${p.id}:${d}`) ?? "-").padEnd(5)).join("")).join("\n");
}

// ── Feb 2027 shape ──
// KO is on leave until W2 Tue (AL ×6 = 48 h), so 32 h are left; KO prefers 2 PRE a week (max 2).
// ORL: exactly one a weekday, so nine ORLs after the W1 holiday — someone holds an odd number.
const PRE_PREF = { shiftTypeId: "st-pre", minCount: 2, maxCount: 2, window: "week" as const, windowDays: null, strength: "preference" as const };
const NO_ORL = ELIG.filter((x) => x !== "st-orl");
// Today's run: KO gets OR 20, ORL 21, ORL 22 (32 h) and no PRE; DH holds three ORLs and ends +4.
// The legal fix: DH takes KO's ORL on one day, KO works the two PRE they want, DH drops an OR.
type Shape = { koTargets?: ScheduleStaff["shiftMinimumTargets"]; koElig?: string[]; koRules?: ScheduleStaff["shiftEligibilityRules"]; pre?: Partial<TestShift>; extraReqs?: AutoScheduleInput["staffingRequirements"]; extra?: Partial<AutoScheduleInput> };
function febShape(o: Shape = {}) {
  const ko = staff("ko", { eligibleShiftTypeIds: o.koElig ?? [...ELIG, "st-pre"], shiftMinimumTargets: o.koTargets ?? [PRE_PREF], ...(o.koRules ? { shiftEligibilityRules: o.koRules } : {}) });
  const people = [ko, staff("cd"), staff("ya"), staff("bc", { eligibleShiftTypeIds: NO_ORL }), staff("dh")];
  const leave = [W1[0], W1[1], W1[3], W1[4], W2[0]].map((d) => manual("ko", d, "st-al", "AL"));
  return input({
    staff: people,
    shiftTypes: [OR, OFF, ORL, { ...PRE, ...o.pre }, HOL, AL],
    holidays: [{ date: W1[2] }],
    existingAssignments: leave,
    staffingRequirements: [...req("st-or", "OR", 2), ...req("st-orl", "ORL", 1, 1), ...(o.extraReqs ?? [])],
    ...o.extra,
  });
}
const cells = (r: ReturnType<typeof autoSchedule>, who: string, st: string) => r.suggestions.filter((s) => s.staffId === who && s.shiftTypeId === st).map((s) => s.date).sort();
const devTotal = (inp: AutoScheduleInput, r: ReturnType<typeof autoSchedule>) => inp.staff.reduce((t, p) => t + Math.abs(hoursOf(inp, r, p.id) - 80), 0);
function coverageHolds(r: ReturnType<typeof autoSchedule>) {
  for (const d of [...W1, ...W2]) {
    if (d === W1[2]) continue;
    expect(r.suggestions.filter((s) => s.date === d && s.shiftTypeId === "st-orl"), d).toHaveLength(1);
    expect(r.suggestions.filter((s) => s.date === d && s.shiftTypeId === "st-or").length, d).toBeGreaterThanOrEqual(2);
  }
}
/** The base case stays +4 somewhere, with no PRE placed for KO beyond `maxPre`. */
function staysOff(inp: AutoScheduleInput, r: ReturnType<typeof autoSchedule>, maxPre = 0) {
  expect(devTotal(inp, r), grid(inp, r)).toBe(4);
  expect(cells(r, "ko", "st-pre").length, grid(inp, r)).toBeLessThanOrEqual(maxPre);
  expect(r.warnings.some((w) => /over target — 84\/80hrs \(\+4\)/.test(w))).toBe(true);
}

describe("mixing shift lengths so hours land exactly (card #259)", () => {
  it("Feb shape: KO works the 2 PRE they want, DH holds the freed ORL and drops an OR — everyone on 80", () => {
    const inp = febShape();
    const r = autoSchedule(inp);
    for (const p of inp.staff) expect(hoursOf(inp, r, p.id), `${p.initials}\n${grid(inp, r)}`).toBe(80);
    expect(cells(r, "ko", "st-pre")).toHaveLength(2);
    expect(cells(r, "ko", "st-pre").every((d) => W2.includes(d))).toBe(true);
    coverageHolds(r);
    expect(r.warnings.filter((w) => /target —/.test(w))).toEqual([]);
    // Nobody else ever gets PRE (only KO wants it), and the reason says why.
    expect(r.suggestions.filter((s) => s.shiftTypeId === "st-pre" && s.staffId !== "ko")).toEqual([]);
    for (const s of r.suggestions.filter((x) => x.shiftTypeId === "st-pre")) expect(s.reason).toMatch(/PRE a week|hours repair/);
  });

  it("never a shift purely for hours: without KO's PRE target no PRE is placed and DH stays +4", () => {
    const inp = febShape({ koTargets: [] });
    staysOff(inp, autoSchedule(inp));
  });

  it("up to that amount: with a target of 1 PRE (max 1) the 2-PRE fix is not used", () => {
    const inp = febShape({ koTargets: [{ ...PRE_PREF, minCount: 1, maxCount: 1 }] });
    staysOff(inp, autoSchedule(inp), 1);
  });

  it("exactly at a HARD max is allowed (2 PRE, rule strength, max 2)", () => {
    const inp = febShape({ koTargets: [{ ...PRE_PREF, strength: "rule" }] });
    const r = autoSchedule(inp);
    for (const p of inp.staff) expect(hoursOf(inp, r, p.id), grid(inp, r)).toBe(80);
    expect(cells(r, "ko", "st-pre")).toHaveLength(2);
  });

  it("a staffing requirement still unmet that day is a shift someone is meant to get", () => {
    // No KO target; PRE needs one person on W2 Tue and Wed, and only KO can work it.
    const preReq = [{ shiftTypeId: "st-pre", shiftCode: "PRE", dayKey: "2", minCount: 1, preferredCount: 1, maxCount: 1 }, { shiftTypeId: "st-pre", shiftCode: "PRE", dayKey: "3", minCount: 1, preferredCount: 1, maxCount: 1 }];
    const inp = febShape({ koTargets: [], extraReqs: preReq });
    const r = autoSchedule(inp);
    for (const p of inp.staff) expect(hoursOf(inp, r, p.id), `${p.initials}\n${grid(inp, r)}`).toBe(80);
    expect(cells(r, "ko", "st-pre").filter((d) => W2.includes(d))).toEqual([W2[1], W2[2]]);
    coverageHolds(r);
  });

  it("never under: if the mix would leave KO 2 h under (9 h PRE), it is not used", () => {
    const inp = febShape({ pre: { defaultHours: 9 } });
    const r = autoSchedule(inp);
    expect(hoursOf(inp, r, "ko"), grid(inp, r)).toBeGreaterThanOrEqual(80);
    staysOff(inp, r);
  });

  it.each(["each_day", "each_run"] as const)("a shift that owes a required follower (%s) is never used to make hours", (scope) => {
    const inp = febShape({ extra: { requiredFollowers: [{ sourceShiftId: "st-pre", followerShiftId: "st-off", scope, countsTowardTargets: true }] } });
    staysOff(inp, autoSchedule(inp));
  });

  it("not eligible for PRE (activation unticked): no PRE", () => {
    const inp = febShape({ koElig: ELIG });
    staysOff(inp, autoSchedule(inp));
  });

  it("an eligibility rule that bars PRE in W2 is honoured", () => {
    const inp = febShape({ koRules: [{ shiftTypeId: "st-pre", type: "ineligible" as const, strength: "rule" as const, ...whenToColumns(legacyPatternToWhen({ dayOfWeek: 2, pattern: "every" })) }, { shiftTypeId: "st-pre", type: "ineligible" as const, strength: "rule" as const, ...wEvery(3) }, { shiftTypeId: "st-pre", type: "ineligible" as const, strength: "rule" as const, ...wEvery(4) }, { shiftTypeId: "st-pre", type: "ineligible" as const, strength: "rule" as const, ...wEvery(5) }] });
    staysOff(inp, autoSchedule(inp));
  });

  it("a Hard minimum gap on ORL is honoured by the person taking the freed ORL", () => {
    // Days in a row form one block; blocks of ORL for one person must be at least 5 days apart.
    const inp = febShape({ extra: {} });
    inp.shiftTypes = inp.shiftTypes.map((st) => (st.id === "st-orl" ? { ...st, minGapDays: 5, minGapStrength: "rule" as const } : st));
    const r = autoSchedule(inp);
    for (const p of inp.staff) {
      const ds = [...inp.existingAssignments.filter((a) => a.staffId === p.id && a.shiftTypeId === "st-orl").map((a) => a.date), ...cells(r, p.id, "st-orl")].sort();
      for (let i = 1; i < ds.length; i++) {
        const gap = Math.round((Date.parse(ds[i]) - Date.parse(ds[i - 1])) / 86400000);
        expect(gap === 1 || gap >= 5, `${p.initials} ${ds.join(",")}\n${grid(inp, r)}`).toBe(true);
      }
    }
  });

  it("a follow rule (no ORL straight after PRE, no PRE straight after ORL) is honoured", () => {
    const block = [{ sourceShiftId: "st-pre", allowedShiftId: "st-orl", allowOffShifts: false, mode: "block" }, { sourceShiftId: "st-orl", allowedShiftId: "st-pre", allowOffShifts: false, mode: "block" }];
    const inp = febShape({ extra: { followRules: block } });
    const r = autoSchedule(inp);
    expect(devTotal(inp, r), grid(inp, r)).toBe(4);
  });

  it("a rolling max (at most 1 PRE in any 7 days, Hard) is held on the final grid — across the week boundary too", () => {
    const inp = febShape({ koTargets: [PRE_PREF, { shiftTypeId: "st-pre", minCount: 0, maxCount: 1, window: "days", windowDays: 7, strength: "rule" }] });
    const r = autoSchedule(inp);
    const pre = cells(r, "ko", "st-pre");
    for (let i = 1; i < pre.length; i++) expect(Math.round((Date.parse(pre[i]) - Date.parse(pre[i - 1])) / 86400000)).toBeGreaterThanOrEqual(7);
    staysOff(inp, r, 1);
  });

  it("the shift a reshape replaces keeps its daily minimum (OR min 3 here leaves no OR to give up)", () => {
    const inp = febShape();
    inp.staffingRequirements = inp.staffingRequirements.map((q) => (q.shiftTypeId === "st-or" ? { ...q, minCount: 3, preferredCount: 3 } : q));
    const r = autoSchedule(inp);
    for (const d of W2) expect(r.suggestions.filter((s) => s.date === d && s.shiftTypeId === "st-or").length, `${d}\n${grid(inp, r)}`).toBeGreaterThanOrEqual(Math.min(3, autoSchedule({ ...inp, skipShiftMixForTest: true }).suggestions.filter((s) => s.date === d && s.shiftTypeId === "st-or").length));
  });

  it("up to that amount with no max: a target of 1 PRE (no max) still never gets a 2nd PRE from the mix", () => {
    const inp = febShape({ koTargets: [{ ...PRE_PREF, minCount: 1, maxCount: null }] });
    staysOff(inp, autoSchedule(inp), 1);
  });

  it("a SOFT rolling max (at most 1 PRE in any 7 days, Prefer) is never passed by the mix either", () => {
    const inp = febShape({ koTargets: [PRE_PREF, { shiftTypeId: "st-pre", minCount: 0, maxCount: 1, window: "days", windowDays: 7, strength: "preference" }] });
    staysOff(inp, autoSchedule(inp), 1);
  });

  it("a soft request to avoid PRE in W2 is honoured", () => {
    const inp = febShape({ extra: { scheduleRequests: [{ id: "q1", staffId: "ko", startDate: W2[1], endDate: W2[4], kind: "NEGATE_SHIFT", shiftTypeIds: ["st-pre"], leaveShiftTypeId: null, strength: "soft", status: "approved" }] } });
    const r = autoSchedule(inp);
    expect(cells(r, "ko", "st-pre").filter((d) => r.suggestions.find((s) => s.staffId === "ko" && s.date === d)?.reason.includes("hours repair")), grid(inp, r)).toEqual([]);
  });

  it("a hard min target on the shift a reshape replaces is kept (KO must hold 2 OR in the pay period)", () => {
    const inp = febShape({ koTargets: [PRE_PREF, { shiftTypeId: "st-or", minCount: 2, maxCount: null, window: "pay_period", windowDays: null, strength: "rule" }] });
    const r = autoSchedule(inp);
    expect(cells(r, "ko", "st-or").length, grid(inp, r)).toBeGreaterThanOrEqual(2);
  });

  it("never on a holiday (holiday policy none leaves the holiday open)", () => {
    const inp = febShape({ extra: { holidays: [{ date: W2[2] }] } });
    inp.schedulingPreferences = { ...inp.schedulingPreferences, holidayPolicy: "none" };
    const r = autoSchedule(inp);
    expect(r.suggestions.filter((s) => s.date === W2[2] && /hours repair: /.test(s.reason)), grid(inp, r)).toEqual([]);
  });

  it.each([
    ["no target", { koTargets: [] }],
    ["9 h PRE (would go under)", { pre: { defaultHours: 9 } }],
    ["follow rule", { extra: { followRules: [{ sourceShiftId: "st-pre", allowedShiftId: "st-orl", allowOffShifts: false, mode: "block" }, { sourceShiftId: "st-orl", allowedShiftId: "st-pre", allowOffShifts: false, mode: "block" }] } }],
    ["required follower", { extra: { requiredFollowers: [{ sourceShiftId: "st-pre", followerShiftId: "st-off", scope: "each_day" as const, countsTowardTargets: true }] } }],
    ["rolling max", { koTargets: [PRE_PREF, { shiftTypeId: "st-pre", minCount: 0, maxCount: 1, window: "days" as const, windowDays: 7, strength: "rule" as const }] }],
  ] as [string, Shape][])("refused compounds roll back exactly (%s): same suggestions, order and counts as without the step", (_n, o) => {
    const inp = febShape(o);
    const a = autoSchedule(inp), b = autoSchedule({ ...inp, skipShiftMixForTest: true });
    expect(a.suggestions).toEqual(b.suggestions);
    expect(a.stats.byStep).toEqual(b.stats.byStep);
  });

  // Codex #1226 CRITICAL: a reshape must never replace one day of an existing weekend pair.
  it("never splits a weekend pair: A keeps both CALLs rather than trading Saturday for the PRE they want", () => {
    const SAT = "2025-05-17", SUN = "2025-05-18";
    const CALL = shift("st-call", "CALL", { defaultHours: 12, defaultHoursWeekend: 12, weekendPaired: true, schedulePriority: 20 });
    const PREW = { ...PRE, defaultHoursWeekend: 10 };
    const a = staff("a", { fixedHoursPerPp: 22, eligibleShiftTypeIds: ["st-call", "st-pre", "st-off"], availabilityRules: avail([0, 6]),
      shiftMinimumTargets: [{ shiftTypeId: "st-pre", minCount: 1, maxCount: 1, window: "pay_period", windowDays: null, strength: "preference" }] });
    const b = staff("b", { eligibleShiftTypeIds: [...ELIG, "st-call"] });
    const inp = input({
      dates: [...W1, SAT, SUN],
      staff: [a, b, staff("c"), staff("e")],
      shiftTypes: [OR, OFF, ORL, PREW, HOL, AL, CALL],
      existingAssignments: [manual("b", SAT, "st-call", "CALL")],
      staffingRequirements: [...req("st-or", "OR", 1), { shiftTypeId: "st-call", shiftCode: "CALL", dayKey: "6", minCount: 1, preferredCount: 1, maxCount: null }, { shiftTypeId: "st-call", shiftCode: "CALL", dayKey: "0", minCount: 1, preferredCount: 1, maxCount: null }],
    });
    const base = autoSchedule({ ...inp, skipShiftMixForTest: true });
    const r = autoSchedule(inp);
    const mine = (x: typeof r) => x.suggestions.filter((s) => s.staffId === "a" && (s.date === SAT || s.date === SUN)).map((s) => `${s.date}:${s.code}`).sort();
    expect(mine(base), "fixture: the engine gives A the Sat/Sun CALL pair").toEqual([`${SAT}:CALL`, `${SUN}:CALL`]);
    expect(mine(r)).toEqual(mine(base));
  });

  // Codex #1226 CRITICAL, the trade path: a T2 swap must never take one day of a weekend pair.
  // P is 12 h under holding a CALL pair (8 h a day) and Monday's ORL; A is on target with
  // Saturday's 20 h WK and a manual OR, and wants one 12 h PRE. The only hours fix is the trade
  // "P takes A's Saturday WK, A takes P's Saturday CALL and works the PRE on Wednesday", which
  // would leave P a lone Sunday CALL. A plain swap gains nothing (A would end 12 h under).
  it("never splits a weekend pair in a trade: P keeps both CALLs rather than trading Saturday for A's WK", () => {
    const SAT = "2025-05-17", SUN = "2025-05-18";
    const CALL = shift("st-call", "CALL", { defaultHours: 8, defaultHoursWeekend: 8, weekendPaired: true, schedulePriority: 20 });
    const WK = shift("st-wk", "WK", { defaultHours: 20, defaultHoursWeekend: 20, schedulePriority: 22 });
    const p = staff("p", { fixedHoursPerPp: 40, eligibleShiftTypeIds: ["st-call", "st-wk", "st-orl", "st-off"], availabilityRules: avail([0, 1, 6]) });
    const a = staff("a", { fixedHoursPerPp: 28, eligibleShiftTypeIds: ["st-call", "st-wk", "st-pre", "st-or", "st-off"], availabilityRules: avail([3, 4, 6]),
      shiftMinimumTargets: [{ shiftTypeId: "st-pre", minCount: 1, maxCount: 1, window: "pay_period", windowDays: null, strength: "preference" }] });
    const ORONLY = ["st-or", "st-off", "st-hol", "st-al"];
    const inp = input({
      dates: [...W1, SAT, SUN],
      staff: [p, a, staff("c", { fixedHoursPerPp: 40, eligibleShiftTypeIds: ORONLY }), staff("e", { fixedHoursPerPp: 40, eligibleShiftTypeIds: ORONLY })],
      shiftTypes: [OR, OFF, ORL, { ...PRE, defaultHours: 12 }, HOL, AL, CALL, WK],
      existingAssignments: [manual("a", W1[3], "st-or", "OR")],
      staffingRequirements: [...req("st-or", "OR", 1),
        { shiftTypeId: "st-orl", shiftCode: "ORL", dayKey: "1", minCount: 1, preferredCount: 1, maxCount: 1 },
        ...["6", "0"].map((dayKey) => ({ shiftTypeId: "st-call", shiftCode: "CALL", dayKey, minCount: 1, preferredCount: 1, maxCount: 1 })),
        { shiftTypeId: "st-wk", shiftCode: "WK", dayKey: "6", minCount: 1, preferredCount: 1, maxCount: 1 }],
    });
    const base = autoSchedule({ ...inp, skipShiftMixForTest: true });
    const r = autoSchedule(inp);
    const wk = (x: typeof r) => x.suggestions.filter((s) => s.date === SAT || s.date === SUN).filter((s) => s.code !== "X").map((s) => `${s.staffId}:${s.date}:${s.code}`).sort();
    expect(wk(base), "fixture: P holds the pair, A the WK").toEqual([`a:${SAT}:WK`, `p:${SAT}:CALL`, `p:${SUN}:CALL`]);
    expect(wk(r)).toEqual(wk(base));
    expect(cells(r, "a", "st-pre")).toEqual([]);
  });

  // Codex #1226 WARNING: in a trade, the absorber ends no further from target than they started.
  it.each([[10], [11], [12]])("a trade never leaves the absorber further from target (PRE %i h)", (h) => {
    const inp = febShape({ pre: { defaultHours: h } });
    const base = autoSchedule({ ...inp, skipShiftMixForTest: true });
    const r = autoSchedule(inp);
    for (const p of inp.staff) {
      expect(Math.abs(hoursOf(inp, r, p.id) - 80), `${p.initials} (PRE ${h} h)\n${grid(inp, r)}`).toBeLessThanOrEqual(Math.abs(hoursOf(inp, base, p.id) - 80));
    }
  });
});

// ── Sweep: Phase C never makes anything worse, and only ever places a wanted shift ──
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
describe("sweep: mixing in wanted shifts never makes anything worse (card #259)", () => {
  const ALL = [...W1, ...W2];
  for (let seed = 1; seed <= 60; seed++) {
    it(`shape ${seed}`, () => {
      const R = rng(seed), pick = <T,>(xs: readonly T[]): T => xs[Math.floor(R() * xs.length)];
      const preH = pick([10, 10, 10, 9, 11, 12]);
      const tgt = pick([2, 2, 2, 0, 1, 3]);
      const targets = tgt === 0 ? [] : [{ shiftTypeId: "st-pre", minCount: tgt, maxCount: pick([tgt, tgt + 1, null]), window: pick(["week", "pay_period"] as const), windowDays: null, strength: pick(["preference", "rule"] as const) }];
      const leaveN = pick([5, 5, 5, 3, 4, 6]);
      const hol = pick([W1[2], W1[2], null, W2[2]]);
      const leaveDays = ALL.filter((d) => d !== hol).slice(0, leaveN);
      const orMin = pick([2, 2, 1, 3]);
      const hosts = pick([3, 3, 3, 2, 4]);
      const preReqDay = pick([null, null, null, "2", "4"]);
      const ko = staff("ko", { eligibleShiftTypeIds: [...ELIG, "st-pre"], shiftMinimumTargets: targets });
      const others = ["cd", "ya", "bc", "dh"].map((id, i) => staff(id, i < hosts ? {} : { eligibleShiftTypeIds: NO_ORL }));
      const inp = input({
        staff: [ko, ...others],
        shiftTypes: [OR, OFF, ORL, { ...PRE, defaultHours: preH }, HOL, AL],
        holidays: hol ? [{ date: hol }] : [],
        existingAssignments: leaveDays.map((d) => manual("ko", d, "st-al", "AL")),
        staffingRequirements: [...req("st-or", "OR", orMin), ...req("st-orl", "ORL", 1, 1),
          ...(preReqDay ? [{ shiftTypeId: "st-pre", shiftCode: "PRE", dayKey: preReqDay, minCount: 1, preferredCount: 1, maxCount: 1 }] : [])],
      });
      const a = autoSchedule(inp), b = autoSchedule({ ...inp, skipShiftMixForTest: true });
      const ctx = `seed ${seed} preH ${preH} tgt ${JSON.stringify(targets)} leave ${leaveN} hol ${hol} orMin ${orMin} hosts ${hosts} preReq ${preReqDay}\nwith:\n${grid(inp, a)}\nwithout:\n${grid(inp, b)}`;
      // Never worse on total hours, never anyone further under.
      expect(devTotal(inp, a), ctx).toBeLessThanOrEqual(devTotal(inp, b));
      for (const p of inp.staff) expect(Math.max(0, 80 * p.ftePercentage - hoursOf(inp, a, p.id)), `${p.initials} ${ctx}`).toBeLessThanOrEqual(Math.max(0, 80 * p.ftePercentage - hoursOf(inp, b, p.id)));
      // Coverage minimums and day caps: never below what the run without the step had, never over Max.
      for (const d of ALL) for (const q of inp.staffingRequirements.filter((x) => x.dayKey === String(new Date(d + "T12:00:00").getDay()))) {
        if (hol === d) continue;
        const n = (r: ReturnType<typeof autoSchedule>) => r.suggestions.filter((s) => s.date === d && s.shiftTypeId === q.shiftTypeId).length;
        expect(n(a), `${d} ${q.shiftTypeId} ${ctx}`).toBeGreaterThanOrEqual(Math.min(q.minCount, n(b)));
        if (q.maxCount != null) expect(n(a), `${d} ${q.shiftTypeId} ${ctx}`).toBeLessThanOrEqual(q.maxCount);
      }
      // Only a wanted shift: nobody but KO ever holds PRE unless the day required it, and KO's
      // PRE never exceed the target's amount in a week beyond what the run without the step had.
      const added = a.suggestions.filter((s) => s.shiftTypeId === "st-pre" && /hours repair: /.test(s.reason));
      for (const s of added) {
        const day = String(new Date(s.date + "T12:00:00").getDay());
        const reqd = preReqDay === day;
        expect(s.staffId === "ko" && (tgt > 0 || reqd) || reqd, `${s.staffId} ${s.date} ${ctx}`).toBe(true);
      }
      if (tgt > 0 && !preReqDay) {
        const t = targets[0];
        const inWin = (ds: string[]) => (t.window === "week" ? [W1, W2].map((w) => ds.filter((d) => w.includes(d)).length) : [ds.length]);
        const aN = inWin(cells(a, "ko", "st-pre")), bN = inWin(cells(b, "ko", "st-pre"));
        aN.forEach((n, i) => expect(n, ctx).toBeLessThanOrEqual(Math.max(t.minCount, bN[i])));
      }
    });
  }
});
