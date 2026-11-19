/**
 * Card #367: "Ask the schedule" — the question spec.
 *
 * A question is a small JSON object, saved by name and checked on the server before it is stored.
 * Everything it names (staff, shifts, holiday types) is referenced by id, so a rename keeps the
 * question working. A selector is either { all: true } or a non-empty { ids: [...] }; an empty list is
 * refused, never read as "everyone" (an id that later disappears is reported, never pruned).
 */

export type Sel = { all: true } | { ids: string[] };
export type DateRange = { from: string; to: string };

export type FindSpec = { v: 1; kind: "find"; which: "first" | "last" | "next" | "every"; shifts: Sel; staff: Sel; range: DateRange };
export type CountSpec = { v: 1; kind: "count"; by: "staff" | "month" | "staffMonth"; shifts: Sel; staff: Sel; range: DateRange };
export type WhoWorkedSpec = { v: 1; kind: "whoWorked"; on: { holidayTypes: Sel } | { dates: string[] } | { anyDay: true }; shifts: Sel; range: DateRange };
export type StreakSpec =
  | { v: 1; kind: "streak"; mode: "work" | "off"; staff: Sel; range: DateRange }
  | { v: 1; kind: "streak"; mode: "shifts"; shifts: Sel; staff: Sel; range: DateRange };
export type GapSpec = { v: 1; kind: "gap"; shifts: Sel; staff: Sel; range: DateRange };
export type FairnessSpec = { v: 1; kind: "fairness"; staff: Sel; range: DateRange };
export type RequestsSpec = { v: 1; kind: "requests"; staff: Sel; range: DateRange; kinds: Sel; by: "staff" | "kind" | "status" };

/** The request kinds a question may filter by (ScheduleRequest.kind), with their plain names. */
export const REQUEST_KINDS: Record<string, string> = { OFF: "Day off", LEAVE: "Leave", NEGATE_SHIFT: "Not this shift", REQUEST_SHIFT: "Wants a shift" };
export const MAX_RANGE_YEARS = 20;

export type AskSpec = FindSpec | CountSpec | WhoWorkedSpec | StreakSpec | GapSpec | FairnessSpec | RequestsSpec;
export type AskKind = AskSpec["kind"];

export const ASK_KINDS: AskKind[] = ["find", "count", "whoWorked", "streak", "gap", "fairness", "requests"];
export const MAX_IDS = 1000;
export const MAX_DATES = 400;
export const MAX_QUESTION_NAME = 120;

export type Validated = { ok: true; spec: AskSpec } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function onlyKeys(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of Object.keys(o)) if (!keys.includes(k)) return `Unknown field "${k}".`;
  for (const k of keys) if (!(k in o)) return `Missing field "${k}".`;
  return null;
}

function checkSel(v: unknown, what: string): string | null {
  if (!isObj(v)) return `${what}: pick everyone or a list.`;
  if ("all" in v) {
    if (Object.keys(v).length !== 1 || v.all !== true) return `${what}: "all" must be true and stand alone.`;
    return null;
  }
  if (Object.keys(v).length !== 1 || !Array.isArray(v.ids)) return `${what}: pick everyone or a list.`;
  if (v.ids.length === 0) return `${what}: pick at least one.`;
  if (v.ids.length > MAX_IDS) return `${what}: too many picked.`;
  if (!v.ids.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64)) return `${what}: bad id.`;
  return null;
}

function checkRange(v: unknown): string | null {
  if (!isObj(v) || onlyKeys(v, ["from", "to"])) return "Dates: give a start and an end.";
  if (!isIsoDate(v.from) || !isIsoDate(v.to)) return "Dates: not a real date.";
  if (v.from > v.to) return "Dates: the start is after the end.";
  const [fy, fm, fd] = (v.from as string).split("-").map(Number);
  const limit = `${fy + MAX_RANGE_YEARS}-${String(fm).padStart(2, "0")}-${String(fd).padStart(2, "0")}`;
  if ((v.to as string) >= limit) return `Dates: ${MAX_RANGE_YEARS} years at most.`;
  return null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

export function validateAskSpec(input: unknown): Validated {
  if (!isObj(input)) return { ok: false, error: "Not a question." };
  if (input.v !== 1) return { ok: false, error: "Unknown question version." };
  if (!oneOf(input.kind, ASK_KINDS)) return { ok: false, error: "Unknown kind of question." };
  const s = input;
  const fail = (e: string | null): Validated | null => (e ? { ok: false, error: e } : null);
  let err: Validated | null = null;
  switch (s.kind) {
    case "find":
      err = fail(onlyKeys(s, ["v", "kind", "which", "shifts", "staff", "range"]))
        ?? (oneOf(s.which, ["first", "last", "next", "every"] as const) ? null : { ok: false, error: "Find: first, last, next or every." })
        ?? fail(checkSel(s.shifts, "Shifts")) ?? fail(checkSel(s.staff, "Staff")) ?? fail(checkRange(s.range));
      break;
    case "count":
      err = fail(onlyKeys(s, ["v", "kind", "by", "shifts", "staff", "range"]))
        ?? (oneOf(s.by, ["staff", "month", "staffMonth"] as const) ? null : { ok: false, error: "Count: by person, month, or both." })
        ?? fail(checkSel(s.shifts, "Shifts")) ?? fail(checkSel(s.staff, "Staff")) ?? fail(checkRange(s.range));
      break;
    case "whoWorked": {
      err = fail(onlyKeys(s, ["v", "kind", "on", "shifts", "range"])) ?? fail(checkSel(s.shifts, "Shifts")) ?? fail(checkRange(s.range));
      if (err) break;
      const on = s.on;
      if (!isObj(on)) { err = { ok: false, error: "Pick holidays or dates." }; break; }
      if ("holidayTypes" in on) {
        err = fail(onlyKeys(on, ["holidayTypes"])) ?? fail(checkSel(on.holidayTypes, "Holidays"));
      } else if ("dates" in on) {
        err = fail(onlyKeys(on, ["dates"]));
        if (!err && (!Array.isArray(on.dates) || on.dates.length === 0)) err = { ok: false, error: "Pick at least one date." };
        else if (!err && (on.dates as unknown[]).length > MAX_DATES) err = { ok: false, error: "Too many dates." };
        else if (!err && !(on.dates as unknown[]).every(isIsoDate)) err = { ok: false, error: "Dates: not a real date." };
      } else if ("anyDay" in on) {
        err = fail(onlyKeys(on, ["anyDay"])) ?? (on.anyDay === true ? null : { ok: false, error: "Pick holidays or dates." });
      } else err = { ok: false, error: "Pick holidays or dates." };
      break;
    }
    case "streak":
      if (!oneOf(s.mode, ["work", "off", "shifts"] as const)) { err = { ok: false, error: "Streak: worked days, days off, or chosen shifts." }; break; }
      err = s.mode === "shifts"
        ? fail(onlyKeys(s, ["v", "kind", "mode", "shifts", "staff", "range"])) ?? fail(checkSel(s.shifts, "Shifts"))
        : fail(onlyKeys(s, ["v", "kind", "mode", "staff", "range"]));
      err = err ?? fail(checkSel(s.staff, "Staff")) ?? fail(checkRange(s.range));
      break;
    case "gap":
      err = fail(onlyKeys(s, ["v", "kind", "shifts", "staff", "range"])) ?? fail(checkSel(s.shifts, "Shifts")) ?? fail(checkSel(s.staff, "Staff")) ?? fail(checkRange(s.range));
      break;
    case "fairness":
      err = fail(onlyKeys(s, ["v", "kind", "staff", "range"])) ?? fail(checkSel(s.staff, "Staff")) ?? fail(checkRange(s.range));
      break;
    case "requests":
      err = fail(onlyKeys(s, ["v", "kind", "staff", "range", "kinds", "by"])) ?? fail(checkSel(s.staff, "Staff")) ?? fail(checkRange(s.range))
        ?? fail(checkSel(s.kinds, "Request kinds"))
        ?? (isObj(s.kinds) && Array.isArray(s.kinds.ids) && !s.kinds.ids.every((k) => typeof k === "string" && Object.hasOwn(REQUEST_KINDS, k)) ? { ok: false, error: "Unknown request kind." } : null)
        ?? (oneOf(s.by, ["staff", "kind", "status"] as const) ? null : { ok: false, error: "Requests: by person, kind or status." });
      break;
  }
  if (err) return err;
  return { ok: true, spec: input as unknown as AskSpec };
}

export type RefLists = { staff: string[]; shifts: string[]; holidayTypes: string[] };

/** Every id the question names that the data no longer has (reported, never pruned). */
export function missingRefs(
  spec: AskSpec,
  known: { raw: { staff: Array<{ id: string }> }; shiftTypes: Array<{ id: string }>; holidayTypes: Array<{ id: string }> },
): RefLists {
  const has = (list: Array<{ id: string }>) => new Set(list.map((x) => x.id));
  const miss = (sel: Sel | undefined, set: Set<string>) => (sel && "ids" in sel ? sel.ids.filter((id) => !set.has(id)) : []);
  const s = spec as Partial<{ staff: Sel; shifts: Sel; on: WhoWorkedSpec["on"] }>;
  const ht = s.on && "holidayTypes" in s.on ? s.on.holidayTypes : undefined;
  return {
    staff: miss(s.staff, has(known.raw.staff)),
    shifts: miss(s.shifts, has(known.shiftTypes)),
    holidayTypes: miss(ht, has(known.holidayTypes)),
  };
}
