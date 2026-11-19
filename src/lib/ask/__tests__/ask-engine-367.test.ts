import { describe, it, expect } from "vitest";
import { validateAskSpec, missingRefs, type AskSpec, type Sel } from "../spec";
import { answer, type AskData } from "../engine";
import type { RawShiftTypeRef, RawStaff } from "../../graph/model";

// Card #367: "Ask the schedule" — a question spec in, an answer table out.

const ST: Record<string, RawShiftTypeRef & { name: string }> = {
  D: { id: "d", code: "D", name: "Day", defaultHours: 8, countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false },
  N: { id: "n", code: "N", name: "Night", defaultHours: 12, countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false },
  AL: { id: "al", code: "AL", name: "Annual leave", defaultHours: 8, countsTowardFte: false, countsAsHolidayWork: false, isLeave: true, isOffShift: false },
  O: { id: "o", code: "O", name: "Off", defaultHours: 0, countsTowardFte: false, countsAsHolidayWork: false, isLeave: false, isOffShift: true },
};

function person(id: string, initials: string, extra: Partial<RawStaff> = {}): RawStaff {
  return { id, initials, name: `Name ${initials}`, ftePercentage: 1, isActive: true, isAutoScheduled: true, inFairness: true, employmentTypeId: "et", employmentTypeName: "Full time", eligibleShiftTypeIds: [], ...extra };
}

const CELLS: Array<[string, string, keyof typeof ST]> = [
  // staff, date, shift
  ["a", "2025-12-25", "D"],
  ["a", "2026-01-02", "N"],
  ["a", "2026-01-03", "N"],
  ["a", "2026-01-04", "D"],
  ["a", "2026-01-06", "AL"],
  ["a", "2026-02-10", "N"],
  ["b", "2025-12-25", "N"],
  ["b", "2026-01-01", "D"],
  ["b", "2026-01-02", "O"],
  ["b", "2026-02-11", "D"],
  ["b", "2026-03-01", "N"], // future (today is 2026-02-15)
  ["c", "2025-07-04", "D"], // c has left (inactive)
];

function data(over: Partial<AskData> = {}): AskData {
  return {
    raw: {
      staff: [person("a", "AA"), person("b", "BB"), person("c", "CC", { isActive: false })],
      assignments: CELLS.map(([staffId, date, k]) => ({ staffId, date, shiftTypeId: ST[k].id, shiftType: ST[k] })),
      shiftTypes: Object.values(ST).map((s) => ({ id: s.id, countsTowardFte: s.countsTowardFte, defaultHours: s.defaultHours, defaultHoursWeekend: s.defaultHours, defaultHoursHoliday: s.defaultHours })),
      desirabilityWeights: [],
      holidays: [{ date: "2025-12-25" }, { date: "2026-01-01" }, { date: "2025-07-04" }],
      equityFactors: [],
      overrides: [],
      weekendStartDow: 6,
    },
    shiftTypes: Object.values(ST).map((s) => ({ id: s.id, code: s.code, name: s.name })),
    holidays: [
      { date: "2025-12-25", name: "Christmas Day", holidayTypeId: "xmas" },
      { date: "2026-01-01", name: "New Year's Day", holidayTypeId: "ny" },
      { date: "2025-07-04", name: "Independence Day", holidayTypeId: "jul4" },
    ],
    holidayTypes: [{ id: "xmas", name: "Christmas" }, { id: "ny", name: "New Year" }, { id: "jul4", name: "Fourth of July" }],
    requests: [
      { staffId: "a", kind: "OFF", status: "approved", receivedDate: "2026-01-05" },
      { staffId: "a", kind: "LEAVE", status: "fulfilled", receivedDate: "2026-01-20" },
      { staffId: "a", kind: "OFF", status: "declined", receivedDate: "2026-01-21" },
      { staffId: "b", kind: "OFF", status: "pending", receivedDate: "2026-01-22" },
      { staffId: "b", kind: "OFF", status: "approved", receivedDate: "2025-11-01" }, // before the range
    ],
    ...over,
  };
}

const TODAY = "2026-02-15";
const ALL = { all: true } as const;
const RANGE = { from: "2026-01-01", to: "2026-12-31" };
const col = (a: ReturnType<typeof answer>, key: string) => ("rows" in a ? a.rows.map((r) => r[key]) : []);
function ok(a: ReturnType<typeof answer>) {
  if ("error" in a) throw new Error(a.error);
  return a;
}

describe("validateAskSpec", () => {
  it("accepts a well-formed question", () => {
    const s = { v: 1, kind: "find", which: "first", shifts: { ids: ["n"] }, staff: ALL, range: RANGE };
    expect(validateAskSpec(s)).toEqual({ ok: true, spec: s });
  });

  it("refuses an empty id list, which must never mean 'everyone'", () => {
    const r = validateAskSpec({ v: 1, kind: "find", which: "first", shifts: { ids: [] }, staff: ALL, range: RANGE });
    expect(r.ok).toBe(false);
  });

  it("refuses an unknown version, kind, bad dates and a backwards range", () => {
    const base = { v: 1, kind: "count", by: "staff", shifts: ALL, staff: ALL, range: RANGE };
    expect(validateAskSpec({ ...base, v: 2 }).ok).toBe(false);
    expect(validateAskSpec({ ...base, kind: "nope" }).ok).toBe(false);
    expect(validateAskSpec({ ...base, by: "decade" }).ok).toBe(false);
    expect(validateAskSpec({ ...base, range: { from: "2026-13-01", to: "2026-12-31" } }).ok).toBe(false);
    expect(validateAskSpec({ ...base, range: { from: "2026-02-30", to: "2026-12-31" } }).ok).toBe(false);
    expect(validateAskSpec({ ...base, range: { from: "2026-12-31", to: "2026-01-01" } }).ok).toBe(false);
    expect(validateAskSpec(null).ok).toBe(false);
    expect(validateAskSpec("x").ok).toBe(false);
  });

  it("refuses a selector that is neither all nor a list of ids, and unknown extra keys", () => {
    const base = { v: 1, kind: "count", by: "staff", shifts: ALL, staff: ALL, range: RANGE };
    expect(validateAskSpec({ ...base, staff: { all: false } }).ok).toBe(false);
    expect(validateAskSpec({ ...base, staff: { ids: [1] } }).ok).toBe(false);
    expect(validateAskSpec({ ...base, staff: { all: true, ids: ["a"] } }).ok).toBe(false);
    expect(validateAskSpec({ ...base, extra: 1 }).ok).toBe(false);
  });

  it("caps list sizes so a saved question cannot be huge", () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `id${i}`);
    expect(validateAskSpec({ v: 1, kind: "count", by: "staff", shifts: ALL, staff: { ids }, range: RANGE }).ok).toBe(false);
  });
});

describe("missingRefs: a saved question naming something deleted", () => {
  it("lists the ids that no longer exist instead of quietly dropping them", () => {
    const spec: AskSpec = { v: 1, kind: "count", by: "staff", shifts: { ids: ["n", "gone-shift"] }, staff: { ids: ["a", "gone-person"] }, range: RANGE };
    expect(missingRefs(spec, data())).toEqual({ staff: ["gone-person"], shifts: ["gone-shift"], holidayTypes: [] });
  });

  it("answer() refuses rather than broadening the question", () => {
    const spec: AskSpec = { v: 1, kind: "count", by: "staff", shifts: { ids: ["gone-shift"] }, staff: ALL, range: RANGE };
    const a = answer(spec, data(), TODAY);
    expect("error" in a && a.error).toMatch(/no longer exist/i);
  });
});

describe("find", () => {
  const f = (which: "first" | "last" | "next" | "every", extra: Partial<AskSpec> = {}) =>
    ok(answer({ v: 1, kind: "find", which, shifts: { ids: ["n"] }, staff: ALL, range: RANGE, ...extra } as AskSpec, data(), TODAY));

  it("first: the earliest matching shift per person in the range", () => {
    const a = f("first");
    expect(a.rows.map((r) => `${r.staff} ${r.date} ${r.shift}`)).toEqual(["AA 2026-01-02 N", "BB 2026-03-01 N"]);
  });

  it("last: the latest per person", () => {
    expect(f("last").rows.map((r) => `${r.staff} ${r.date}`)).toEqual(["AA 2026-02-10", "BB 2026-03-01"]);
  });

  it("next: the first on or after today", () => {
    expect(f("next").rows.map((r) => `${r.staff} ${r.date}`)).toEqual(["BB 2026-03-01"]);
  });

  it("every: all matches in date order, and the summary counts them", () => {
    const a = f("every");
    expect(col(a, "date")).toEqual(["2026-01-02", "2026-01-03", "2026-02-10", "2026-03-01"]);
    expect(a.summary).toMatch(/4/);
  });

  it("respects the staff picked and the range ends (inclusive)", () => {
    const a = f("every", { staff: { ids: ["a"] }, range: { from: "2026-01-03", to: "2026-02-10" } });
    expect(col(a, "date")).toEqual(["2026-01-03", "2026-02-10"]);
  });

  it("an answer with no matches says so", () => {
    const a = f("every", { staff: { ids: ["c"] } });
    expect(a.rows).toEqual([]);
    expect(a.summary).toMatch(/none|no /i);
  });
});

describe("count", () => {
  const c = (by: "staff" | "month" | "staffMonth", shifts: Sel = { ids: ["d", "n"] }) =>
    ok(answer({ v: 1, kind: "count", by, shifts, staff: ALL, range: RANGE } as AskSpec, data(), TODAY));

  it("per person, one column per shift picked, plus a total", () => {
    const a = c("staff");
    expect(a.columns.map((x) => x.label)).toEqual(["Staff", "D", "N", "Total"]);
    expect(a.rows).toEqual([
      { staff: "AA", s_d: 1, s_n: 3, total: 4 },
      { staff: "BB", s_d: 2, s_n: 1, total: 3 },
    ]);
  });

  it("per month", () => {
    const a = c("month");
    expect(a.rows).toEqual([
      { month: "2026-01", s_d: 2, s_n: 2, total: 4 },
      { month: "2026-02", s_d: 1, s_n: 1, total: 2 },
      { month: "2026-03", s_d: 0, s_n: 1, total: 1 },
    ]);
  });

  it("per person per month", () => {
    expect(c("staffMonth").rows.map((r) => `${r.staff} ${r.month} ${r.total}`)).toEqual([
      "AA 2026-01 3", "AA 2026-02 1", "BB 2026-01 1", "BB 2026-02 1", "BB 2026-03 1",
    ]);
  });

  it("with any shift, leaves out shift columns nobody had; picked shifts always keep theirs", () => {
    const any = ok(answer({ v: 1, kind: "count", by: "staff", shifts: ALL, staff: { ids: ["a"] }, range: { from: "2026-01-01", to: "2026-01-31" } }, data(), TODAY));
    expect(any.columns.map((x) => x.label)).toEqual(["Staff", "D", "N", "AL", "Total"]);
    const picked = ok(answer({ v: 1, kind: "count", by: "staff", shifts: { ids: ["o", "n"] }, staff: { ids: ["a"] }, range: RANGE }, data(), TODAY));
    expect(picked.columns.map((x) => x.label)).toEqual(["Staff", "N", "O", "Total"]);
  });

  it("an explicitly picked person with nothing still gets a row of zeros", () => {
    const a = ok(answer({ v: 1, kind: "count", by: "staff", shifts: { ids: ["n"] }, staff: { ids: ["c"] }, range: RANGE }, data(), TODAY));
    expect(a.rows).toEqual([{ staff: "CC", s_n: 0, total: 0 }]);
  });
});

describe("whoWorked", () => {
  it("a holiday type across a range: who worked it, on which shift", () => {
    const a = ok(answer({ v: 1, kind: "whoWorked", on: { holidayTypes: { ids: ["xmas"] } }, shifts: ALL, range: { from: "2025-01-01", to: "2025-12-31" } }, data(), TODAY));
    expect(a.rows.map((r) => `${r.date} ${r.holiday} ${r.staff} ${r.shift}`)).toEqual([
      "2025-12-25 Christmas Day AA D",
      "2025-12-25 Christmas Day BB N",
    ]);
  });

  it("any holiday, counting leave and off as not worked", () => {
    const a = ok(answer({ v: 1, kind: "whoWorked", on: { holidayTypes: ALL }, shifts: ALL, range: { from: "2025-01-01", to: "2026-12-31" } }, data(), TODAY));
    expect(a.rows.map((r) => `${r.date} ${r.staff}`)).toEqual(["2025-07-04 CC", "2025-12-25 AA", "2025-12-25 BB", "2026-01-01 BB"]);
  });

  it("chosen dates, limited to a shift", () => {
    const a = ok(answer({ v: 1, kind: "whoWorked", on: { dates: ["2026-01-02", "2026-01-03"] }, shifts: { ids: ["n"] }, range: RANGE }, data(), TODAY));
    expect(a.rows.map((r) => `${r.date} ${r.staff} ${r.shift}`)).toEqual(["2026-01-02 AA N", "2026-01-03 AA N"]);
  });

  it("a holiday nobody worked still shows, as a row saying so", () => {
    const d = data({ holidays: [...data().holidays, { date: "2026-05-25", name: "Memorial Day", holidayTypeId: "mem" }], holidayTypes: [...data().holidayTypes, { id: "mem", name: "Memorial Day" }] });
    const a = ok(answer({ v: 1, kind: "whoWorked", on: { holidayTypes: { ids: ["mem"] } }, shifts: ALL, range: RANGE }, d, TODAY));
    expect(a.rows).toEqual([{ date: "2026-05-25", holiday: "Memorial Day", staff: "(nobody)", shift: "" }]);
  });
});

describe("streak", () => {
  it("work: the longest run of worked days; a blank day breaks it; leave and off break it", () => {
    const a = ok(answer({ v: 1, kind: "streak", mode: "work", staff: { ids: ["a"] }, range: RANGE }, data(), TODAY));
    expect(a.rows).toEqual([{ staff: "AA", length: 3, start: "2026-01-02", end: "2026-01-04" }]);
  });

  it("off: a blank day counts as off, and the run is cut at the range ends", () => {
    const a = ok(answer({ v: 1, kind: "streak", mode: "off", staff: { ids: ["a"] }, range: { from: "2026-01-01", to: "2026-01-10" } }, data(), TODAY));
    // 01-05 (blank), 01-06 (AL), 01-07..01-10 (blank) = 6 days
    expect(a.rows).toEqual([{ staff: "AA", length: 6, start: "2026-01-05", end: "2026-01-10" }]);
  });

  it("shifts: the longest run of the chosen shifts (any shift picked by name counts, leave too)", () => {
    const n = ok(answer({ v: 1, kind: "streak", mode: "shifts", shifts: { ids: ["n"] }, staff: { ids: ["a"] }, range: RANGE }, data(), TODAY));
    expect(n.rows).toEqual([{ staff: "AA", length: 2, start: "2026-01-02", end: "2026-01-03" }]);
    const al = ok(answer({ v: 1, kind: "streak", mode: "shifts", shifts: { ids: ["al"] }, staff: { ids: ["a"] }, range: RANGE }, data(), TODAY));
    expect(al.rows).toEqual([{ staff: "AA", length: 1, start: "2026-01-06", end: "2026-01-06" }]);
  });

  it("only the shifts mode takes a shift list", () => {
    expect(validateAskSpec({ v: 1, kind: "streak", mode: "work", shifts: ALL, staff: ALL, range: RANGE }).ok).toBe(false);
    expect(validateAskSpec({ v: 1, kind: "streak", mode: "shifts", staff: ALL, range: RANGE }).ok).toBe(false);
  });

  it("says how blank days are treated", () => {
    const a = ok(answer({ v: 1, kind: "streak", mode: "work", staff: ALL, range: RANGE }, data(), TODAY));
    expect(a.note).toMatch(/blank/i);
  });

  it("walks a leap day", () => {
    const d = data();
    d.raw.assignments.push(...["2028-02-28", "2028-02-29", "2028-03-01"].map((date) => ({ staffId: "a", date, shiftTypeId: "d", shiftType: ST.D })));
    const a = ok(answer({ v: 1, kind: "streak", mode: "work", staff: { ids: ["a"] }, range: { from: "2028-02-01", to: "2028-03-31" } }, d, TODAY));
    expect(a.rows).toEqual([{ staff: "AA", length: 3, start: "2028-02-28", end: "2028-03-01" }]);
  });
});

describe("ranges", () => {
  it("are at most 20 years", () => {
    expect(validateAskSpec({ v: 1, kind: "streak", mode: "work", staff: ALL, range: { from: "2006-01-01", to: "2025-12-31" } }).ok).toBe(true);
    expect(validateAskSpec({ v: 1, kind: "streak", mode: "work", staff: ALL, range: { from: "2005-01-01", to: "2026-12-31" } }).ok).toBe(false);
  });
});

describe("gap", () => {
  const WIDE = { from: "2025-01-01", to: "2026-12-31" };
  it("shortest, average and longest days between two of them in the range, plus days since the last and the next", () => {
    const a = ok(answer({ v: 1, kind: "gap", shifts: { ids: ["n"] }, staff: ALL, range: WIDE }, data(), TODAY));
    expect(a.rows).toEqual([
      { staff: "AA", times: 3, shortest: 1, average: 19.5, longest: 38, last: "2026-02-10", daysSince: 5, next: null },
      { staff: "BB", times: 2, shortest: 66, average: 66, longest: 66, last: "2025-12-25", daysSince: 52, next: "2026-03-01" },
    ]);
  });

  it("only counts shifts inside the range", () => {
    const a = ok(answer({ v: 1, kind: "gap", shifts: { ids: ["n"] }, staff: { ids: ["a"] }, range: { from: "2026-01-01", to: "2026-01-31" } }, data(), TODAY));
    expect(a.rows).toEqual([{ staff: "AA", times: 2, shortest: 1, average: 1, longest: 1, last: "2026-01-03", daysSince: 43, next: null }]);
  });

  it("an explicitly picked person who never had one still gets a row", () => {
    const a = ok(answer({ v: 1, kind: "gap", shifts: { ids: ["n"] }, staff: { ids: ["c"] }, range: WIDE }, data(), TODAY));
    expect(a.rows).toEqual([{ staff: "CC", times: 0, shortest: null, average: null, longest: null, last: null, daysSince: null, next: null }]);
  });

  it("never gives a negative day count for future-only shifts", () => {
    const a = ok(answer({ v: 1, kind: "gap", shifts: { ids: ["n"] }, staff: { ids: ["b"] }, range: WIDE }, data({ raw: { ...data().raw, assignments: data().raw.assignments.filter((x) => x.date > TODAY) } }), TODAY));
    expect(a.rows).toEqual([{ staff: "BB", times: 1, shortest: null, average: null, longest: null, last: null, daysSince: null, next: "2026-03-01" }]);
  });
});

describe("whoWorked a shift", () => {
  it("on any day: each person who had the shift in the range, how often, first and last", () => {
    const a = ok(answer({ v: 1, kind: "whoWorked", on: { anyDay: true }, shifts: { ids: ["n"] }, range: RANGE }, data(), TODAY));
    expect(a.rows).toEqual([
      { staff: "AA", times: 3, first: "2026-01-02", last: "2026-02-10" },
      { staff: "BB", times: 1, first: "2026-03-01", last: "2026-03-01" },
    ]);
  });
});

describe("fairness", () => {
  it("shows the fairness figures side by side for the range", () => {
    const a = ok(answer({ v: 1, kind: "fairness", staff: ALL, range: RANGE }, data(), TODAY));
    const aa = a.rows.find((r) => r.staff === "AA")!;
    expect(aa.workDays).toBe(4);
    expect(aa.hours).toBe(8 + 12 * 3);
    expect(aa.leaveDays).toBe(1);
  });

  it("never silently drops someone left out of fairness: they get a row that says why", () => {
    const a = ok(answer({ v: 1, kind: "fairness", staff: { ids: ["c"] }, range: { from: "2025-01-01", to: "2025-12-31" } }, data(), TODAY));
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].staff).toBe("CC");
    expect(String(a.rows[0].note)).toMatch(/not in fairness/i);
  });

  it("with everyone picked, a departed person who worked in the range is still listed", () => {
    const a = ok(answer({ v: 1, kind: "fairness", staff: ALL, range: { from: "2025-01-01", to: "2025-12-31" } }, data(), TODAY));
    expect(a.rows.map((r) => r.staff)).toContain("CC");
  });
});

describe("requests", () => {
  const R = (extra: object) => ({ v: 1, kind: "requests", staff: ALL, range: RANGE, kinds: ALL, by: "staff", ...extra }) as AskSpec;
  it("counts made and approved (approved or fulfilled) by the date received", () => {
    const a = ok(answer(R({}), data(), TODAY));
    expect(a.rows).toEqual([
      { staff: "AA", made: 3, approved: 2, declined: 1, pending: 0, withdrawn: 0 },
      { staff: "BB", made: 1, approved: 0, declined: 0, pending: 1, withdrawn: 0 },
    ]);
    expect(a.note).toMatch(/received/i);
  });

  it("filters by kind", () => {
    const a = ok(answer(R({ kinds: { ids: ["LEAVE"] } }), data(), TODAY));
    expect(a.rows).toEqual([{ staff: "AA", made: 1, approved: 1, declined: 0, pending: 0, withdrawn: 0 }]);
  });

  it("groups by kind", () => {
    const a = ok(answer(R({ by: "kind" }), data(), TODAY));
    expect(a.rows).toEqual([
      { kind: "Day off", made: 3, approved: 1, declined: 1, pending: 1, withdrawn: 0 },
      { kind: "Leave", made: 1, approved: 1, declined: 0, pending: 0, withdrawn: 0 },
    ]);
  });

  it("groups by status, showing only the statuses that occur", () => {
    const a = ok(answer(R({ by: "status" }), data(), TODAY));
    expect(a.rows).toEqual([
      { status: "Pending", count: 1 },
      { status: "Approved", count: 1 },
      { status: "Fulfilled", count: 1 },
      { status: "Declined", count: 1 },
    ]);
  });

  it("refuses an unknown request kind", () => {
    expect(validateAskSpec(R({ kinds: { ids: ["NOPE"] } })).ok).toBe(false);
  });

  it("refuses when the asker may not see requests", () => {
    const a = answer(R({}), data({ requests: null }), TODAY);
    expect("error" in a && a.error).toMatch(/permission/i);
  });
});

describe("staff order and names", () => {
  it("rows follow the roster order, not the id order", () => {
    const d = data();
    d.raw.staff = [d.raw.staff[1], d.raw.staff[0], d.raw.staff[2]];
    const a = ok(answer({ v: 1, kind: "count", by: "staff", shifts: { ids: ["n"] }, staff: ALL, range: RANGE }, d, TODAY));
    expect(col(a, "staff")).toEqual(["BB", "AA"]);
  });
});
