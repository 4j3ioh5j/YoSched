import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleResult, type ScheduleStaff } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

// Card #260: "at least N days between two of the same shift for one person", Hard or Prefer.
// Same shape as card #233's test: 10 ORL weekdays (12 h, max 1/day, paired with 8 h OR).

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const shift = (id: string, code: string, o: Partial<TestShift> = {}): TestShift => ({
  id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
  countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
  sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
  ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
});
const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const VAC = shift("st-vac", "VAC", { isLeave: true, countsTowardFte: true, autoSchedulable: false });
const OR = shift("st-or", "OR", { schedulePriority: 1, isFillShift: true });
const orl = (o: Partial<TestShift> = {}) => shift("st-orl", "ORL", { defaultHours: 12, schedulePriority: 2, maxPerDay: 1, spreadOverMonth: true, ...o });

const weekdays = (start: string, n: number): string[] => {
  const out: string[] = []; const d = new Date(start + "T12:00:00");
  while (out.length < n) { if (d.getDay() >= 1 && d.getDay() <= 5) out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
};
const DATES = weekdays("2025-05-12", 10); // Mon 12 .. Fri 23
const person = (id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-orl", "st-off", "st-vac"],
  availabilityRules: [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })),
  isActive: true, isAutoScheduled: true, specialQualifications: [], ...o,
});
const approved = (staffId: string, date: string, shiftTypeId: string, code: string) => ({ staffId, date, shiftTypeId, code, isLocked: true, source: "manual" });
// "a" is off Mon 12 .. Mon 19 (KO's shape): only Tue 20 .. Fri 23 are open, so any pair
// it hosts is at most 3 days apart.
const aLeave = DATES.slice(0, 6).map((d) => approved("a", d, "st-off", "X"));

const NO_ORL_AFTER_ORL = [{ sourceShiftId: "st-orl", allowedShiftId: "st-or", allowOffShifts: true, mode: "allow" }];

function run(o: Record<string, unknown> = {}): AutoScheduleResult {
  return autoSchedule(withDayCaps({
    dates: DATES,
    staff: ["a", "b", "c", "d", "e"].map((id) => person(id)),
    shiftTypes: [OR, orl(), OFF, VAC],
    existingAssignments: [], holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [],
    // As in the department: no ORL the day after an ORL (so a "pair" can't be two days in a row).
    dayPreferences: [], historicalAssignments: [], equityFactors: [], followRules: NO_ORL_AFTER_ORL,
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }],
    staffingRequirements: [1, 2, 3, 4, 5].map((d) => ({ shiftTypeId: "st-orl", dayKey: String(d), minCount: 1 })),
    schedulingPreferences: { holidayShiftId: "st-hol", prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
    ...o,
  } as Parameters<typeof autoSchedule>[0]));
}
const orlDays = (r: AutoScheduleResult, id: string, extra: string[] = []) =>
  [...r.suggestions.filter((s) => s.staffId === id && s.code === "ORL").map((s) => s.date), ...extra].sort();
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const closest = (days: string[]) => { let m = Infinity; for (let i = 1; i < days.length; i++) m = Math.min(m, dayDiff(days[i - 1], days[i])); return m; };
const gapWarnings = (r: AutoScheduleResult) => r.warnings.filter((w) => /days apart/.test(w));
const SIX = ["a", "b", "c", "d", "e", "f"];
const dump = (r: AutoScheduleResult, ids: string[]) => JSON.stringify(Object.fromEntries(ids.map((id) => [id, orlDays(r, id)])));

describe("Prefer: hosts with room to space the pair (card #260)", () => {
  it("a cramped person who reaches target either way does not get the pair when roomy people are level with it", () => {
    // 6 people, 10 ORL days: 5 pairs, so one person goes without. All start at 0. "a" is open
    // Mon 19 .. Fri 23 only (best pair 4 days apart) and works 40 h a pay period: five 8 h
    // days or a pair plus two days, so leaving the pair to someone else costs them nothing.
    const off = DATES.slice(0, 5).map((d) => approved("a", d, "st-off", "X"));
    const staff = SIX.map((id) => person(id, id === "a" ? { fixedHoursPerPp: 40 } : {}));
    const r = run({ staff, shiftTypes: [OR, orl({ minGapDays: 5, minGapStrength: "preference" }), OFF, VAC], existingAssignments: off });
    expect(orlDays(r, "a"), dump(r, SIX)).toEqual([]);
    for (const id of SIX) expect(closest(orlDays(r, id)), `${id} ${dump(r, SIX)}`).toBeGreaterThanOrEqual(5);
    expect(gapWarnings(r)).toEqual([]);
    expect(r.warnings.filter((w) => /target —/.test(w))).toEqual([]);
  });

  it("a cramped person who can't reach target keeps the pair (hours first) and the close pair is warned", () => {
    // Open only Tue 20 .. Fri 23 of an 80 h pay period: without the pair they'd be 8 h shorter.
    const o = { staff: SIX.map((id) => person(id)), existingAssignments: aLeave };
    const plain = run(o);
    const pref = run({ ...o, shiftTypes: [OR, orl({ minGapDays: 5, minGapStrength: "preference" }), OFF, VAC] });
    expect(orlDays(pref, "a").length, dump(pref, SIX)).toBe(orlDays(plain, "a").length);
    const hrs = (r: AutoScheduleResult) => r.warnings.filter((w) => /target —/.test(w)).sort();
    expect(hrs(pref)).toEqual(hrs(plain));
    if (closest(orlDays(pref, "a")) < 5) expect(gapWarnings(pref).some((w) => w.startsWith("A:")), JSON.stringify(pref.warnings)).toBe(true);
  });

  it("without the setting nothing about who hosts changes (the room key is off)", () => {
    const base = { staff: SIX.map((id) => person(id)), existingAssignments: aLeave };
    const key = (r: AutoScheduleResult) => r.suggestions.map((s) => `${s.staffId}|${s.date}|${s.code}`).sort().join(";");
    expect(key(run({ ...base, shiftTypes: [OR, orl({ minGapDays: null }), OFF, VAC] }))).toBe(key(run(base)));
  });

  it("when the cramped person must still host, the pair is placed and warned, and nobody gets an extra pair", () => {
    const pref = run({ shiftTypes: [OR, orl({ minGapDays: 5, minGapStrength: "preference" }), OFF, VAC], existingAssignments: aLeave });
    const plain = run({ existingAssignments: aLeave });
    for (const id of ["a", "b", "c", "d", "e"]) expect(orlDays(pref, id).length, id).toBe(orlDays(plain, id).length);
    for (const id of ["a", "b", "c", "d", "e"]) {
      const days = orlDays(pref, id);
      if (closest(days) < 5) expect(gapWarnings(pref).some((w) => w.startsWith(id.toUpperCase() + ":") && /at least 5 wanted/.test(w)), `${id} ${JSON.stringify(pref.warnings)}`).toBe(true);
    }
  });
});

describe("Hard: never two of the same shift closer than N (card #260)", () => {
  const hard = orl({ minGapDays: 5, minGapStrength: "rule" });

  it("no engine-placed pair is closer than 5 days", () => {
    const r = run({ shiftTypes: [OR, hard, OFF, VAC], existingAssignments: aLeave });
    for (const id of ["a", "b", "c", "d", "e"]) expect(closest(orlDays(r, id)), `${id} ${dump(r, ["a", "b", "c", "d", "e"])}`).toBeGreaterThanOrEqual(5);
  });

  it("when nobody can take a day without breaking it, the day stays short and the warning says why", () => {
    // Only a and b can work ORL; a is open Tue 20 .. Fri 23, b holds ORL on Wed 21 by hand, and
    // no ORL may follow an ORL: b can't take 20 or 22, a can take only one of 20/22.
    const only = (id: string) => person(id, { eligibleShiftTypeIds: ["st-or", "st-orl", "st-off", "st-vac"] });
    const others = ["c", "d", "e"].map((id) => person(id, { eligibleShiftTypeIds: ["st-or", "st-off", "st-vac"] }));
    // ORL is needed on Tue and Thu only: 13, 15, 20, 22.
    const r = run({
      staff: [only("a"), only("b"), ...others], shiftTypes: [OR, hard, OFF, VAC],
      existingAssignments: [...aLeave, approved("b", DATES[7], "st-orl", "ORL")],
      staffingRequirements: [2, 4].map((d) => ({ shiftTypeId: "st-orl", dayKey: String(d), minCount: 1 })),
    });
    for (const id of ["a", "b"]) expect(closest(orlDays(r, id, id === "b" ? [DATES[7]] : [])), `${id} ${dump(r, ["a", "b"])}`).toBeGreaterThanOrEqual(5);
    expect(r.warnings.some((w) => /minimum gap between two ORL/.test(w)), JSON.stringify(r.warnings)).toBe(true);
  });

  it("history before the run and next month's cells count", () => {
    // a holds ORL on Fri 9 May (history) and Mon 26 May (next month): Mon 12/Tue 13 and Thu 22/Fri 23 are too close.
    const r = run({
      shiftTypes: [OR, hard, OFF, VAC],
      historicalAssignments: [{ staffId: "a", date: "2025-05-09", shiftTypeId: "st-orl", code: "ORL", isLocked: false, source: "auto" }],
      spreadContext: [{ staffId: "a", date: "2025-05-26", shiftTypeId: "st-orl", code: "ORL", isLocked: false, source: "auto" }],
    });
    expect(orlDays(r, "a").filter((d) => ["2025-05-12", "2025-05-13", "2025-05-22", "2025-05-23"].includes(d))).toEqual([]);
  });

  it("Prefer ranks those days last instead of blocking them", () => {
    const r = run({
      shiftTypes: [OR, orl({ minGapDays: 5, minGapStrength: "preference" }), OFF, VAC],
      historicalAssignments: [{ staffId: "a", date: "2025-05-09", shiftTypeId: "st-orl", code: "ORL", isLocked: false, source: "auto" }],
      spreadContext: [{ staffId: "a", date: "2025-05-26", shiftTypeId: "st-orl", code: "ORL", isLocked: false, source: "auto" }],
    });
    expect(orlDays(r, "a").filter((d) => ["2025-05-12", "2025-05-13", "2025-05-22", "2025-05-23"].includes(d))).toEqual([]);
  });

  it("a pair entered entirely by hand is warned as hand-entered and doesn't stop the run", () => {
    const r = run({ shiftTypes: [OR, hard, OFF, VAC], existingAssignments: [approved("b", DATES[0], "st-orl", "ORL"), approved("b", DATES[2], "st-orl", "ORL")] });
    expect(r.warnings.some((w) => w.startsWith("B:") && /both entered by hand/.test(w)), JSON.stringify(r.warnings)).toBe(true);
    expect(r.suggestions.filter((s) => s.code === "ORL")).toHaveLength(8);
  });
});

describe("splitting a block can't break a Hard gap (Codex #1190)", () => {
  it("an engine ORL block is never left with a hole that makes two blocks too close", () => {
    // CALL-like 3-day ORL blocks: no max/day, each person meant to get 3 in a row. Every engine
    // path that later frees or swaps a day must not leave 10/12-style splits.
    const hard = orl({ minGapDays: 5, minGapStrength: "rule", maxPerDay: undefined, spreadOverMonth: false });
    const r = run({ shiftTypes: [OR, hard, OFF, VAC], existingAssignments: aLeave, followRules: [] });
    for (const id of ["a", "b", "c", "d", "e"]) {
      const days = orlDays(r, id);
      // Blocks: consecutive weekdays (Fri→Mon counts as a 3-day gap, not consecutive).
      for (let i = 1; i < days.length; i++) {
        const g = dayDiff(days[i - 1], days[i]);
        expect(g === 1 || g >= 5, `${id} ${days.join(",")}`).toBe(true);
      }
    }
  });
});

describe("the ORL day swaps never bring two ORLs closer for distance from other shifts (card #260)", () => {
  // RMc's shape: hand-entered CALLs (also marked "spread out") around the ORL days. The swaps
  // may trade days to clear the CALLs, but never so that the closest pair of ORLs gets closer.
  const CALL = shift("st-call", "CALL", { autoSchedulable: false, spreadOverMonth: true });
  const ids = ["a", "b", "c", "d", "e"];
  const shapes: [string, number][][] = [
    [["a", 8], ["b", 1], ["c", 6]],
    [["a", 1], ["a", 8], ["b", 3]],
    [["b", 2], ["c", 7], ["d", 4]],
    [["a", 4], ["b", 4], ["e", 9]],
    [["c", 0], ["d", 9], ["e", 5]],
  ];
  it.each(shapes.map((s, i) => [i, s] as const))("shape %i", (_i, calls) => {
    const o = {
      shiftTypes: [OR, orl(), OFF, VAC, CALL],
      staff: ids.map((id) => person(id, { eligibleShiftTypeIds: ["st-or", "st-orl", "st-off", "st-vac", "st-call"] })),
      existingAssignments: calls.map(([id, k]) => approved(id, DATES[k], "st-call", "CALL")),
    };
    const minAll = (r: AutoScheduleResult) => Math.min(...ids.map((id) => closest(orlDays(r, id))));
    const before = run({ ...o, skipJointSpreadForTest: true }), after = run(o);
    expect(minAll(after), `${dump(before, ids)} → ${dump(after, ids)}`).toBeGreaterThanOrEqual(minAll(before));
  });
});

describe("Hard gap holds through every later step (card #260, Codex #1190)", () => {
  // A deterministic sweep of mixed shapes — days off, hand-entered ORLs, part-timers, ORL every
  // weekday or only some — so the hours repair, the compound repair, the day swaps and the
  // rearrangements all get to move cells. Whatever they do, no engine-placed ORL ends up
  // closer than 5 days to another of the same person's, and the run never says it did.
  let seed = 260;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const ids = ["a", "b", "c", "d", "e", "f"];
  const shapes = Array.from({ length: 40 }, () => {
    const off = ids.flatMap((id) => (rnd(3) === 0 ? DATES.slice(rnd(8), rnd(8) + 1 + rnd(3)).map((d) => approved(id, d, "st-off", "X")) : []));
    const fixed = ids.flatMap((id) => (rnd(4) === 0 ? [approved(id, DATES[rnd(10)], "st-orl", "ORL")] : []));
    const seen = new Set<string>();
    const cells = [...fixed, ...off].filter((c) => { const k = `${c.staffId}:${c.date}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const dows = [1, 2, 3, 4, 5].filter(() => rnd(5) > 0);
    const staff = ids.map((id) => person(id, rnd(4) === 0 ? { ftePercentage: 0.6 } : {}));
    return { cells, dows, staff };
  });
  // With and without "no ORL after ORL": without it, ORLs can sit in a row as one stretch,
  // and a later step taking out a middle day would split it.
  it.each(shapes.flatMap((s, i) => [[i, true, s], [i, false, s]] as const))("shape %i, no ORL after ORL: %s", (_i, noRepeat, sh) => {
    const r = run({
      followRules: noRepeat ? NO_ORL_AFTER_ORL : [],
      staff: sh.staff, existingAssignments: sh.cells,
      shiftTypes: [OR, orl({ minGapDays: 5, minGapStrength: "rule" }), OFF, VAC],
      staffingRequirements: sh.dows.map((d) => ({ shiftTypeId: "st-orl", dayKey: String(d), minCount: 1 })),
    });
    for (const id of ids) {
      const engine = orlDays(r, id);
      const all = [...engine, ...sh.cells.filter((c) => c.staffId === id && c.code === "ORL").map((c) => c.date)].sort();
      for (let i = 1; i < all.length; i++) {
        const g = dayDiff(all[i - 1], all[i]);
        if (g === 1) continue; // one stretch (consecutive weekdays)
        if (g < 5 && (engine.includes(all[i - 1]) || engine.includes(all[i]))) throw new Error(`${id}: ${all.join(",")} (${JSON.stringify(r.warnings)})`);
      }
    }
    expect(r.warnings.filter((w) => /at least 5 required\)$/.test(w))).toEqual([]);
  });
});

describe("Prefer gap: never more too-close pairs than with no setting (card #260)", () => {
  let seed = 9260;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const ids = ["a", "b", "c", "d", "e", "f"];
  const shapes = Array.from({ length: 30 }, () => {
    const off = ids.flatMap((id) => (rnd(2) === 0 ? DATES.slice(rnd(8), rnd(8) + 1 + rnd(4)).map((d) => approved(id, d, "st-off", "X")) : []));
    return { off, n: 5 + rnd(3), staff: ids.slice(0, 5 + rnd(2)).map((id) => person(id)) };
  });
  const closePairs = (r: AutoScheduleResult, n: number, who: string[]) =>
    who.reduce((k, id) => { const d = orlDays(r, id); let c = 0; for (let i = 1; i < d.length; i++) if (dayDiff(d[i - 1], d[i]) < n) c++; return k + c; }, 0);
  it.each(shapes.map((s, i) => [i, s] as const))("shape %i", (_i, sh) => {
    const who = sh.staff.map((p) => p.id);
    const base = { staff: sh.staff, existingAssignments: sh.off };
    const plain = run(base);
    const pref = run({ ...base, shiftTypes: [OR, orl({ minGapDays: sh.n, minGapStrength: "preference" }), OFF, VAC] });
    expect(closePairs(pref, sh.n, who), `${dump(plain, who)} → ${dump(pref, who)}`).toBeLessThanOrEqual(closePairs(plain, sh.n, who));
    // …and the same hours for everyone (Prefer never costs hours).
    const hrs = (r: AutoScheduleResult) => r.warnings.filter((w) => /target —/.test(w)).sort();
    expect(hrs(pref)).toEqual(hrs(plain));
  });
});

describe("Prefer gap never changes how many each person gets (card #260, Feb 2027 trial)", () => {
  // Two pay periods. In the Feb 2027 trial a person with fewer ORLs was put behind people
  // with more because their days were close, then got the close leftover days anyway (ST
  // 23/25 Feb) while others got an extra pair. Prefer may only reorder people level on count.
  const DATES2 = weekdays("2025-05-12", 20);
  const PPS = [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }, { startDate: "2025-05-25", endDate: "2025-06-07", targetHours: 80 }];
  let seed = 7260;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  const shapes = Array.from({ length: 40 }, () => {
    const off = ids.flatMap((id) => (rnd(2) === 0 ? DATES2.slice(rnd(16), rnd(16) + 1 + rnd(6)).map((d) => approved(id, d, "st-off", "X")) : []));
    return { off, n: 5 + rnd(3), staff: ids.slice(0, 6 + rnd(2)).map((id) => person(id)) };
  });
  const counts = (r: AutoScheduleResult, who: string[]) => who.map((id) => orlDays(r, id).length).sort((x, y) => x - y).join(",");
  it.each(shapes.map((s, i) => [i, s] as const))("shape %i", (_i, sh) => {
    const who = sh.staff.map((p) => p.id);
    const base = { dates: DATES2, payPeriods: PPS, staff: sh.staff, existingAssignments: sh.off };
    const plain = run(base);
    const pref = run({ ...base, shiftTypes: [OR, orl({ minGapDays: sh.n, minGapStrength: "preference" }), OFF, VAC] });
    expect(counts(pref, who), `${dump(plain, who)} → ${dump(pref, who)}`).toBe(counts(plain, who));
  });
});

describe("Prefer gap, mixed FTE over two pay periods: no worse than without it (card #260)", () => {
  // Part-timers too (in the Feb 2027 trial a 0.6 FTE host took a pair, went over and the
  // hours repair scattered single ORLs). Prefer never costs hours, coverage or evenness, and
  // the result is one consistent schedule (the with/without trial leaves no stray cell).
  const DATES2 = weekdays("2025-05-12", 20);
  const PPS = [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }, { startDate: "2025-05-25", endDate: "2025-06-07", targetHours: 80 }];
  let seed = 8260;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  const shapes = Array.from({ length: 40 }, () => {
    const off = ids.flatMap((id) => (rnd(2) === 0 ? DATES2.slice(rnd(16), rnd(16) + 1 + rnd(6)).map((d) => approved(id, d, "st-off", "X")) : []));
    return { off, n: 5 + rnd(4), staff: ids.slice(0, 5 + rnd(3)).map((id) => person(id, { ftePercentage: [1, 1, 0.8, 0.6][rnd(4)] })) };
  });
  const closePairs = (r: AutoScheduleResult, n: number, who: string[]) =>
    who.reduce((k, id) => { const d = orlDays(r, id); let c = 0; for (let i = 1; i < d.length; i++) if (dayDiff(d[i - 1], d[i]) < n) c++; return k + c; }, 0);
  it.each(shapes.map((s, i) => [i, s] as const))("shape %i", (_i, sh) => {
    const who = sh.staff.map((p) => p.id);
    const base = { dates: DATES2, payPeriods: PPS, staff: sh.staff, existingAssignments: sh.off };
    const plain = run(base);
    const pref = run({ ...base, shiftTypes: [OR, orl({ minGapDays: sh.n, minGapStrength: "preference" }), OFF, VAC] });
    const msg = `${dump(plain, who)} → ${dump(pref, who)}`;
    expect(closePairs(pref, sh.n, who), msg).toBeLessThanOrEqual(closePairs(plain, sh.n, who));
    // Hours: who of the people who can't reach target holds a 12 h ORL may change, but the
    // total short, the total over and the days short never grow.
    const dev = (r: AutoScheduleResult, sign: string) => r.warnings.reduce((n, w) => { const m = /target — .*\(([+-]\d+)\)/.exec(w); return m && m[1][0] === sign ? n + Math.abs(+m[1]) : n; }, 0);
    expect(dev(pref, "-"), msg).toBeLessThanOrEqual(dev(plain, "-"));
    expect(dev(pref, "+"), msg).toBeLessThanOrEqual(dev(plain, "+"));
    const short = (r: AutoScheduleResult) => r.warnings.filter((w) => /below its required/.test(w)).length;
    expect(short(pref), msg).toBeLessThanOrEqual(short(plain));
    const most = (r: AutoScheduleResult) => Math.max(...who.map((id) => orlDays(r, id).length));
    expect(most(pref), msg).toBeLessThanOrEqual(most(plain));
    // One consistent schedule: one cell per person per day, at most one ORL a day, none on a day off.
    const seen = new Set<string>();
    for (const s of pref.suggestions) { const k = `${s.staffId}|${s.date}`; expect(seen.has(k), k).toBe(false); seen.add(k); }
    for (const d of DATES2) expect(pref.suggestions.filter((s) => s.date === d && s.code === "ORL").length, d).toBeLessThanOrEqual(1);
    for (const o of sh.off) expect(seen.has(`${o.staffId}|${o.date}`), `${o.staffId} ${o.date}`).toBe(false);
  });
  it("…and over all the shapes it does space them better", () => {
    let plainClose = 0, prefClose = 0;
    for (const sh of shapes) {
      const who = sh.staff.map((p) => p.id);
      const base = { dates: DATES2, payPeriods: PPS, staff: sh.staff, existingAssignments: sh.off };
      plainClose += closePairs(run(base), sh.n, who);
      prefClose += closePairs(run({ ...base, shiftTypes: [OR, orl({ minGapDays: sh.n, minGapStrength: "preference" }), OFF, VAC] }), sh.n, who);
    }
    // Measured: 67 → 59. Without the with/without trial (later repairs' gap keys only) it is 66.
    expect(prefClose, `${plainClose} → ${prefClose}`).toBeLessThanOrEqual(plainClose - 5);
  }, 60000);
});

describe("Hard gap holds on every path that writes directly (card #260, Codex #1198)", () => {
  // Every engine-placed too-close pair of a Hard shift is a defect; only pairs whose two
  // blocks were both entered by hand may stay.
  const engineBreaks = (r: AutoScheduleResult, ids: string[], code: string, n: number, manual: { staffId: string; date: string; code: string }[] = []) => {
    const out: string[] = [];
    for (const id of ids) {
      const mine = manual.filter((m) => m.staffId === id && m.code === code).map((m) => m.date);
      const days = new Set([...mine, ...r.suggestions.filter((s) => s.staffId === id && s.code === code).map((s) => s.date)]);
      const sorted = [...days].sort();
      const blocks: string[][] = [];
      for (const d of sorted) { const b = blocks[blocks.length - 1]; if (b && dayDiff(b[b.length - 1], d) === 1) b.push(d); else blocks.push([d]); }
      for (let i = 1; i < blocks.length; i++) {
        const gap = dayDiff(blocks[i - 1][blocks[i - 1].length - 1], blocks[i][0]);
        const byHand = [...blocks[i - 1], ...blocks[i]].every((d) => mine.includes(d));
        if (gap < n && !byHand) out.push(`${id} ${blocks[i - 1].at(-1)}|${blocks[i][0]}`);
      }
    }
    return out;
  };

  it("the fill shift: no fill day breaks a Hard gap set on it", () => {
    // Codex repro: OR with N=5 came out 12/14/16/19/21/23 May.
    const r = run({ shiftTypes: [{ ...OR, minGapDays: 5, minGapStrength: "rule" }, orl(), OFF, VAC], existingAssignments: aLeave });
    expect(engineBreaks(r, ["a", "b", "c", "d", "e"], "OR", 5), JSON.stringify(r.suggestions.filter((s) => s.code === "OR").map((s) => `${s.staffId} ${s.date}`))).toEqual([]);
  });

  it("a standing commitment is not placed where it would break a Hard gap, and says why", () => {
    // Codex repro: weekly Monday ORL with N=10 came out on 12 and 19 May.
    const sc = [{ staffId: "a", shiftTypeId: "st-orl", ...whenToColumns(legacyPatternToWhen({ dayOfWeek: 1, pattern: "every" })) }];
    const r = run({ shiftTypes: [OR, orl({ minGapDays: 10, minGapStrength: "rule" }), OFF, VAC], standingCommitments: sc });
    expect(engineBreaks(r, ["a", "b", "c", "d", "e"], "ORL", 10)).toEqual([]);
    expect(r.warnings.some((w) => /^A: standing ORL not placed on 2025-05-19 \(minimum gap between two ORL: at least 10 days, Hard\)/.test(w)), JSON.stringify(r.warnings)).toBe(true);
  });

  it("a required follower is not placed where it would break a Hard gap on the follower", () => {
    const ADM = shift("st-adm", "ADM", { minGapDays: 8, minGapStrength: "rule" });
    const staff = ["a", "b", "c", "d", "e"].map((id) => person(id, { eligibleShiftTypeIds: ["st-or", "st-orl", "st-off", "st-vac", "st-adm"] }));
    const r = run({ staff, shiftTypes: [OR, orl(), OFF, VAC, ADM], requiredFollowers: [{ sourceShiftId: "st-orl", followerShiftId: "st-adm", scope: "each_day", countsTowardTargets: true }] });
    expect(r.suggestions.some((s) => s.code === "ADM"), "the follower is placed at all").toBe(true);
    expect(engineBreaks(r, ["a", "b", "c", "d", "e"], "ADM", 8)).toEqual([]);
    expect(r.warnings.some((w) => /could not place required ADM after ORL .*minimum gap between two ADM: at least 8 days, Hard/.test(w)), JSON.stringify(r.warnings)).toBe(true);
  });

  it("days off are not filled in where they would break a Hard gap set on the off shift", () => {
    const X3 = { ...OFF, minGapDays: 3, minGapStrength: "rule" };
    const r = run({ shiftTypes: [OR, orl(), X3, VAC], staff: ["a", "b", "c", "d", "e"].map((id) => person(id, { fixedHoursPerPp: 40 })) });
    expect(r.suggestions.some((s) => s.code === "X"), "days off are placed at all").toBe(true);
    expect(engineBreaks(r, ["a", "b", "c", "d", "e"], "X", 3)).toEqual([]);
  });

  it("the holiday entitlement is not granted where it would break a Hard gap on the holiday shift", () => {
    // Holidays Tue 13 and Thu 15 May, HOL at least 5 days apart (Hard): the second is not granted.
    const HOL = shift("st-hol", "HOL", { isLeave: true, defaultHours: 8, defaultHoursHoliday: 8, autoSchedulable: false, minGapDays: 5, minGapStrength: "rule" });
    const staff = ["a", "b", "c", "d", "e"].map((id) => person(id, { eligibleShiftTypeIds: ["st-or", "st-orl", "st-off", "st-vac", "st-hol"] }));
    const r = run({
      staff, shiftTypes: [OR, orl(), OFF, VAC, HOL],
      holidays: [{ date: "2025-05-13", name: "H1" }, { date: "2025-05-15", name: "H2" }],
      schedulingPreferences: { holidayShiftId: "st-hol", holidayPolicy: "entitlement", prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
    });
    expect(r.suggestions.some((s) => s.code === "HOL"), JSON.stringify(r.warnings)).toBe(true);
    expect(engineBreaks(r, ["a", "b", "c", "d", "e"], "HOL", 5)).toEqual([]);
    expect(r.warnings.some((w) => /HOL not placed on 2025-05-15 \(minimum gap between two HOL: at least 5 days, Hard\)/.test(w)), JSON.stringify(r.warnings)).toBe(true);
  });

  it("a minimum target is not met by breaking a Hard gap", () => {
    // ORC: no daily requirement, spread over the month, at least 10 days apart (Hard); "a" must
    // have 3 in the pay period. The days are checked once before the step writes any of them.
    const ORC = shift("st-orc", "ORC", { spreadOverMonth: true, minGapDays: 10, minGapStrength: "rule" });
    const staff = ["a", "b", "c", "d", "e"].map((id) => person(id, id === "a"
      ? { eligibleShiftTypeIds: ["st-or", "st-orl", "st-off", "st-vac", "st-orc"], shiftMinimumTargets: [{ shiftTypeId: "st-orc", minCount: 3, window: "pay_period", strength: "rule" }] } : {}));
    const r = run({ staff, shiftTypes: [OR, orl(), OFF, VAC, ORC] });
    const orc = r.suggestions.filter((s) => s.staffId === "a" && s.code === "ORC").map((s) => s.date).sort();
    expect(orc.length, JSON.stringify(orc)).toBeGreaterThan(0);
    expect(engineBreaks(r, ["a"], "ORC", 10), JSON.stringify(orc)).toEqual([]);
  });
});
