// Card #315: automatic daily backups — the pure rules. When one is due, when the amber note
// shows, the file names, which old files the keep rule removes, and the settings' bounds.

import { resolveZone, zonedSlot } from "../time-zone";

export type AutoSettings = {
  autoEnabled: boolean;
  autoTime: string; // "HH:MM", wall clock in the Settings time zone (card #320)
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  keepSafety: number;
  publicKey: string | null;
  keyId: string | null;
  keyCreatedAt: Date | null;
  verifiedAt: Date | null;
};
export type AutoStatus = { lastAutoSuccessAt: Date | null; lastAutoAttemptAt: Date | null; lastAutoError: string | null };

export const DEFAULT_AUTO: AutoSettings = {
  autoEnabled: false, autoTime: "02:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10,
  publicKey: null, keyId: null, keyCreatedAt: null, verifiedAt: null,
};

/** After a failed attempt, the next try waits this long. */
export const RETRY_MS = 60 * 60_000;
/** No success for this long shows the amber note. */
export const STALE_MS = 48 * 60 * 60_000;

/** Due: switched on with a key, no success since the last scheduled time, and no failed try in the last hour. */
export function autoDue(now: Date, s: AutoSettings, st: AutoStatus, zone: string = "UTC"): boolean {
  if (!s.autoEnabled || !s.publicKey || !s.keyId) return false;
  const slot = zonedSlot(now, s.autoTime, resolveZone(zone)).getTime();
  if (st.lastAutoSuccessAt && st.lastAutoSuccessAt.getTime() >= slot) return false;
  if (st.lastAutoAttemptAt && st.lastAutoAttemptAt.getTime() >= slot && now.getTime() - st.lastAutoAttemptAt.getTime() < RETRY_MS) return false;
  return true;
}

/** The amber note's sentence, or null when all is well (or automatic backups are off). */
export function autoHealth(now: Date, s: AutoSettings, st: AutoStatus): string | null {
  if (!s.autoEnabled) return null;
  if (st.lastAutoError) return `The last automatic backup failed: ${st.lastAutoError}`;
  const ref = st.lastAutoSuccessAt ?? s.verifiedAt;
  if (!ref || now.getTime() - ref.getTime() > STALE_MS) return "No automatic backup has succeeded for 2 days";
  return null;
}

const p2 = (n: number) => String(n).padStart(2, "0");
/** "YoSched auto 2026-11-17 0100 UTC.yosched-backup" */
export function autoFileName(at: Date): string {
  return `YoSched auto ${at.getUTCFullYear()}-${p2(at.getUTCMonth() + 1)}-${p2(at.getUTCDate())} ${p2(at.getUTCHours())}${p2(at.getUTCMinutes())} UTC.yosched-backup`;
}
const AUTO_RE = /^YoSched auto (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2}) UTC\.yosched-backup$/;
export const SAFETY_RE = /^pre-restore-[0-9T-]+Z?\.yosched-backup$/;

function isoWeek(t: Date): string {
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  const dow = d.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dow); // the week's Thursday names its year
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return `${d.getUTCFullYear()}-W${Math.ceil(((d.getTime() - jan1) / 86_400_000 + 1) / 7)}`;
}

/** The automatic files the keep rule removes: everything that isn't the newest file of one of the
 *  newest N days, N weeks or N months. The newest file is always kept; other files are never touched. */
export function planPrune(names: string[], keep: { keepDaily: number; keepWeekly: number; keepMonthly: number }, made?: string): string[] {
  const autos = names.flatMap((n) => {
    const m = AUTO_RE.exec(n);
    return m ? [{ n, t: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) }] : [];
  }).sort((a, b) => b.t.getTime() - a.t.getTime() || (a.n < b.n ? 1 : -1));
  const kept = new Set<string>();
  if (autos.length) kept.add(autos[0].n);
  if (made) kept.add(made); // the file just written, whatever the clock says (r1)
  const rule = (count: number, bucket: (t: Date) => string) => {
    const seen = new Set<string>();
    for (const a of autos) {
      if (seen.size >= count) break;
      const b = bucket(a.t);
      if (seen.has(b)) continue;
      seen.add(b);
      kept.add(a.n);
    }
  };
  rule(keep.keepDaily, (t) => t.toISOString().slice(0, 10));
  rule(keep.keepWeekly, isoWeek);
  rule(keep.keepMonthly, (t) => t.toISOString().slice(0, 7));
  return autos.filter((a) => !kept.has(a.n)).map((a) => a.n);
}

/** Safety copies made before a restore: all but the newest `keep` (their names sort by time).
 *  `made`, the copy just written, is always one of those kept, whatever the clock says (r1). */
export function planSafetyPrune(names: string[], keep: number, made?: string): string[] {
  const safety = names.filter((n) => SAFETY_RE.test(n)).sort().reverse();
  if (!made || !safety.includes(made)) return safety.slice(Math.max(1, keep));
  return safety.filter((n) => n !== made).slice(Math.max(0, keep - 1));
}

export type AutoSettingsInput = { autoTime: string; keepDaily: number; keepWeekly: number; keepMonthly: number; keepSafety: number };
const BOUNDS: Record<Exclude<keyof AutoSettingsInput, "autoTime">, [number, number, string]> = {
  keepDaily: [1, 366, "daily copies"],
  keepWeekly: [0, 520, "weekly copies"],
  keepMonthly: [0, 240, "monthly copies"],
  keepSafety: [1, 100, "copies made before a restore"],
};

export function parseAutoSettings(raw: unknown): { ok: true; value: AutoSettingsInput } | { ok: false; error: string } {
  const b = raw as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return { ok: false, error: "Nothing to save" };
  if (typeof b.autoTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.autoTime)) {
    return { ok: false, error: "Enter the time as HH:MM on the 24-hour clock, for example 01:00" };
  }
  const value = { autoTime: b.autoTime } as AutoSettingsInput;
  for (const [k, [lo, hi, label]] of Object.entries(BOUNDS) as [keyof typeof BOUNDS, [number, number, string]][]) {
    const v = b[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) return { ok: false, error: `Keep between ${lo} and ${hi} ${label}` };
    value[k] = v;
  }
  return { ok: true, value };
}
