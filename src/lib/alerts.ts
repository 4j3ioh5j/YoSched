import type { Warning } from "./constraints";

export type Alert = {
  date: string;
  message: string;
  type: "error" | "warn";
};

export type AlertGroup = {
  date: string;
  items: Array<{ message: string; type: "error" | "warn" }>;
};

/**
 * Build the flat list of schedule-view alerts.
 *
 * Only days within the currently-viewed month are included — the schedule grid
 * also renders pay-period padding rows from adjacent months, but those must not
 * produce alerts. `firstOfMonth` / `lastOfMonth` are inclusive ISO `YYYY-MM-DD`
 * bounds, compared lexicographically (valid for fixed-width ISO dates).
 */
export function buildAlerts(
  dates: string[],
  dayWarnings: Map<string, Warning[]>,
  firstOfMonth: string,
  lastOfMonth: string,
): Alert[] {
  const items: Alert[] = [];
  for (const date of dates) {
    if (date < firstOfMonth || date > lastOfMonth) continue;
    const dw = dayWarnings.get(date);
    if (dw) {
      for (const w of dw) {
        items.push({
          date,
          message: w.message,
          type: w.type === "shift-count" ? "error" : "warn",
        });
      }
    }
  }
  return items;
}

/**
 * Group a flat alert list by date so each schedule row gets a single block.
 * Preserves first-seen date order and per-date alert order.
 */
export function groupAlertsByDate(alerts: Alert[]): AlertGroup[] {
  const map = new Map<string, AlertGroup>();
  for (const a of alerts) {
    let g = map.get(a.date);
    if (!g) {
      g = { date: a.date, items: [] };
      map.set(a.date, g);
    }
    g.items.push({ message: a.message, type: a.type });
  }
  return [...map.values()];
}
