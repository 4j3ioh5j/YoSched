// Card #215: the scheduler's tuning numbers are department settings (SchedulingPreferences
// columns), never constants in code. One home for their limits, the strict write check (API
// and Settings) and the lenient read (engine input, grid): a missing or corrupt stored value
// falls back to the column default, which matches the value the engine always used.

export type SchedulerTuning = {
  /** Days either side of a date that count toward how close a person's "spread out" shifts are. */
  spreadRadiusDays: number;
  /** "Keep counts even": a person this many calls (or more) ahead of the lowest is passed over. */
  evenBandCalls: number;
  /** How strongly a soft "prefer off" request pulls a day into the chosen days off. */
  softRequestOffWeight: number;
  /** The cost of one soft "avoid B after A" pair when choosing fill days. */
  softAvoidFollowWeight: number;
  /** A shift at most this many people can work marks an hours gap as structural. */
  scarcePoolSize: number;
  /** The weekend's first day (0 = Sunday … 6 = Saturday); the weekend is it and the next day. */
  weekendStartDow: number;
};

export type TuningKey = keyof SchedulerTuning;

type Limit = { min: number; max: number; integer: boolean; minExclusive?: boolean };

/** Mirrors the schema's @default values (the lenient read falls back to these). */
export const TUNING_DEFAULTS: Readonly<SchedulerTuning> = Object.freeze({
  spreadRadiusDays: 14,
  evenBandCalls: 1,
  softRequestOffWeight: 5,
  softAvoidFollowWeight: 5,
  scarcePoolSize: 3,
  weekendStartDow: 6,
});

export const TUNING_LIMITS: Readonly<Record<TuningKey, Limit>> = Object.freeze({
  spreadRadiusDays: { min: 1, max: 28, integer: true },
  evenBandCalls: { min: 0, max: 10, integer: false, minExclusive: true },
  softRequestOffWeight: { min: 0, max: 100, integer: false },
  softAvoidFollowWeight: { min: 0, max: 100, integer: false },
  scarcePoolSize: { min: 0, max: 50, integer: true },
  weekendStartDow: { min: 0, max: 6, integer: true },
});

export const TUNING_KEYS = Object.keys(TUNING_DEFAULTS) as TuningKey[];

function fits(key: TuningKey, v: unknown): v is number {
  const l = TUNING_LIMITS[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  if (l.integer && !Number.isInteger(v)) return false;
  if (l.minExclusive ? v <= l.min : v < l.min) return false;
  return v <= l.max;
}

/** The plain reason a value is refused, or null when it is valid. */
export function tuningError(key: TuningKey, v: unknown): string | null {
  if (fits(key, v)) return null;
  const l = TUNING_LIMITS[key];
  const kind = l.integer ? "a whole number" : "a number";
  const low = l.minExclusive ? `more than ${l.min}` : `${l.min}`;
  return `${key} must be ${kind} from ${low} to ${l.max}`;
}

/** Strict check of the tuning fields present in a write body: the first error, or null. */
export function validateTuningBody(body: Record<string, unknown>): string | null {
  for (const k of TUNING_KEYS) if (body[k] !== undefined) {
    const e = tuningError(k, body[k]);
    if (e) return e;
  }
  return null;
}

/** Only the tuning fields present in a (validated) write body. */
export function tuningData(body: Record<string, unknown>): Partial<SchedulerTuning> {
  const out: Partial<SchedulerTuning> = {};
  for (const k of TUNING_KEYS) if (body[k] !== undefined) out[k] = body[k] as number;
  return out;
}

/** Lenient read of a stored row (or none): each bad or missing value becomes its default. */
export function readTuning(row: Partial<Record<TuningKey, unknown>> | null | undefined): SchedulerTuning {
  const out = { ...TUNING_DEFAULTS };
  if (row) for (const k of TUNING_KEYS) if (fits(k, row[k])) out[k] = row[k] as number;
  return out;
}

/**
 * Whether a field's committed text must be sent. Card #219: a value equal to the last SAVED
 * one still has to go while a save of that field is pending (14 → 20 → 14 before the first
 * save lands): otherwise the server ends on 20 while the page shows 14 "Saved".
 */
export function tuningNeedsSave(text: string, saved: number, pending: boolean): boolean {
  return pending || text !== String(saved);
}

/** The weekend's second day of the week (the day after its first). */
export function weekendSecondDow(startDow: number): number {
  return (startDow + 1) % 7;
}

/** Whether a day of the week (0 = Sunday) falls on the weekend that starts on `startDow`. */
export function isWeekendDow(dow: number, startDow: number): boolean {
  return dow === startDow || dow === weekendSecondDow(startDow);
}

/** Whether a YYYY-MM-DD date falls on the weekend that starts on `startDow`. */
export function isWeekendDate(date: string, startDow: number): boolean {
  return isWeekendDow(new Date(date + "T12:00:00").getDay(), startDow);
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** "Saturday + Sunday" for the weekend that starts on `startDow`. */
export function weekendLabel(startDow: number): string {
  return `${WEEKDAY_NAMES[startDow]} + ${WEEKDAY_NAMES[weekendSecondDow(startDow)]}`;
}
