import type { Warning } from "./constraints";
import { roundPPHours } from "./constraints";

// Alerts come in categories, each rendered as its own section in the Alerts
// modal. Every alert carries a stable, value-bearing `key` used to mute it.
export type AlertCategory = "staffing" | "pp-hours";

export type Alert = {
  category: AlertCategory;
  // Stable mute identity. Embeds the alert's value(s) so that when the
  // underlying numbers change the key changes too — a muted alert then
  // re-surfaces instead of staying silenced against a now-different situation.
  key: string;
  date: string; // anchor day: drives month-filtering and click-to-jump
  message: string;
  type: "error" | "warn";
};

export type AlertGroup = {
  date: string;
  items: Array<{ key: string; message: string; type: "error" | "warn" }>;
};

export type AlertSection = {
  category: AlertCategory;
  title: string;
  alerts: Alert[];
};

// Mute keys are produced server-side from trusted inputs, but the mute API
// accepts them from the client, so validate defensively: non-empty after trim
// and bounded so a malicious/huge body can't be persisted.
export const MAX_ALERT_KEY_LENGTH = 200;

/** Validate + normalize an alert key from an untrusted request body. */
export function parseAlertKey(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_ALERT_KEY_LENGTH) return null;
  return trimmed;
}

/**
 * Build the day-level staffing alerts (coverage warnings).
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
          category: "staffing",
          key: `staffing|${date}|${w.message}`,
          date,
          message: w.message,
          type: w.type === "shift-count" ? "error" : "warn",
        });
      }
    }
  }
  return items;
}

// One staff member's pay-period-hours divergence, as produced by the grid
// (which owns the hours computation). `anchorDate` is the pay period's end date
// — the alert surfaces in whichever month contains that date, and click-to-jump
// lands on the pay-period boundary row.
export type PPHoursEntry = {
  staffId: string;
  ppStartDate: string;
  anchorDate: string;
  hours: number;
  target: number;
  warning: Warning; // from checkStaffPPHours (over-hours | under-hours)
};

/**
 * Build the pay-period-hours alerts.
 *
 * A pay period may straddle two months; its alert anchors to the pay period's
 * END date and is only emitted when that end date falls within the viewed month
 * (same inclusive-bounds rule as {@link buildAlerts}). So a PP crossing the
 * June→July boundary surfaces its hours alert in July, never twice. Divergence
 * is always a warning (amber) — red is reserved for zero-coverage staffing.
 */
export function buildPPHoursAlerts(
  entries: PPHoursEntry[],
  firstOfMonth: string,
  lastOfMonth: string,
): Alert[] {
  const items: Alert[] = [];
  for (const e of entries) {
    if (e.anchorDate < firstOfMonth || e.anchorDate > lastOfMonth) continue;
    items.push({
      category: "pp-hours",
      key: `pp|${e.staffId}|${e.ppStartDate}|${roundPPHours(e.hours)}|${roundPPHours(e.target)}`,
      date: e.anchorDate,
      message: e.warning.message,
      type: "warn",
    });
  }
  return items;
}

/**
 * Assemble the ordered sections shown in the Alerts modal. Pay-period hours
 * first, then daily staffing. Sections are returned even when empty so the
 * modal can render a consistent layout (the UI decides whether to hide zeros).
 */
export function buildAlertSections(
  staffingAlerts: Alert[],
  ppHoursAlerts: Alert[],
): AlertSection[] {
  return [
    { category: "pp-hours", title: "Pay period hours", alerts: ppHoursAlerts },
    { category: "staffing", title: "Daily staffing", alerts: staffingAlerts },
  ];
}

/**
 * Group a flat alert list by date so each schedule row gets a single block.
 * Preserves first-seen date order and per-date alert order. Each item keeps its
 * mute `key` so the UI can toggle individual alerts.
 */
export function groupAlertsByDate(alerts: Alert[]): AlertGroup[] {
  const map = new Map<string, AlertGroup>();
  for (const a of alerts) {
    let g = map.get(a.date);
    if (!g) {
      g = { date: a.date, items: [] };
      map.set(a.date, g);
    }
    g.items.push({ key: a.key, message: a.message, type: a.type });
  }
  return [...map.values()];
}
