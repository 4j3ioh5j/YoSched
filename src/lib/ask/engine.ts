/**
 * Card #367: "Ask the schedule" — the pure question engine.
 *
 * answer(spec, data, today) turns a validated question into a table. It is pure and isomorphic:
 * the page ships the data once and answers every question in the browser. "today" is the date in
 * the Settings time zone, worked out by the caller.
 *
 * Meanings used throughout (and stated on the page):
 *  - worked = a shift that is neither leave nor an off shift;
 *  - a day with nothing on it is blank: it breaks a work streak and counts as a day off;
 *  - "everyone" means active staff plus anyone the answer has something for; a person picked by
 *    name always gets a row, even an empty one.
 */
import type { RawStatsData, RawAssignment } from "../graph/model";
import { computeStatsModel } from "../graph/model";
import { missingRefs, REQUEST_KINDS, type AskSpec, type Sel } from "./spec";

export type AskRequest = { staffId: string; kind: string; status: string; /** received date in the Settings zone */ receivedDate: string };

export type AskData = {
  raw: RawStatsData;
  shiftTypes: Array<{ id: string; code: string; name: string }>;
  holidays: Array<{ date: string; name: string; holidayTypeId: string | null }>;
  holidayTypes: Array<{ id: string; name: string }>;
  /** null when the asker may not see requests. */
  requests: AskRequest[] | null;
};

export type AskColumn = { key: string; label: string; type: "text" | "date" | "number" | "month" };
export type AskCell = string | number | null;
export type AskAnswer = { columns: AskColumn[]; rows: Array<Record<string, AskCell>>; summary: string; note?: string };
export type AskResult = AskAnswer | { error: string };


const DAY = 86_400_000;
const dayNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const inRange = (d: string, r: { from: string; to: string }) => d >= r.from && d <= r.to;
const isWorked = (a: RawAssignment) => !a.shiftType.isLeave && !a.shiftType.isOffShift;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function pick(sel: Sel): (id: string) => boolean {
  if ("all" in sel) return () => true;
  const set = new Set(sel.ids);
  return (id) => set.has(id);
}

/** Roster order; "everyone" = active staff + anyone in `hasSomething`; picked by id = always. */
function staffRows(data: AskData, sel: Sel, hasSomething: Set<string>) {
  const picked = pick(sel);
  return data.raw.staff.filter((p) => picked(p.id) && ("ids" in sel || p.isActive || hasSomething.has(p.id)));
}

const STAFF_COL: AskColumn = { key: "staff", label: "Staff", type: "text" };

export function answer(spec: AskSpec, data: AskData, today: string): AskResult {
  const missing = missingRefs(spec, data);
  const gone = [...missing.staff, ...missing.shifts, ...missing.holidayTypes];
  if (gone.length) {
    const parts = [
      missing.staff.length && plural(missing.staff.length, "person", "people"),
      missing.shifts.length && plural(missing.shifts.length, "shift"),
      missing.holidayTypes.length && plural(missing.holidayTypes.length, "holiday"),
    ].filter(Boolean);
    return { error: `This question names ${parts.join(", ")} that no longer exist. Edit it to choose again.` };
  }
  switch (spec.kind) {
    case "find": return find(spec, data, today);
    case "count": return count(spec, data);
    case "whoWorked": return whoWorked(spec, data);
    case "streak": return streak(spec, data);
    case "gap": return gap(spec, data, today);
    case "fairness": return fairness(spec, data);
    case "requests": return requests(spec, data);
  }
}

function initialsOf(data: AskData) {
  return new Map(data.raw.staff.map((p) => [p.id, p.initials] as const));
}
function rosterIndex(data: AskData) {
  return new Map(data.raw.staff.map((p, i) => [p.id, i] as const));
}

function matching(data: AskData, shifts: Sel, staff: Sel, range?: { from: string; to: string }) {
  const sh = pick(shifts), st = pick(staff);
  return data.raw.assignments.filter((a) => sh(a.shiftTypeId) && st(a.staffId) && (!range || inRange(a.date, range)));
}

function find(spec: Extract<AskSpec, { kind: "find" }>, data: AskData, today: string): AskAnswer {
  const ini = initialsOf(data), order = rosterIndex(data);
  let hits = matching(data, spec.shifts, spec.staff, spec.range);
  if (spec.which === "next") hits = hits.filter((a) => a.date >= today);
  hits.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : (order.get(x.staffId) ?? 0) - (order.get(y.staffId) ?? 0)));
  if (spec.which !== "every") {
    const per = new Map<string, RawAssignment>();
    for (const a of hits) {
      if (spec.which === "last") per.set(a.staffId, a);
      else if (!per.has(a.staffId)) per.set(a.staffId, a);
    }
    hits = [...per.values()].sort((x, y) => (order.get(x.staffId) ?? 0) - (order.get(y.staffId) ?? 0));
  }
  const rows = hits.map((a) => ({ staff: ini.get(a.staffId) ?? "?", date: a.date, shift: a.shiftType.code }));
  const columns: AskColumn[] = [STAFF_COL, { key: "date", label: "Date", type: "date" }, { key: "shift", label: "Shift", type: "text" }];
  const summary = rows.length === 0
    ? "None found."
    : spec.which === "every" ? `${plural(rows.length, "match", "matches")}.` : `${plural(rows.length, "person", "people")} found.`;
  return { columns, rows, summary, note: spec.which === "next" ? `"Next" means on or after ${today}.` : undefined };
}

function count(spec: Extract<AskSpec, { kind: "count" }>, data: AskData): AskAnswer {
  const hits = matching(data, spec.shifts, spec.staff, spec.range);
  const shiftCols = data.shiftTypes.filter((s) => pick(spec.shifts)(s.id));
  const shiftKey = (id: string) => `s_${id}`;
  const blank = () => Object.fromEntries(shiftCols.map((s) => [shiftKey(s.id), 0])) as Record<string, number>;
  const add = (row: Record<string, AskCell>, a: RawAssignment) => {
    row[shiftKey(a.shiftTypeId)] = ((row[shiftKey(a.shiftTypeId)] as number) ?? 0) + 1;
    row.total = (row.total as number) + 1;
  };
  const cols = shiftCols.map<AskColumn>((s) => ({ key: shiftKey(s.id), label: s.code, type: "number" }));
  const total: AskColumn = { key: "total", label: "Total", type: "number" };
  const ini = initialsOf(data);
  const withHits = new Set(hits.map((a) => a.staffId));
  let rows: Array<Record<string, AskCell>>;
  let columns: AskColumn[];
  if (spec.by === "staff") {
    const map = new Map<string, Record<string, AskCell>>();
    for (const p of staffRows(data, spec.staff, withHits)) {
      if (!withHits.has(p.id) && !("ids" in spec.staff)) continue;
      map.set(p.id, { staff: p.initials, ...blank(), total: 0 });
    }
    for (const a of hits) { const r = map.get(a.staffId); if (r) add(r, a); }
    rows = [...map.values()];
    columns = [STAFF_COL, ...cols, total];
  } else if (spec.by === "month") {
    const map = new Map<string, Record<string, AskCell>>();
    for (const a of [...hits].sort((x, y) => (x.date < y.date ? -1 : 1))) {
      const m = a.date.slice(0, 7);
      if (!map.has(m)) map.set(m, { month: m, ...blank(), total: 0 });
      add(map.get(m)!, a);
    }
    rows = [...map.values()];
    columns = [{ key: "month", label: "Month", type: "month" }, ...cols, total];
  } else {
    const order = rosterIndex(data);
    const map = new Map<string, Record<string, AskCell>>();
    const sorted = [...hits].sort((x, y) => (order.get(x.staffId) ?? 0) - (order.get(y.staffId) ?? 0) || (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    for (const a of sorted) {
      const k = `${a.staffId}|${a.date.slice(0, 7)}`;
      if (!map.has(k)) map.set(k, { staff: ini.get(a.staffId) ?? "?", month: a.date.slice(0, 7), ...blank(), total: 0 });
      add(map.get(k)!, a);
    }
    rows = [...map.values()];
    columns = [STAFF_COL, { key: "month", label: "Month", type: "month" }, ...cols, total];
  }
  if ("all" in spec.shifts) {
    // "Any shift": leave out the shifts nobody had, so the table shows only what happened.
    const used = new Set(hits.map((a) => shiftKey(a.shiftTypeId)));
    const unused = shiftCols.map((s) => shiftKey(s.id)).filter((k) => !used.has(k));
    columns = columns.filter((c) => !unused.includes(c.key));
    for (const r of rows) for (const k of unused) delete r[k];
  }
  return { columns, rows, summary: hits.length ? `${plural(hits.length, "shift")} in all.` : "None found." };
}

function whoWorked(spec: Extract<AskSpec, { kind: "whoWorked" }>, data: AskData): AskAnswer {
  const ini = initialsOf(data), order = rosterIndex(data);
  const sh = pick(spec.shifts);
  const names = new Map(data.holidays.map((h) => [h.date, h.name] as const));
  if ("anyDay" in spec.on) {
    // "Who worked [shift] in [years]": every person who had one, how often, first and last.
    const per = new Map<string, { times: number; first: string; last: string }>();
    for (const a of data.raw.assignments) {
      if (!sh(a.shiftTypeId) || !inRange(a.date, spec.range) || ("all" in spec.shifts && !isWorked(a))) continue;
      const c = per.get(a.staffId);
      if (!c) per.set(a.staffId, { times: 1, first: a.date, last: a.date });
      else { c.times++; if (a.date < c.first) c.first = a.date; if (a.date > c.last) c.last = a.date; }
    }
    const rows = data.raw.staff.filter((p) => per.has(p.id)).map((p) => ({ staff: p.initials, ...per.get(p.id)! }));
    return {
      columns: [STAFF_COL, { key: "times", label: "Times", type: "number" }, { key: "first", label: "First", type: "date" }, { key: "last", label: "Last", type: "date" }],
      rows,
      summary: rows.length ? `${plural(rows.length, "person", "people")} had it.` : "Nobody had it in the range.",
      note: "With any shift picked, only worked shifts count (not leave or off shifts).",
    };
  }
  let days: string[];
  if ("holidayTypes" in spec.on) {
    const ht = spec.on.holidayTypes;
    const want = pick(ht);
    days = data.holidays.filter((h) => inRange(h.date, spec.range) && ("all" in ht || (h.holidayTypeId !== null && want(h.holidayTypeId)))).map((h) => h.date);
  } else {
    days = spec.on.dates.filter((d) => inRange(d, spec.range));
  }
  days = [...new Set(days)].sort();
  const byDay = new Map<string, RawAssignment[]>();
  for (const a of data.raw.assignments) {
    if (!isWorked(a) || !sh(a.shiftTypeId)) continue;
    const arr = byDay.get(a.date);
    if (arr) arr.push(a); else byDay.set(a.date, [a]);
  }
  const rows: Array<Record<string, AskCell>> = [];
  for (const d of days) {
    const list = (byDay.get(d) ?? []).sort((x, y) => (order.get(x.staffId) ?? 0) - (order.get(y.staffId) ?? 0));
    if (list.length === 0) rows.push({ date: d, holiday: names.get(d) ?? "", staff: "(nobody)", shift: "" });
    for (const a of list) rows.push({ date: d, holiday: names.get(d) ?? "", staff: ini.get(a.staffId) ?? "?", shift: a.shiftType.code });
  }
  const people = new Set(rows.filter((r) => r.shift !== "").map((r) => r.staff)).size;
  return {
    columns: [{ key: "date", label: "Date", type: "date" }, { key: "holiday", label: "Holiday", type: "text" }, STAFF_COL, { key: "shift", label: "Shift", type: "text" }],
    rows,
    summary: days.length ? `${plural(days.length, "day")}, ${plural(people, "person", "people")} worked.` : "No matching days in the range.",
    note: "Worked means a shift that is not leave and not an off shift.",
  };
}

function streak(spec: Extract<AskSpec, { kind: "streak" }>, data: AskData): AskAnswer {
  const start = dayNum(spec.range.from), end = dayNum(spec.range.to);
  // A day "counts" when the person has a worked shift (work/off) or one of the chosen shifts (shifts).
  const wanted = spec.mode === "shifts" ? pick(spec.shifts) : null;
  const allShifts = spec.mode === "shifts" && "all" in spec.shifts;
  const counts = (a: RawAssignment) => (wanted ? wanted(a.shiftTypeId) && (!allShifts || isWorked(a)) : isWorked(a));
  const days = new Map<string, Set<number>>();
  for (const a of data.raw.assignments) {
    if (!inRange(a.date, spec.range) || !counts(a)) continue;
    const set = days.get(a.staffId) ?? new Set<number>();
    set.add(dayNum(a.date));
    days.set(a.staffId, set);
  }
  const anyIn = new Set(data.raw.assignments.filter((a) => inRange(a.date, spec.range)).map((a) => a.staffId));
  const rows: Array<Record<string, AskCell>> = [];
  for (const p of staffRows(data, spec.staff, anyIn)) {
    const w = days.get(p.id) ?? new Set<number>();
    let best = 0, bestStart = -1, run = 0, runStart = start;
    for (let d = start; d <= end; d++) {
      const hit = spec.mode === "off" ? !w.has(d) : w.has(d);
      if (hit) {
        if (run === 0) runStart = d;
        run++;
        if (run > best) { best = run; bestStart = runStart; }
      } else run = 0;
    }
    rows.push(best === 0
      ? { staff: p.initials, length: 0, start: null, end: null }
      : { staff: p.initials, length: best, start: isoOf(bestStart), end: isoOf(bestStart + best - 1) });
  }
  const what = spec.mode === "work" ? "worked days" : spec.mode === "off" ? "days off" : "the chosen shifts";
  return {
    columns: [STAFF_COL, { key: "length", label: "Days", type: "number" }, { key: "start", label: "From", type: "date" }, { key: "end", label: "To", type: "date" }],
    rows,
    summary: `Longest run of ${what} per person.`,
    note: spec.mode === "off"
      ? "Days off include blank days (nothing on the schedule), leave and off shifts. Runs are cut at the ends of the range."
      : spec.mode === "work"
        ? "A blank day (nothing on the schedule), leave or an off shift breaks a work streak. Runs are cut at the ends of the range."
        : "A run is consecutive days each with one of the chosen shifts; a blank day or any other shift breaks it. Runs are cut at the ends of the range.",
  };
}

function gap(spec: Extract<AskSpec, { kind: "gap" }>, data: AskData, today: string): AskAnswer {
  const hits = matching(data, spec.shifts, spec.staff, spec.range);
  const byStaff = new Map<string, number[]>();
  for (const a of hits) {
    const arr = byStaff.get(a.staffId) ?? [];
    arr.push(dayNum(a.date));
    byStaff.set(a.staffId, arr);
  }
  const t = dayNum(today);
  const rows = staffRows(data, spec.staff, new Set(byStaff.keys()))
    .filter((p) => "ids" in spec.staff || byStaff.has(p.id))
    .map((p) => {
      const ds = [...new Set(byStaff.get(p.id) ?? [])].sort((x, y) => x - y);
      const gaps = ds.slice(1).map((d, i) => d - ds[i]);
      const past = ds.filter((d) => d <= t), future = ds.filter((d) => d > t);
      const last = past.length ? past[past.length - 1] : null;
      return {
        staff: p.initials,
        times: ds.length,
        shortest: gaps.length ? Math.min(...gaps) : null,
        average: gaps.length ? Math.round((gaps.reduce((x, y) => x + y, 0) / gaps.length) * 10) / 10 : null,
        longest: gaps.length ? Math.max(...gaps) : null,
        last: last === null ? null : isoOf(last),
        daysSince: last === null ? null : t - last,
        next: future.length ? isoOf(future[0]) : null,
      };
    });
  const n = (k: string, l: string): AskColumn => ({ key: k, label: l, type: "number" });
  return {
    columns: [STAFF_COL, n("times", "Times"), n("shortest", "Shortest gap"), n("average", "Average gap"), n("longest", "Longest gap"),
      { key: "last", label: "Last", type: "date" }, n("daysSince", "Days since"), { key: "next", label: "Next", type: "date" }],
    rows,
    summary: rows.length ? `Days between one and the next, ${spec.range.from} to ${spec.range.to}.` : "None found.",
    note: `A gap is the number of days from one of the chosen shifts to the next (the same day twice counts once). Only dates in the range count. "Last" is the latest on or before today (${today}); later ones show under "Next".`,
  };
}

function fairness(spec: Extract<AskSpec, { kind: "fairness" }>, data: AskData): AskAnswer {
  const inR = data.raw.assignments.filter((a) => inRange(a.date, spec.range));
  const model = computeStatsModel({ ...data.raw, assignments: inR, holidays: data.raw.holidays.filter((h) => inRange(h.date, spec.range)) });
  const byId = new Map(model.data.map((r) => [r.staffId, r] as const));
  const anyIn = new Set(inR.map((a) => a.staffId));
  const rows: Array<Record<string, AskCell>> = [];
  for (const p of staffRows(data, spec.staff, anyIn)) {
    const r = byId.get(p.id);
    if (r) {
      rows.push({
        staff: p.initials, workDays: r.totalWorkDays, hours: Math.round(r.totalHours * 100) / 100, leaveDays: r.totalLeaveDays,
        holidays: r.holidayWorkCount, desirability: Math.round(r.desirabilityScore * 100) / 100,
        deviation: Math.round(r.deviation.overall * 100) / 100, note: "",
      });
    } else if ("ids" in spec.staff || anyIn.has(p.id)) {
      const why = !p.isActive ? "inactive" : !p.isAutoScheduled ? "not auto-scheduled" : "employment type left out";
      rows.push({ staff: p.initials, workDays: null, hours: null, leaveDays: null, holidays: null, desirability: null, deviation: null, note: `Not in fairness (${why})` });
    }
  }
  return {
    columns: [
      STAFF_COL,
      { key: "workDays", label: "Work days", type: "number" },
      { key: "hours", label: "Hours", type: "number" },
      { key: "leaveDays", label: "Leave days", type: "number" },
      { key: "holidays", label: "Holidays worked", type: "number" },
      { key: "desirability", label: "Desirability", type: "number" },
      { key: "deviation", label: "Deviation", type: "number" },
      { key: "note", label: "Note", type: "text" },
    ],
    rows,
    summary: `Fairness for ${spec.range.from} to ${spec.range.to}.`,
    note: "Computed the same way as the Statistics page, over this range only. People left out of fairness are listed with the reason.",
  };
}

const STATUS_ORDER = ["pending", "approved", "fulfilled", "declined", "withdrawn"];
const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

function requests(spec: Extract<AskSpec, { kind: "requests" }>, data: AskData): AskResult {
  if (data.requests === null) return { error: "You do not have permission to see requests." };
  const st = pick(spec.staff), kd = pick(spec.kinds);
  const list = data.requests.filter((r) => st(r.staffId) && kd(r.kind) && inRange(r.receivedDate, spec.range));
  const n = (k: string, l: string): AskColumn => ({ key: k, label: l, type: "number" });
  const note = "Requests are picked by the date they were received. Approved counts those approved or fulfilled now.";
  const summary = `${plural(list.length, "request")} received in the range.`;
  if (spec.by === "status") {
    const c = new Map<string, number>();
    for (const r of list) c.set(r.status, (c.get(r.status) ?? 0) + 1);
    const order = [...STATUS_ORDER, ...[...c.keys()].filter((k) => !STATUS_ORDER.includes(k)).sort()];
    const rows = order.filter((k) => c.has(k)).map((k) => ({ status: capital(k), count: c.get(k)! }));
    return { columns: [{ key: "status", label: "Status", type: "text" }, n("count", "Requests")], rows, summary, note };
  }
  const tally = (key: (r: AskRequest) => string) => {
    const counts = new Map<string, Record<string, number>>();
    for (const r of list) {
      const k = key(r);
      const c = counts.get(k) ?? { made: 0, approved: 0, declined: 0, pending: 0, withdrawn: 0 };
      c.made++;
      if (r.status === "approved" || r.status === "fulfilled") c.approved++;
      else if (r.status === "declined") c.declined++;
      else if (r.status === "pending") c.pending++;
      else if (r.status === "withdrawn") c.withdrawn++;
      counts.set(k, c);
    }
    return counts;
  };
  const statusCols = [n("made", "Made"), n("approved", "Approved"), n("declined", "Declined"), n("pending", "Pending"), n("withdrawn", "Withdrawn")];
  if (spec.by === "kind") {
    const counts = tally((r) => r.kind);
    const rows = [...Object.keys(REQUEST_KINDS), ...[...counts.keys()].filter((k) => !Object.hasOwn(REQUEST_KINDS, k)).sort()]
      .filter((k) => counts.has(k))
      .map((k) => ({ kind: REQUEST_KINDS[k] ?? k, ...counts.get(k)! }));
    return { columns: [{ key: "kind", label: "Kind", type: "text" }, ...statusCols], rows, summary, note };
  }
  const counts = tally((r) => r.staffId);
  const rows = staffRows(data, spec.staff, new Set(counts.keys()))
    .filter((p) => "ids" in spec.staff || counts.has(p.id))
    .map((p) => ({ staff: p.initials, ...(counts.get(p.id) ?? { made: 0, approved: 0, declined: 0, pending: 0, withdrawn: 0 }) }));
  return { columns: [STAFF_COL, ...statusCols], rows, summary, note };
}
