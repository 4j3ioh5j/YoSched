// Card #314: is a backup due? No backup yet, or the last one is at least `days` days old.
// 0 days turns the reminder off.
export function backupDue(last: Date | null, days: number, now: Date): boolean {
  if (!Number.isFinite(days) || days <= 0) return false;
  if (!last) return true;
  return now.getTime() - last.getTime() >= days * 86_400_000;
}

/** "YoSched backup 2026-11-17 0042 UTC.yosched-backup" (24-hour time, UTC). */
export function backupFileName(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `YoSched backup ${at.getUTCFullYear()}-${p(at.getUTCMonth() + 1)}-${p(at.getUTCDate())} ${p(at.getUTCHours())}${p(at.getUTCMinutes())} UTC.yosched-backup`;
}

/** The word an admin types to confirm a restore over existing data. */
export const CONFIRM_WORD = "REPLACE";
