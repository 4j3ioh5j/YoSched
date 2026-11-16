// Card #266: how close each person's cells of one marked ("spread over the month") shift sit.
//
// Units: each cell is its own unit, so two separate days in a row are as close as it gets
// (consolidating is never rewarded). The exception is one engine group (a weekendPaired
// Sat+Sun pair, a holiday-paired group): the engine places and removes it as one, so its days
// are one unit spanning them. The gap between two units runs from the earlier unit's last day
// to the later unit's first day. Pure; no I/O.
import { daysBetween } from "./shift-gap";

export type SpacingCell = { date: string; group: string | null };
export type SpacingUnit = { start: string; end: string };

/** The person's units of one shift, sorted by start. Cells sharing a non-null `group` merge. */
export function spacingUnits(cells: readonly SpacingCell[]): SpacingUnit[] {
  const byGroup = new Map<string, SpacingUnit>();
  const singles = new Map<string, SpacingUnit>();
  for (const c of cells) {
    if (c.group == null) {
      if (!singles.has(c.date)) singles.set(c.date, { start: c.date, end: c.date });
      continue;
    }
    const u = byGroup.get(c.group);
    if (!u) byGroup.set(c.group, { start: c.date, end: c.date });
    else {
      if (c.date < u.start) u.start = c.date;
      if (c.date > u.end) u.end = c.date;
    }
  }
  return [...byGroup.values(), ...singles.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
}

const touches = (u: SpacingUnit, from: string, to: string) => u.end >= from && u.start <= to;

/**
 * Σ (radius + 1 − gap)² over every pair of units at most `radius` apart, at least one of which
 * touches [from, to]. Lower is better; 0 when no two units are within the radius.
 */
export function spacingPenalty(units: readonly SpacingUnit[], radius: number, from: string, to: string): number {
  if (!(radius >= 1)) return 0;
  let p = 0;
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const gap = daysBetween(units[i].end, units[j].start);
      // Units are few, so every pair is checked (a long earlier unit can end after a later start).
      if (gap > radius || gap < 1) continue; // < 1: overlapping units (two groups sharing a day)
      if (!touches(units[i], from, to) && !touches(units[j], from, to)) continue;
      p += (radius + 1 - gap) ** 2;
    }
  }
  return p;
}

/** The most units any one person has in [from − radius, to + radius] (context included). */
export function mostUnits(byPerson: ReadonlyMap<string, readonly SpacingUnit[]>, radius: number, from: string, to: string): number {
  const lo = shift(from, -Math.max(0, radius)), hi = shift(to, Math.max(0, radius));
  let most = 0;
  for (const units of byPerson.values()) most = Math.max(most, units.filter((u) => touches(u, lo, hi)).length);
  return most;
}

function shift(d: string, n: number): string {
  return new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}
