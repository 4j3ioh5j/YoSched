import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
import { applyScenario, applyScenarioExpanding, freesForRing } from "../scenario";
import { isPriorRunSpill, writableFromOf } from "../build-auto-schedule-input";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

// Card #174 (David): a month's run never changes any part of an earlier, completed
// month. The first pay period of June starts in May; May's days are read-only
// context (their hours still count toward the pay period), never written.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const staff = (id: string, initials: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials, ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off"],
  availabilityRules: [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })),
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

// PP Sun 2025-05-25 .. Sat 2025-06-07; June's run may write from 2025-06-01.
const MAY = ["2025-05-26", "2025-05-27", "2025-05-28", "2025-05-29", "2025-05-30"];
const JUNE = ["2025-06-02", "2025-06-03", "2025-06-04", "2025-06-05", "2025-06-06"];
const FROM = "2025-06-01";

const autoOR = (staffId: string, date: string): ScheduleAssignment =>
  ({ staffId, date, shiftTypeId: "st-or", code: "OR", isLocked: false, source: "auto" });

function input(o: Partial<AutoScheduleInput> = {}): AutoScheduleInput {
  return withDayCaps({
    dates: [...MAY, ...JUNE],
    staff: [staff("p1", "AB"), staff("p2", "CD")],
    shiftTypes: [OR, OFF],
    existingAssignments: [],
    payPeriods: [{ startDate: "2025-05-25", endDate: "2025-06-07", targetHours: 40 }],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [], staffingRequirements: [],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
    equityFactors: [], followRules: [],
    ...o,
  });
}

const workedIn = (sug: { staffId: string; date: string; shiftTypeId: string }[], who: string, days: string[]) =>
  sug.filter((s) => s.staffId === who && s.shiftTypeId === "st-or" && days.includes(s.date)).length;

describe("engine: writableFrom freezes the earlier month (card #174)", () => {
  it("without writableFrom the run does fill the earlier month (the bug this guards)", () => {
    const r = autoSchedule(input());
    expect(r.suggestions.some((s) => s.date < FROM)).toBe(true);
  });

  it("never suggests a date before writableFrom — empty earlier-month cells stay empty", () => {
    const r = autoSchedule(input({ writableFrom: FROM }));
    expect(r.suggestions.filter((s) => s.date < FROM)).toEqual([]);
    expect(workedIn(r.suggestions, "p1", JUNE)).toBeGreaterThan(0);
  });

  it("earlier-month cells still count toward the pay period's hours", () => {
    // p2 already worked 40h (the whole PP target) in May; p1 worked nothing.
    const r = autoSchedule(input({ writableFrom: FROM, existingAssignments: MAY.map((d) => autoOR("p2", d)) }));
    expect(workedIn(r.suggestions, "p2", JUNE)).toBe(0);
    expect(workedIn(r.suggestions, "p1", JUNE)).toBe(5);
  });

  it("an approved leave request on a frozen date is not placed", () => {
    const AL = shift("st-al", "AL", { isLeave: true });
    const r = autoSchedule(input({
      writableFrom: FROM,
      shiftTypes: [OR, OFF, AL],
      scheduleRequests: [
        { id: "q1", staffId: "p1", startDate: MAY[1], endDate: MAY[1], kind: "LEAVE", shiftTypeIds: [], leaveShiftTypeId: "st-al", strength: "hard", status: "approved" },
        { id: "q2", staffId: "p1", startDate: JUNE[1], endDate: JUNE[1], kind: "LEAVE", shiftTypeIds: [], leaveShiftTypeId: "st-al", strength: "hard", status: "approved" },
      ] as AutoScheduleInput["scheduleRequests"],
    }));
    expect(r.suggestions.find((s) => s.staffId === "p1" && s.date === MAY[1])).toBeUndefined();
    expect(r.suggestions.find((s) => s.staffId === "p1" && s.date === JUNE[1])?.shiftTypeId).toBe("st-al");
  });
});

describe("builder: the earlier run's forward spill is this run's to redo (card #174)", () => {
  const r = (o: Partial<{ date: string; isLocked: boolean; source: string; autoMonth: string | null }>) =>
    ({ date: "2025-06-03", isLocked: false, source: "auto", autoMonth: "2025-05", ...o });
  it("writableFrom is the run month's 1st", () => expect(writableFromOf("2025-06")).toBe("2025-06-01"));
  it("drops an unlocked auto cell an EARLIER run placed on/after the month's 1st", () => {
    expect(isPriorRunSpill(r({}), "2025-06")).toBe(true);
    expect(isPriorRunSpill(r({ date: "2025-06-01" }), "2025-06")).toBe(true);
  });
  it("keeps everything else", () => {
    expect(isPriorRunSpill(r({ date: "2025-05-31" }), "2025-06")).toBe(false); // earlier month: fixed
    expect(isPriorRunSpill(r({ isLocked: true }), "2025-06")).toBe(false);
    expect(isPriorRunSpill(r({ source: "manual" }), "2025-06")).toBe(false);
    expect(isPriorRunSpill(r({ source: "request" }), "2025-06")).toBe(false);
    expect(isPriorRunSpill(r({ source: "imported" }), "2025-06")).toBe(false);
    expect(isPriorRunSpill(r({ autoMonth: "2025-06" }), "2025-06")).toBe(false); // this run's own
    expect(isPriorRunSpill(r({ autoMonth: "2025-07" }), "2025-06")).toBe(false);
    expect(isPriorRunSpill(r({ autoMonth: null }), "2025-06")).toBe(false); // legacy
    expect(isPriorRunSpill(r({}), "2025-06", false)).toBe(false); // staff not scheduled by this run (card #179)
  });
});

describe("Live / scenario: the earlier month is never freed or pinned (card #174)", () => {
  // May filled by an earlier run (unlocked auto: freeable WITHOUT the freeze).
  const mayBaseline = [...MAY.map((d) => autoOR("p1", d)), ...MAY.map((d) => autoOR("p2", d))];
  const inp = () => input({ writableFrom: FROM, existingAssignments: mayBaseline });
  const none = { has: () => false };

  it("freesForRing never frees an earlier-month auto cell at any ring", () => {
    const touched = new Set([JUNE[0]]);
    for (const ring of [1, 2, 3]) {
      expect(freesForRing(inp(), none, touched, ring).filter((f) => f.date < FROM)).toEqual([]);
    }
    // …whereas without the freeze ring 2 (the touched pay period) would free them.
    expect(freesForRing({ ...inp(), writableFrom: undefined }, none, touched, 2).some((f) => f.date < FROM)).toBe(true);
    // An earlier-month touched date frees nothing at ring 1 either.
    expect(freesForRing(inp(), none, new Set([MAY[0]]), 1)).toEqual([]);
  });

  it("a pin on an earlier-month date is rejected (earlier-month), nothing applied", () => {
    const out = applyScenario(inp(), [{ staffId: "p1", date: MAY[0], shiftTypeId: "st-off" }], []);
    expect(out.applied).toBe(false);
    expect(out.rejected).toEqual([{ staffId: "p1", date: MAY[0], shiftTypeId: "st-off", reason: "earlier-month" }]);
  });

  it("an AWAY pin on an earlier-month date is rejected too", () => {
    const out = applyScenario(inp(), [{ staffId: "p1", date: MAY[0], shiftTypeId: "st-off", away: true }], []);
    expect(out.applied).toBe(false);
    expect(out.rejected[0].reason).toBe("earlier-month");
  });

  it("an explicit free of an earlier-month cell is rejected, naming its shift", () => {
    const out = applyScenario(inp(), [], [{ staffId: "p2", date: MAY[2] }]);
    expect(out.applied).toBe(false);
    expect(out.rejected).toEqual([{ staffId: "p2", date: MAY[2], shiftTypeId: "st-or", reason: "earlier-month" }]);
  });

  it("freeing an EMPTY earlier-month cell changes nothing and is ignored", () => {
    const out = applyScenario(input({ writableFrom: FROM }), [], [{ staffId: "p1", date: MAY[0] }]);
    expect(out.applied).toBe(true);
    expect(out.grid.filter((c) => c.date < FROM)).toEqual([]);
  });

  it("a pay-period-wide June edit leaves every May cell unchanged and May still counts toward hours", () => {
    const pins = [{ staffId: "p1", date: JUNE[0], shiftTypeId: "st-off" }];
    const out = applyScenarioExpanding(inp(), pins, [], new Set([JUNE[0]]), { has: (k: string) => k === `p1:${JUNE[0]}` }, "pp");
    expect(out.applied).toBe(true);
    const may = (g: { staffId: string; date: string; shiftTypeId: string }[]) =>
      g.filter((c) => c.date < FROM).map((c) => `${c.staffId}|${c.date}|${c.shiftTypeId}`).sort();
    expect(may(out.grid)).toEqual(may(mayBaseline));
    expect(out.changes.filter((c) => c.date < FROM)).toEqual([]);
    // Both already worked the 40h PP target in May: June gains no OR for either.
    expect(out.grid.filter((c) => c.date >= FROM && c.shiftTypeId === "st-or")).toEqual([]);
  });
});

describe("Live: never frees the cells of staff the engine won't refill (card #180)", () => {
  const none = { has: () => false };
  it("an auto cell of a staff no longer auto-scheduled, or not on the roster, is never freed", () => {
    const inp = input({
      staff: [staff("p1", "AB"), staff("p2", "CD", { isAutoScheduled: false })],
      existingAssignments: [autoOR("p1", JUNE[0]), autoOR("p2", JUNE[0]), autoOR("gone", JUNE[0])],
    });
    for (const ring of [1, 2, 3]) {
      expect(freesForRing(inp, none, new Set([JUNE[0]]), ring)).toEqual([{ staffId: "p1", date: JUNE[0] }]);
    }
  });

  it("a day-scope edit that must widen keeps their capped shift in the preview", () => {
    // Monday needs one OR and one ORC (Max 1). p2 (no longer auto-scheduled) holds the
    // ORC; p1 the OR; p3 is off. Pinning p1 off opens an OR gap, so the re-solve widens
    // to the day and frees what it may — never p2's ORC, which it could not refill.
    const ORC = shift("st-orc", "ORC", { schedulePriority: 0 });
    const both = ["st-or", "st-off", "st-orc"];
    const inp = input({
      shiftTypes: [OR, OFF, ORC],
      staff: [staff("p1", "AB", { eligibleShiftTypeIds: both }), staff("p2", "CD", { isAutoScheduled: false, eligibleShiftTypeIds: both }), staff("p3", "EF", { eligibleShiftTypeIds: both })],
      staffingRequirements: [
        { shiftTypeId: "st-orc", shiftCode: "ORC", dayKey: "1", minCount: 1, preferredCount: 1, maxCount: 1 },
        { shiftTypeId: "st-or", shiftCode: "OR", dayKey: "1", minCount: 1, preferredCount: 1, maxCount: null },
      ] as AutoScheduleInput["staffingRequirements"],
      existingAssignments: [
        { staffId: "p1", date: JUNE[0], shiftTypeId: "st-or", code: "OR", isLocked: false, source: "auto" },
        { staffId: "p2", date: JUNE[0], shiftTypeId: "st-orc", code: "ORC", isLocked: false, source: "auto" },
        { staffId: "p3", date: JUNE[0], shiftTypeId: "st-off", code: "X", isLocked: false, source: "auto" },
      ],
    });
    const out = applyScenarioExpanding(inp, [{ staffId: "p1", date: JUNE[0], shiftTypeId: "st-off" }], [], new Set([JUNE[0]]), { has: (k: string) => k === `p1:${JUNE[0]}` }, "day");
    expect(out.applied).toBe(true);
    expect(out.grid.find((c) => c.staffId === "p2" && c.date === JUNE[0])?.shiftTypeId).toBe("st-orc");
    expect(out.grid.filter((c) => c.date === JUNE[0] && c.shiftTypeId === "st-orc")).toHaveLength(1);
  });
});

