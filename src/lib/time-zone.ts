// Card #320: one time zone for every time YoSched shows or asks for. Pure: no Node imports,
// so the browser and the server share it. The zone is a Setting (SchedulingPreferences.timeZone);
// null or anything invalid is UTC, which is how YoSched behaved before the setting existed.

import { formatDate, type DateFormatKey } from "./date-format";

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(zone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    fmtCache.set(zone, f);
  }
  return f;
}

export function isValidZone(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(v)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** Stored value → a usable zone; null, empty or invalid → "UTC". */
export function resolveZone(stored: unknown): string {
  return isValidZone(stored) ? stored : "UTC";
}

/** Every zone the picker offers. "UTC" is listed explicitly: some runtimes leave it out of
 *  Intl.supportedValuesOf, and it is the rollback target. */
export function zoneChoices(): string[] {
  const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const list = sv ? sv("timeZone") : [];
  return ["UTC", ...list.filter((z) => z !== "UTC")];
}

/** The wall clock in `zone` at `date`; date and time come from the same instant. */
export function wallClock(date: Date, zone: string): WallClock {
  const p: Record<string, string> = {};
  for (const x of partsFmt(zone).formatToParts(date)) p[x.type] = x.value;
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute };
}

const pad2 = (n: number) => (n < 10 ? "0" + n : String(n));

/** The zone's short label at `date`: "PST", "PDT", "UTC", "GMT+5:30". */
export function zoneLabel(date: Date, zone: string): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(date).find((x) => x.type === "timeZoneName")?.value;
  return name ?? zone;
}

/** "17:00 PST": 24-hour clock with the zone's label. */
export function formatClock(date: Date, zone: string): string {
  const w = wallClock(date, zone);
  return `${pad2(w.hour)}:${pad2(w.minute)} ${zoneLabel(date, zone)}`;
}

const MIN = 60_000;
/** The zone's offset from UTC at instant `t` (ms), to the minute. */
function offsetAt(t: number, zone: string): number {
  const w = wallClock(new Date(t), zone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(t / MIN) * MIN;
}

/** The first instant whose wall clock in `zone` is y-m-d h:mi. A time that falls in a
 *  spring-forward gap gives the first valid minute after it; one that happens twice on a
 *  fall-back night gives the first occurrence. */
export function instantOf(y: number, m: number, d: number, h: number, mi: number, zone: string): Date {
  const t0 = Date.UTC(y, m - 1, d, h, mi);
  const oBefore = offsetAt(t0 - 14 * 3600_000, zone);
  const oAfter = offsetAt(t0 + 14 * 3600_000, zone);
  const matches = (t: number) => {
    const w = wallClock(new Date(t), zone);
    return w.year === y && w.month === m && w.day === d && w.hour === h && w.minute === mi;
  };
  const cands = [t0 - oBefore, t0 - oAfter].filter(matches).sort((a, b) => a - b);
  if (cands.length) return new Date(cands[0]);
  // In a gap: the transition instant (first minute with the later offset).
  let lo = Math.min(t0 - oBefore, t0 - oAfter);
  let hi = Math.max(t0 - oBefore, t0 - oAfter);
  while (hi - lo > MIN) {
    const mid = lo + Math.floor((hi - lo) / 2 / MIN) * MIN;
    if (offsetAt(mid, zone) === oAfter) hi = mid; else lo = mid;
  }
  return new Date(hi);
}

function parseHHMM(hhmm: string): [number, number] {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`bad time ${hhmm}`);
  return [+m[1], +m[2]];
}

/** The latest instant at or before `now` whose wall clock in `zone` is HH:MM (one per calendar day). */
export function zonedSlot(now: Date, hhmm: string, zone: string): Date {
  const [h, mi] = parseHHMM(hhmm);
  const w = wallClock(now, zone);
  for (let back = 0; back < 3; back++) {
    const day = new Date(Date.UTC(w.year, w.month - 1, w.day - back));
    const t = instantOf(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, mi, zone);
    if (t.getTime() <= now.getTime()) return t;
  }
  throw new Error("unreachable");
}

/** The earliest instant strictly after `now` whose wall clock in `zone` is HH:MM (a time in a
 *  spring-forward gap gives the first valid minute after it). */
export function nextZonedSlot(now: Date, hhmm: string, zone: string): Date {
  const [h, mi] = parseHHMM(hhmm);
  const w = wallClock(now, zone);
  for (let k = 0; k < 3; k++) {
    const day = new Date(Date.UTC(w.year, w.month - 1, w.day + k));
    const t = instantOf(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, mi, zone);
    if (t.getTime() > now.getTime()) return t;
  }
  throw new Error("unreachable");
}

/** HH:MM in `fromZone` → the HH:MM in `toZone` of the NEXT backup moment after `at` (card #324:
 *  the previous one can sit on the other side of a clock change), so a zone change keeps the
 *  next backup at the same moment. */
export function convertWallTime(hhmm: string, fromZone: string, toZone: string, at: Date): string {
  const w = wallClock(nextZonedSlot(at, hhmm, fromZone), toZone);
  return `${pad2(w.hour)}:${pad2(w.minute)}`;
}

/** A local-midnight Date carrying the zone's calendar date at `date`, for the date-format helpers
 *  (they read local fields). Use it with formatDate; never for arithmetic on instants. */
export function zonedCalendarDate(date: Date, zone: string): Date {
  const w = wallClock(date, zone);
  return new Date(w.year, w.month - 1, w.day);
}

/** "HH:MM" in the zone, no label (for templates whose label is printed separately). */
export function clockHHMM(date: Date, zone: string): string {
  const w = wallClock(date, zone);
  return `${pad2(w.hour)}:${pad2(w.minute)}`;
}

/** "<date in the date-format setting> 17:00 PST": date and time of the same instant, in the zone. */
export function formatDateTimeZoned(date: Date, zone: string, df: DateFormatKey): string {
  return `${formatDate(zonedCalendarDate(date, zone), df)} ${formatClock(date, zone)}`;
}
