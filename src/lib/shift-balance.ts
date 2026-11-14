// Card #203: the running balance of a shift between the people who can take it, and how
// close together a person's marked shifts are.
//
// The balance is a PURE FUNCTION OF THE CELLS (plus static rules): every cell of the shift
// is one slot, whoever put it there (a person, a request, a standing commitment, any engine
// step, a follower, a repair). Each slot owes every person who could have taken it that day
// their weight's share of it (FTE, or 1 a head). balance = got − expected. Computed the same
// way for past dates (saved cells) and run dates (the engine's grid), so next month's replay
// of this month's saved cells gives the balance this run ended with.
//
// Kept apart from the engine so the counting rule has one home and its own tests.

function localDate(s: string): Date {
  return new Date(s + "T12:00:00");
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(date: string, n: number): string {
  const d = localDate(date);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

export function dayGap(a: string, b: string): number {
  return Math.round(Math.abs(localDate(a).getTime() - localDate(b).getTime()) / 86400000);
}

/** The person's shift (id) on a date, or undefined for an empty cell. */
export type CellAt = (staffId: string, date: string) => string | undefined;

/**
 * Whether `staffId` holds a slot of `shiftTypeId` on `date`. A weekend-paired shift's Sunday
 * is the second half of the Saturday's slot when the same person holds both (one weekend =
 * one slot, as the engine has always counted a pair); a lone Sunday is its own slot.
 */
export function holdsSlot(cellAt: CellAt, staffId: string, shiftTypeId: string, weekendPaired: boolean, date: string): boolean {
  if (cellAt(staffId, date) !== shiftTypeId) return false;
  if (weekendPaired && localDate(date).getDay() === 0 && cellAt(staffId, addDays(date, -1)) === shiftTypeId) return false;
  return true;
}

export type BalanceTally = { got: number; expected: number };

/**
 * Got and expected per person over `dates`. `shareOn(date)` gives each able person's share of
 * one slot that day (the shares of the able people add up to 1; people not in the map get 0).
 */
export function tallyBalances(opts: {
  shiftTypeId: string;
  weekendPaired: boolean;
  staffIds: readonly string[];
  dates: Iterable<string>;
  cellAt: CellAt;
  shareOn: (date: string) => ReadonlyMap<string, number>;
  into?: Map<string, BalanceTally>;
}): Map<string, BalanceTally> {
  const out = opts.into ?? new Map<string, BalanceTally>();
  for (const id of opts.staffIds) if (!out.has(id)) out.set(id, { got: 0, expected: 0 });
  for (const date of opts.dates) {
    let slots = 0;
    for (const id of opts.staffIds) {
      if (holdsSlot(opts.cellAt, id, opts.shiftTypeId, opts.weekendPaired, date)) {
        slots++;
        out.get(id)!.got++;
      }
    }
    if (slots === 0) continue;
    for (const [id, share] of opts.shareOn(date)) {
      const t = out.get(id);
      if (t) t.expected += slots * share;
    }
  }
  return out;
}

/**
 * Each able person's share of one slot: weight / Σ weights of the able people. A pool whose
 * weights are all 0 shares equally (never 0/0).
 */
export function sharesOf(able: readonly { id: string; weight: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  if (able.length === 0) return m;
  const total = able.reduce((s, p) => s + Math.max(0, p.weight), 0);
  for (const p of able) m.set(p.id, total > 0 ? Math.max(0, p.weight) / total : 1 / able.length);
  return m;
}

/** Days either side of a date that count toward how close a person's marked shifts are. */
export const SPREAD_RADIUS = 14;

/**
 * How bunched `date` would be for a person: Σ (RADIUS + 1 − gap)² over their marked cells
 * within RADIUS days either side (the day itself excluded). 0 = nothing within two weeks;
 * a shift the next day weighs 196, one 13 days away 4, so the furthest-from-everything day wins.
 */
export function spreadPenalty(isMarkedOn: (date: string) => boolean, date: string): number {
  let p = 0;
  for (let gap = 1; gap <= SPREAD_RADIUS; gap++) {
    const w = (SPREAD_RADIUS + 1 - gap) ** 2;
    if (isMarkedOn(addDays(date, -gap))) p += w;
    if (isMarkedOn(addDays(date, gap))) p += w;
  }
  return p;
}

/**
 * Pay-period ranges covering `from` onward: the stored list (which rolls forward and drops old
 * periods) extended backwards in steps of `lengthDays` from its earliest period. Sorted by start.
 */
export function payPeriodsCovering(
  stored: readonly { startDate: string; endDate: string }[],
  from: string,
  lengthDays: number,
): { startDate: string; endDate: string }[] {
  const out = [...stored].sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (out.length === 0 || !(lengthDays > 0)) return out;
  const lead: { startDate: string; endDate: string }[] = [];
  let start = out[0].startDate;
  while (start > from) {
    const prevStart = addDays(start, -lengthDays);
    lead.unshift({ startDate: prevStart, endDate: addDays(start, -1) });
    start = prevStart;
  }
  return [...lead, ...out];
}

/**
 * How much more bunched one person's marked shifts get when the days in `after` change to
 * marked (true) or unmarked (false): the whole proposed state against the current one. Every
 * pair touching a changed day lies within SPREAD_RADIUS of it; pairs away from them cancel.
 */
export function spreadChange(markedNow: (date: string) => boolean, after: ReadonlyMap<string, boolean>): number {
  if (after.size === 0) return 0;
  const changed = [...after.keys()].sort();
  const lo = addDays(changed[0], -SPREAD_RADIUS), hi = addDays(changed[changed.length - 1], SPREAD_RADIUS);
  const markedAfter = (d: string) => (after.has(d) ? after.get(d)! : markedNow(d));
  const total = (marked: (d: string) => boolean): number => {
    let t = 0;
    for (let d = lo; d <= hi; d = addDays(d, 1)) if (marked(d)) t += spreadPenalty(marked, d);
    return t;
  };
  return total(markedAfter) - total(markedNow);
}
