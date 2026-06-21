// Computes the list of dates the schedule grid displays for a calendar month.
//
// The grid lays dates out as ROWS (staff are columns) and scrolls vertically,
// defaulting scrolled to the month's 1st. The displayed range is aligned to the
// pay periods that overlap the month edges, so the period straddling in from the
// previous month and the one continuing into the next month are fully present
// (reachable by scrolling up/down). When a month edge isn't covered by any
// defined pay period, that edge falls back to whole-week padding (Sat–Sun) so
// the grid never collapses to a bare month if pay periods are missing.

export type GridPayPeriod = { startDate: string; endDate: string };

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function payPeriodContaining(dateStr: string, payPeriods: GridPayPeriod[]): GridPayPeriod | null {
  for (const pp of payPeriods) {
    if (dateStr >= pp.startDate && dateStr <= pp.endDate) return pp;
  }
  return null;
}

/**
 * Inclusive list of "YYYY-MM-DD" dates the grid shows for the given calendar
 * month (month is 0-indexed, as from Date.getMonth()). See file header for the
 * pay-period alignment and week-padding fallback rules.
 */
export function monthGridDates(year: number, month: number, payPeriods: GridPayPeriod[]): string[] {
  const firstStr = ymd(new Date(year, month, 1));
  const lastStr = ymd(new Date(year, month + 1, 0));

  const startPP = payPeriodContaining(firstStr, payPeriods);
  const endPP = payPeriodContaining(lastStr, payPeriods);

  // Start: the overlapping pay period's first day, else pad back to the prior Saturday.
  const start = startPP ? parseLocal(startPP.startDate) : new Date(year, month, 1);
  if (!startPP) {
    const dow = start.getDay();
    if (dow !== 6) start.setDate(start.getDate() - ((dow + 1) % 7));
  }
  // End: the overlapping pay period's last day, else pad forward to the next Sunday.
  const end = endPP ? parseLocal(endPP.endDate) : new Date(year, month + 1, 0);
  if (!endPP) {
    const dow = end.getDay();
    if (dow !== 0) end.setDate(end.getDate() + (7 - dow));
  }

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(ymd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
