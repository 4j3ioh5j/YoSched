// Card #183: a requested leave day that a conditional availability rule rules out ("EF is not
// available when CD works") is a day off, not leave, when the condition person's day is known.
// couldWorkOn takes `known(staffId, date)`: true = fixed working, false = fixed not working,
// undefined = not decided yet (read optimistically, as before).
import { describe, it, expect } from "vitest";
import { couldWorkOn } from "../leave-policy";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const FRI = "2027-02-05"; // a Friday
const base = [1, 2, 3, 4].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const cond = (type: "available" | "unavailable", conditionType: "working" | "not_working") => ({
  type, strength: "rule" as const, ...wEvery(5), conditionStaffId: "cd", conditionType,
});
const fri5 = { type: "available" as const, strength: "rule" as const, ...wEvery(5) };
const k = (v: boolean | undefined) => (sid: string, d: string) => (sid === "cd" && d === FRI ? v : undefined);

describe("couldWorkOn with known condition cells (card #183)", () => {
  it("no `known` keeps today's optimistic reading", () => {
    expect(couldWorkOn([...base, fri5, cond("unavailable", "working")], FRI, [])).toBe(true);
    expect(couldWorkOn([...base, cond("available", "working")], FRI, [])).toBe(true);
  });
  it("unknown condition person: optimistic, as before", () => {
    expect(couldWorkOn([...base, fri5, cond("unavailable", "working")], FRI, [], k(undefined))).toBe(true);
    expect(couldWorkOn([...base, cond("available", "working")], FRI, [], k(undefined))).toBe(true);
  });
  it("'unavailable when CD works': CD fixed working → off; CD fixed off → can work", () => {
    expect(couldWorkOn([...base, fri5, cond("unavailable", "working")], FRI, [], k(true))).toBe(false);
    expect(couldWorkOn([...base, fri5, cond("unavailable", "working")], FRI, [], k(false))).toBe(true);
  });
  it("'unavailable when CD is not working': CD fixed off → off; CD fixed working → can work", () => {
    expect(couldWorkOn([...base, fri5, cond("unavailable", "not_working")], FRI, [], k(false))).toBe(false);
    expect(couldWorkOn([...base, fri5, cond("unavailable", "not_working")], FRI, [], k(true))).toBe(true);
  });
  it("'available only when CD works': CD fixed off → off; CD fixed working → can work", () => {
    expect(couldWorkOn([...base, cond("available", "working")], FRI, [], k(false))).toBe(false);
    expect(couldWorkOn([...base, cond("available", "working")], FRI, [], k(true))).toBe(true);
  });
  it("'available only when CD is not working': CD fixed working → off; CD fixed off → can work", () => {
    expect(couldWorkOn([...base, cond("available", "not_working")], FRI, [], k(true))).toBe(false);
    expect(couldWorkOn([...base, cond("available", "not_working")], FRI, [], k(false))).toBe(true);
  });
  it("a known cell on another date or for another person does not decide the rule", () => {
    const other = (sid: string) => (sid === "zz" ? true : undefined);
    expect(couldWorkOn([...base, fri5, cond("unavailable", "working")], FRI, [], other)).toBe(true);
  });
});

// ── Engine and approval (card #183) ──
import { autoSchedule, LEAVE_OFF_STEP, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
import { withDayCaps, type TestShift } from "./test-day-caps";
import type { ScheduleRequestData } from "../schedule-requests";

const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const staff = (id: string, initials: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials, ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off", "st-al"], availabilityRules: avail([1, 2, 3, 4, 5]),
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
const W1 = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"]; // Mon..Fri
const W2 = ["2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const PP = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
const FRI1 = W1[4];
const leaveReq = (staffId: string, start: string, end: string): ScheduleRequestData =>
  ({ id: `q-${staffId}-${start}`, staffId, startDate: start, endDate: end, kind: "LEAVE", shiftTypeIds: [], leaveShiftTypeId: "st-al", strength: "hard", status: "approved" });
const fixedCell = (staffId: string, date: string, shiftTypeId: string, code: string): ScheduleAssignment =>
  ({ staffId, date, shiftTypeId, code, isLocked: true, source: "manual" });
const efRule = (type: "available" | "unavailable", conditionType: "working" | "not_working") =>
  ({ type, strength: "rule" as const, ...wEvery(5), conditionStaffId: "cd", conditionType });
function engineInput(efRules: ScheduleStaff["availabilityRules"], existing: ScheduleAssignment[], cdRules = avail([1, 2, 3, 4, 5])): AutoScheduleInput {
  return withDayCaps({
    dates: [...W1, ...W2],
    staff: [staff("ef", "EF", { availabilityRules: efRules }), staff("cd", "CD", { availabilityRules: cdRules })],
    shiftTypes: [OR, OFF, AL],
    existingAssignments: existing,
    payPeriods: [PP],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [], staffingRequirements: [],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
    equityFactors: [], followRules: [],
    scheduleRequests: [leaveReq("ef", FRI1, FRI1)],
  });
}
const efFriday = (inp: AutoScheduleInput) => autoSchedule(inp).suggestions.find((s) => s.staffId === "ef" && s.date === FRI1);

describe("engine: leave on a day a conditional rule rules out (card #183)", () => {
  const notWhenCdWorks = [...avail([1, 2, 3, 4, 5]), efRule("unavailable", "working")];
  it("(a) CD locked working that Friday → EF's requested leave is X, not AL", () => {
    const s = efFriday(engineInput(notWhenCdWorks, [fixedCell("cd", FRI1, "st-or", "OR")]));
    expect(s?.shiftTypeId).toBe("st-off");
    expect(s?.step).toBe(LEAVE_OFF_STEP);
  });
  it("(b) CD not fixed but the finished schedule has CD working that Friday → X", () => {
    // CD works every weekday (full time, OR fill shift): the engine places CD on Friday.
    const inp = engineInput(notWhenCdWorks, []);
    const r = autoSchedule(inp);
    const cd = r.suggestions.find((x) => x.staffId === "cd" && x.date === FRI1);
    expect(cd?.shiftTypeId).toBe("st-or");
    expect(r.suggestions.find((x) => x.staffId === "ef" && x.date === FRI1)?.shiftTypeId).toBe("st-off");
  });
  it("(c) CD fixed off that Friday → AL kept", () => {
    const s = efFriday(engineInput(notWhenCdWorks, [fixedCell("cd", FRI1, "st-off", "X")]));
    expect(s?.shiftTypeId).toBe("st-al");
  });
  it("(d) 'available only when CD works', CD fixed off → X", () => {
    const s = efFriday(engineInput([...avail([1, 2, 3, 4]), efRule("available", "working")], [fixedCell("cd", FRI1, "st-off", "X")]));
    expect(s?.shiftTypeId).toBe("st-off");
  });
  it("(d2) 'available only when CD works', CD fixed working → AL kept", () => {
    const s = efFriday(engineInput([...avail([1, 2, 3, 4]), efRule("available", "working")], [fixedCell("cd", FRI1, "st-or", "OR")]));
    expect(s?.shiftTypeId).toBe("st-al");
  });
  it("(e) the final-grid swap is refused when a day off there would break a follow rule", () => {
    // EF works OR (locked) on Thursday; after OR only OR or AL may follow — never a day off.
    const inp = engineInput(notWhenCdWorks, [fixedCell("ef", W1[3], "st-or", "OR")]);
    inp.followRules = [
      { sourceShiftId: "st-or", allowedShiftId: "st-or", allowOffShifts: false, mode: "allow" },
      { sourceShiftId: "st-or", allowedShiftId: "st-al", allowOffShifts: false, mode: "allow" },
    ];
    const r = autoSchedule(inp);
    expect(r.suggestions.find((x) => x.staffId === "cd" && x.date === FRI1)?.shiftTypeId).toBe("st-or");
    expect(r.suggestions.find((x) => x.staffId === "ef" && x.date === FRI1)?.shiftTypeId).toBe("st-al");
    expect(r.warnings.some((w) => w.startsWith(`EF ${FRI1}: requested leave kept`))).toBe(true);
  });
  it("(e2) STEP 0 keeps AL when a day off would break a follow rule (CD fixed working)", () => {
    const inp = engineInput(notWhenCdWorks, [fixedCell("ef", W1[3], "st-or", "OR"), fixedCell("cd", FRI1, "st-or", "OR")]);
    inp.followRules = [
      { sourceShiftId: "st-or", allowedShiftId: "st-or", allowOffShifts: false, mode: "allow" },
      { sourceShiftId: "st-or", allowedShiftId: "st-al", allowOffShifts: false, mode: "allow" },
    ];
    const r = autoSchedule(inp);
    expect(r.suggestions.find((x) => x.staffId === "ef" && x.date === FRI1)?.shiftTypeId).toBe("st-al");
    expect(r.warnings.filter((w) => w.startsWith(`EF ${FRI1}: requested leave kept`))).toHaveLength(1);
  });
  it("(f) the hours a late AL→X takes away are given back on another open day (Codex #1414)", () => {
    // EF is half time (40h): before the late pass EF reaches 40 with 8h AL + 32h OR. CD's
    // finished Friday rules the AL day out; X takes 8h away, and EF has free weekdays to make it up.
    const inp = engineInput(notWhenCdWorks, []);
    inp.staff = inp.staff.map((p) => (p.id === "ef" ? { ...p, ftePercentage: 0.5 } : p));
    const r = autoSchedule(inp);
    expect(r.suggestions.find((x) => x.staffId === "cd" && x.date === FRI1)?.shiftTypeId).toBe("st-or");
    expect(r.suggestions.find((x) => x.staffId === "ef" && x.date === FRI1)?.shiftTypeId).toBe("st-off");
    const efHours = r.suggestions.filter((x) => x.staffId === "ef" && (x.shiftTypeId === "st-or" || x.shiftTypeId === "st-al")).length * 8;
    expect(efHours).toBe(40);
  });
  it("(g) a loaded unlocked work cell is fixed too (the engine never overwrites it) → X", () => {
    const s = efFriday(engineInput(notWhenCdWorks, [{ staffId: "cd", date: FRI1, shiftTypeId: "st-or", code: "OR", isLocked: false, source: "imported" }]));
    expect(s?.shiftTypeId).toBe("st-off");
    expect(s?.step).toBe(LEAVE_OFF_STEP);
  });
  it("(h) a loaded unlocked auto X is still open (the engine may fill it) → read as undecided at STEP 0", () => {
    // 'available only when CD works': an open CD Friday is optimistic at STEP 0; the engine
    // then fills CD's Friday (full time), so AL is kept.
    const s = efFriday(engineInput([...avail([1, 2, 3, 4]), efRule("available", "working")], [{ staffId: "cd", date: FRI1, shiftTypeId: "st-off", code: "X", isLocked: false, source: "auto" }]));
    expect(s?.shiftTypeId).toBe("st-al");
  });
  it("(i) the refill never takes a day that breaks someone else's conditional rule", () => {
    // GH may not work Mon–Thu when EF works; EF's refill must not land on a day GH already works.
    const inp = engineInput(notWhenCdWorks, []);
    const ghRules = [...avail([1, 2, 3, 4, 5]), ...[1, 2, 3, 4].map((d) => ({ type: "unavailable" as const, strength: "rule" as const, ...wEvery(d), conditionStaffId: "ef", conditionType: "working" as const }))];
    inp.staff = [...inp.staff.map((p) => (p.id === "ef" ? { ...p, ftePercentage: 0.5 } : p)), staff("gh", "GH", { availabilityRules: ghRules })];
    const r = autoSchedule(inp);
    const works = (sid: string, d: string) => r.suggestions.some((x) => x.staffId === sid && x.date === d && x.shiftTypeId === "st-or");
    for (const d of [...W1, ...W2].filter((d) => d !== FRI1 && d !== W2[4])) expect(works("ef", d) && works("gh", d), d).toBe(false);
    expect(r.warnings.filter((w) => w.startsWith("GH ") && w.includes("removed"))).toEqual([]);
  });
  it("(j) a refill never undoes another person's earlier AL→X judgement (Codex #1423)", () => {
    // GH may not work Mondays when EF is off; GH asked for leave on W1 Monday. While EF is off
    // that Monday, GH's leave becomes X; EF's later refill must not then put EF on that Monday
    // (GH could work again, so GH's X would charge 0 of 8 leave hours on a workable day).
    const inp = engineInput(notWhenCdWorks, []);
    const ghRules = [...avail([1, 2, 3, 4, 5]), { type: "unavailable" as const, strength: "rule" as const, ...wEvery(1), conditionStaffId: "ef", conditionType: "not_working" as const }];
    // GH first, so GH's leave is judged (and turned to X) before EF's refill runs.
    inp.staff = [staff("gh", "GH", { availabilityRules: ghRules }), ...inp.staff.map((p) => (p.id === "ef" ? { ...p, ftePercentage: 0.5 } : p))];
    inp.scheduleRequests = [...(inp.scheduleRequests ?? []), leaveReq("gh", W1[0], W1[0])];
    const r = autoSchedule(inp);
    const at = (sid: string, d: string) => r.suggestions.find((x) => x.staffId === sid && x.date === d);
    const efWorks = at("ef", W1[0])?.shiftTypeId === "st-or";
    const ghOff = at("gh", W1[0])?.step === LEAVE_OFF_STEP;
    expect(efWorks && ghOff).toBe(false);
  });
  it("no conditional rules → AL kept (unchanged)", () => {
    expect(efFriday(engineInput(avail([1, 2, 3, 4, 5]), []))?.shiftTypeId).toBe("st-al");
  });
});
