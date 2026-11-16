import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleResult, type ScheduleStaff } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

// Card #233: ORL pairs used to be chosen one host at a time, so the last hosts got the
// leftovers (DH Feb 8/10, SH Feb 24/26 in Feb 2027). Who gets them and how many stays
// the same; only the days are improved, jointly.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const shift = (id: string, code: string, o: Partial<TestShift> = {}): TestShift => ({
  id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
  countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
  sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
  ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
});
const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = shift("st-or", "OR", { schedulePriority: 1, isFillShift: true });
const ORL = shift("st-orl", "ORL", { defaultHours: 12, schedulePriority: 2, maxPerDay: 1, spreadOverMonth: true });

const weekdays = (start: string, n: number): string[] => {
  const out: string[] = []; const d = new Date(start + "T12:00:00");
  while (out.length < n) { if (d.getDay() >= 1 && d.getDay() <= 5) out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
};
const DATES = weekdays("2025-05-12", 10); // Mon 12 .. Fri 23
const IDS = ["a", "b", "c", "d", "e"];
const person = (id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-orl", "st-off"],
  availabilityRules: [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })),
  isActive: true, isAutoScheduled: true, specialQualifications: [], ...o,
});

function run(o: Record<string, unknown> = {}): AutoScheduleResult {
  return autoSchedule(withDayCaps({
    dates: DATES,
    staff: IDS.map((id) => person(id)),
    shiftTypes: [OR, ORL, OFF],
    existingAssignments: [], holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [],
    dayPreferences: [], historicalAssignments: [], equityFactors: [], followRules: [],
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }],
    staffingRequirements: [1, 2, 3, 4, 5].map((d) => ({ shiftTypeId: "st-orl", dayKey: String(d), minCount: 1 })),
    schedulingPreferences: { holidayShiftId: "st-hol", prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
    ...o,
  } as Parameters<typeof autoSchedule>[0]));
}
const orlDays = (r: AutoScheduleResult, id: string) => r.suggestions.filter((s) => s.staffId === id && s.code === "ORL").map((s) => s.date).sort();
const gapDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const minGap = (r: AutoScheduleResult) => Math.min(...IDS.map((id) => { const d = orlDays(r, id); return d.length < 2 ? Infinity : gapDays(d[0], d[1]); }));

describe("ORL days chosen together (card #233)", () => {
  it("nobody is left with two ORLs a few days apart when a swap spreads everyone", () => {
    const r = run();
    // 10 ORL days, 5 people, one pair each: Mon-Mon, Tue-Tue, … gives everyone 7 days.
    expect(minGap(r), JSON.stringify(Object.fromEntries(IDS.map((id) => [id, orlDays(r, id)])))).toBeGreaterThanOrEqual(7);
  });

  it("keeps who gets ORL and how many each", () => {
    const now = run(); const old = run({ skipJointSpreadForTest: true });
    for (const id of IDS) expect(orlDays(now, id).length, id).toBe(orlDays(old, id).length);
    expect(now.suggestions.filter((s) => s.code === "ORL")).toHaveLength(10);
  });

  it("is the same on every run", () => {
    const key = (r: AutoScheduleResult) => r.suggestions.map((s) => `${s.staffId}|${s.date}|${s.code}`).sort().join(";");
    expect(key(run())).toBe(key(run()));
  });
});

// Every guard of the swap search, each on a shape where the search would otherwise make the swap.
const people = (over: Record<string, Partial<ScheduleStaff>> = {}) => IDS.map((id) => person(id, over[id] ?? {}));
const WED = weekdays("2025-05-14", 10); // Wed 14 .. Tue 27
const WED_PP = [{ startDate: "2025-05-14", endDate: "2025-05-27", targetHours: 80 }];
const manual = (staffId: string, date: string, shiftTypeId: string, code: string) => ({ staffId, date, shiftTypeId, code, isLocked: false, source: "manual" });
const allOrl = (r: AutoScheduleResult) => r.suggestions.filter((s) => s.code === "ORL");

describe("the ORL day swaps keep every hard rule (card #233)", () => {
  it("a hard weekly minimum of one ORL is never emptied by a swap", () => {
    // Thu 15 .. Fri 30 May. A works Mon/Tue/Fri; B, C and D don't work Thursdays.
    const days = weekdays("2025-05-15", 12);
    const on = (dows: number[]) => dows.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
    const min = { shiftMinimumTargets: [{ shiftTypeId: "st-orl", minCount: 1, maxCount: null, window: "week" as const, windowDays: null }] };
    const staff = people({ a: { ...min, availabilityRules: on([1, 2, 5]) }, b: { availabilityRules: on([1, 2, 3, 5]) }, c: { availabilityRules: on([1, 2, 3, 5]) }, d: { availabilityRules: on([1, 2, 3, 5]) } });
    const o = { dates: days, staff, payPeriods: [{ startDate: days[0], endDate: days[days.length - 1], targetHours: 80 }] };
    const weekOf = (d: string) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
    const weeks = (res: AutoScheduleResult) => new Set(orlDays(res, "a").map(weekOf));
    const old = run({ ...o, skipJointSpreadForTest: true }), r = run(o);
    expect(weeks(old).has("2025-05-26"), "A holds an ORL in the week of 26 May before the swaps").toBe(true);
    for (const w of weeks(old)) expect(weeks(r).has(w), w).toBe(true);
  });

  it("'F only when E works': the swap never takes E off a day F works by hand", () => {
    const cond = [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, conditionStaffId: "e", conditionType: "working" as const, ...wEvery(d) }));
    const f = person("f", { eligibleShiftTypeIds: ["st-or", "st-off"], availabilityRules: cond, isAutoScheduled: false });
    const old = run({ skipJointSpreadForTest: true });
    const eDay = orlDays(old, "e").find((d) => !orlDays(run(), "e").includes(d))!; // a day the search moves E off
    expect(eDay).toBeDefined(); // (the shape bites)
    const r = run({ staff: [...people(), f], existingAssignments: [manual("f", eDay, "st-or", "OR")] });
    expect(orlDays(r, "e")).toContain(eDay);
  });

  it("an emptied day never breaks a follow rule (PRE must be followed by ORL)", () => {
    const PRE = shift("st-pre", "PRE", { autoSchedulable: false, defaultHours: 0, countsTowardFte: false });
    const old = run({ skipJointSpreadForTest: true }), now = run();
    // A day the search moves someone off, with a day before it to hold PRE.
    const [who, day] = IDS.flatMap((id) => orlDays(old, id).filter((d) => !orlDays(now, id).includes(d) && DATES.indexOf(d) > 0).map((d) => [id, d] as const))[0] ?? [];
    expect(day).toBeDefined(); // (the shape bites)
    const prevDay = DATES[DATES.indexOf(day!) - 1];
    const follow = [{ sourceShiftId: "st-pre", allowedShiftId: "st-orl", allowOffShifts: false, mode: "allow" }];
    const o = { shiftTypes: [OR, ORL, OFF, PRE], followRules: follow, existingAssignments: [manual(who!, prevDay, "st-pre", "PRE")] };
    const before = run({ ...o, skipJointSpreadForTest: true }), r = run(o);
    // Wherever the greedy days put ORL after the PRE, the swaps keep it there.
    expect(orlDays(before, who!), "the PRE day is followed by ORL before the swaps").toContain(day);
    expect(orlDays(r, who!)).toContain(day);
  });

  it("never moves ORL onto an approved day off", () => {
    // A day the search moves someone onto, and the greedy days of that person don't hold.
    const old = run({ skipJointSpreadForTest: true }), now = run();
    const [who, day] = IDS.flatMap((id) => orlDays(now, id).filter((d) => !orlDays(old, id).includes(d)).map((d) => [id, d] as const))[0] ?? [];
    expect(day).toBeDefined(); // (the shape bites)
    const off = { id: "q1", staffId: who!, startDate: day!, endDate: day!, kind: "OFF" as const, shiftTypeIds: [], leaveShiftTypeId: null, strength: "hard" as const, status: "approved" as const };
    const r = run({ scheduleRequests: [off] });
    expect(orlDays(run({ scheduleRequests: [off], skipJointSpreadForTest: true }), who!)).not.toContain(day);
    expect(orlDays(r, who!)).not.toContain(day);
    expect(allOrl(r)).toHaveLength(10);
  });

  it("keeps each person's ORL hours (a 8 h Saturday ORL is not traded for a 12 h weekday)", () => {
    const ORLW = { ...ORL, defaultHoursWeekend: 8 };
    const days = [...DATES, "2025-05-17", "2025-05-24"].sort();
    const sat = { type: "available" as const, strength: "rule" as const, ...wEvery(6) };
    const staff = IDS.map((id) => person(id, { availabilityRules: [...person(id).availabilityRules, sat] }));
    const reqs = [1, 2, 3, 4, 5, 6].map((d) => ({ shiftTypeId: "st-orl", dayKey: String(d), minCount: 1 }));
    const o = { dates: days, staff, shiftTypes: [OR, ORLW, OFF], staffingRequirements: reqs };
    const hrs = (res: AutoScheduleResult, id: string) => orlDays(res, id).reduce((n, d) => n + (new Date(d + "T12:00:00").getDay() === 6 ? 8 : 12), 0);
    const old = run({ ...o, skipJointSpreadForTest: true }), r = run(o);
    for (const id of IDS) expect(hrs(r, id), id).toBe(hrs(old, id));
  });

  it("each person's ORLs per calendar month stay as they were when a pay period spans two months", () => {
    const days = weekdays("2025-06-27", 10); // Fri 27 Jun .. Thu 10 Jul
    const o = { dates: days, payPeriods: [{ startDate: days[0], endDate: days[days.length - 1], targetHours: 80 }] };
    const months = (res: AutoScheduleResult, id: string) => orlDays(res, id).map((d) => d.slice(0, 7)).join(",");
    const old = run({ ...o, skipJointSpreadForTest: true }), r = run(o);
    for (const id of IDS) expect(months(r, id), id).toBe(months(old, id));
  });

  it("leaves a shift with a required follower exactly as before", () => {
    const fol = { requiredFollowers: [{ sourceShiftId: "st-orl", followerShiftId: "st-off", scope: "each_day", countsTowardTargets: false }] };
    const key = (res: AutoScheduleResult) => res.suggestions.map((s) => `${s.staffId}|${s.date}|${s.code}`).sort().join(";");
    expect(key(run(fol))).toBe(key(run({ ...fol, skipJointSpreadForTest: true })));
  });

  it("says so when the search stops at its limit, and what it made is still whole", () => {
    const r = run({ jointSpreadLimitsForTest: { swaps: 1, checks: 50000 } });
    expect(r.warnings).toContain("ORL spread search limit reached in PP 2025-05-11");
    expect(allOrl(r)).toHaveLength(10);
    for (const d of DATES) expect(allOrl(r).filter((s) => s.date === d), d).toHaveLength(1);
    expect(run().warnings.some((w) => w.includes("spread search limit"))).toBe(false);
  });

  it("never moves ORL off a holiday when that makes the person owed holiday hours (Codex #1063)", () => {
    const HOL = shift("st-hol", "HOL", { isLeave: true, autoSchedulable: false, defaultHoursHoliday: 8 });
    const ORLH = { ...ORL, defaultHoursHoliday: 12 };
    const ORH = { ...OR, defaultHoursHoliday: 8 };
    const staff = IDS.map((id) => person(id, { ftePercentage: 0.3, eligibleShiftTypeIds: ["st-or", "st-orl", "st-off", "st-hol"] }));
    const order = [{ key: "overHours", sortOrder: 0, enabled: true, hoursPolicy: "prohibited" as const }];
    const reqs = [...[1, 2, 3, 4, 5].map((d) => ({ shiftTypeId: "st-orl", dayKey: String(d), minCount: 1 })), { shiftTypeId: "st-orl", dayKey: "holiday", minCount: 1 }];
    const hrsOf = (res: AutoScheduleResult, id: string) => res.suggestions.filter((x) => x.staffId === id).reduce((n, x) => n + (x.code === "ORL" ? 12 : x.code === "OR" || x.code === "HOL" ? 8 : 0), 0);
    for (const hol of DATES) {
      const o = { staff, shiftTypes: [ORH, ORLH, OFF, HOL], holidays: [{ date: hol }], staffingRequirements: reqs, factorOrder: order };
      const old = run({ ...o, skipJointSpreadForTest: true }), r = run(o);
      for (const id of IDS) expect(hrsOf(r, id), `${id}, holiday ${hol}`).toBeLessThanOrEqual(Math.max(24, hrsOf(old, id)));
    }
  });

  it("marks a moved day in its reason", () => {
    expect(allOrl(run()).some((s) => s.reason.endsWith(" · spread swap"))).toBe(true);
  });
});
