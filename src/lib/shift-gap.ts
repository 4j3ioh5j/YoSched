// Card #260: "at least N days between two of the same shift for one person".
//
// Days in a row of the shift form one block (a Sat–Sun pair, a holiday weekend, a Fri + Sat–Sun);
// the gap between two blocks runs from the last day of one to the first day of the next.
// Everything here reads a predicate `has(date)` (is the shift on that date for the person?), so
// the engine can answer it from the grid, history and next month's cells, with or without a
// candidate group added or a cell removed. Pure; no I/O.

const DAY = 86400000;
const t = (d: string) => Date.parse(d + "T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(t(d) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((t(b) - t(a)) / DAY);

/** How far a block can run before the scan gives up (well past any real stretch of one shift). */
const MAX_BLOCK = 62;

type Block = { start: string; end: string };

/** The blocks of the shift that touch [from, to] (each with its real edges, even outside it). */
function blocksIn(has: (d: string) => boolean, from: string, to: string): Block[] {
  const out: Block[] = [];
  let d = from;
  // A block that started before `from` and runs into it: walk back to its first day.
  if (has(d)) { let k = 0; while (k < MAX_BLOCK && has(addDays(d, -1))) { d = addDays(d, -1); k++; } }
  while (t(d) <= t(to)) {
    if (!has(d)) { d = addDays(d, 1); continue; }
    const start = d;
    let k = 0;
    while (k < MAX_BLOCK && has(addDays(d, 1))) { d = addDays(d, 1); k++; }
    out.push({ start, end: d });
    d = addDays(d, 1);
  }
  return out;
}

/**
 * The pairs of neighbouring blocks closer than `n` days that touch [from − n, to + n], as
 * "lastDayOfFirst|firstDayOfNext". Computed from the cells themselves, so taking a middle day
 * out of a block shows up as a new pair. Empty when `n` < 2.
 */
export function gapBreaks(has: (d: string) => boolean, from: string, to: string, n: number): Set<string> {
  const out = new Set<string>();
  if (!(n >= 2)) return out;
  const blocks = blocksIn(has, addDays(from, -n), addDays(to, n));
  for (let i = 1; i < blocks.length; i++) {
    if (daysBetween(blocks[i - 1].end, blocks[i].start) < n) out.add(`${blocks[i - 1].end}|${blocks[i].start}`);
  }
  return out;
}

/**
 * The gaps between neighbouring blocks that touch [from, to], smallest first. `perDay`: every
 * day on its own (two days in a row are 1 apart) — the spread swap's reading, where two in a
 * row are as close as it gets, not one stretch.
 */
export function gapList(has: (d: string) => boolean, from: string, to: string, perDay = false): number[] {
  if (perDay) {
    const days: string[] = [];
    for (let d = from; t(d) <= t(to); d = addDays(d, 1)) if (has(d)) days.push(d);
    const gaps: number[] = [];
    for (let i = 1; i < days.length; i++) gaps.push(daysBetween(days[i - 1], days[i]));
    return gaps.sort((a, b) => a - b);
  }
  const blocks = blocksIn(has, from, to);
  const gaps: number[] = [];
  for (let i = 1; i < blocks.length; i++) gaps.push(daysBetween(blocks[i - 1].end, blocks[i].start));
  return gaps.sort((a, b) => a - b);
}

/**
 * Did a person's close gaps get worse? Only gaps under `comfortable` count (the shift's minimum
 * when set, else the spread reach). Compared one by one, smallest with smallest: any of them
 * smaller than before, or a new one, is worse — however much another gap (or another person)
 * gains (Codex #1190/#1195: no sums, no "smallest only").
 */
export function gapListShrank(before: number[], after: number[], comfortable: number): boolean {
  const b = before.filter((g) => g < comfortable).sort((x, y) => x - y);
  const a = after.filter((g) => g < comfortable).sort((x, y) => x - y);
  if (a.length > b.length) return true;
  // Fewer close gaps: line up after's with the LARGEST of before's (a gap that left was the
  // smallest one healed, or another grew past comfortable — both fine); each must not shrink.
  const off = b.length - a.length;
  for (let i = 0; i < a.length; i++) if (a[i] < b[i + off]) return true;
  return false;
}

/** A pay period's result, as the minimum-gap trial compares it (card #260). */
export type GapTrialOutcome = {
  /** Cells of the shift on the pay period's days (coverage). */
  covered: number;
  /** People whose count of the shift isn't a whole number of groups (a lone 12 h ORL). */
  broken: number;
  /** The most of the shift any one person holds. */
  most: number;
  /** People over their pay-period target. */
  over: number;
  /** Hours short of target that can't be made up with the fill shift. */
  short: number;
  /** Pairs of blocks closer than the minimum. */
  close: number;
};

/**
 * Is the result with the gap at work worth keeping over the baseline (the pay period placed
 * without it)? Only when it has fewer too-close pairs AND is no worse on anything else: as
 * many days covered, no more broken groups, nobody holding more than the most anyone holds in
 * the baseline, no more people over target, no more hours short. Spacing never buys hours,
 * coverage or evenness.
 */
export function gapTrialBeats(a: GapTrialOutcome, base: GapTrialOutcome): boolean {
  return a.covered >= base.covered && a.broken <= base.broken && a.most <= base.most
    && a.over <= base.over && a.short <= base.short + 1e-9 && a.close < base.close;
}
