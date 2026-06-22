/**
 * Per-day shift cap (ShiftType.maxPerDay) enforcement for MANUAL edit paths.
 *
 * The auto-scheduler already honours maxPerDay (auto-scheduler.ts canAssign), but
 * the MANUAL grid edit paths — picker, keyboard hotkey, drag/swap, paste, and
 * dedicated-column (ICU/CARD) entry — historically bypassed it, letting a scheduler
 * place e.g. two ORC, two ORL, or two ICU on the same date with no warning. This
 * shared, DB/React-free helper computes which proposed edits would push a shift
 * type past its per-day cap so every path (client pre-check, Live-mode pin check,
 * and the server write routes) can refuse them with the SAME red-border + popover
 * warning used for other prohibited actions.
 *
 * Kept pure so it is unit-testable in isolation and reusable verbatim on both the
 * client (against the in-memory grid) and the server (against the DB rows).
 */

export type DayCapCell = { staffId: string; date: string; shiftTypeId: string };

/**
 * Given the cells an edit proposes to assign, the current grid, and a per-shift
 * cap accessor, return the subset of `proposed` cells that would exceed a shift
 * type's per-day cap (so the caller can reject exactly those, or — atomically —
 * the whole edit if any is returned).
 *
 * Semantics:
 *  - A proposed cell REPLACES whatever currently occupies its (staffId, date), so
 *    the existing cell at a proposed key is never counted — overwriting your own
 *    cell, or re-assigning the same shift, is never a violation.
 *  - Callers that EMPTY a cell without re-pinning it (e.g. a drag that moves the
 *    only ORC to a different cell) must drop that vacated cell from `current`
 *    themselves, since it is not among `proposed`.
 *  - Caps are evaluated per (date, shiftTypeId). Proposed cells are processed in
 *    input order and an accepted one counts toward the cap for LATER proposed
 *    cells, so two cells of the same capped shift on one date in a single batch
 *    (e.g. a paste, or a multi-cell pick) are caught — the first is allowed, the
 *    second rejected.
 *  - A shift type whose cap is null/undefined has no limit and is never rejected.
 */
export function dayCapViolations(
  proposed: readonly DayCapCell[],
  current: readonly DayCapCell[],
  maxPerDayOf: (shiftTypeId: string) => number | null | undefined,
): DayCapCell[] {
  // staffId -> set of dates a proposed cell overwrites (so we skip them in current).
  const proposedAt = new Map<string, Set<string>>();
  for (const p of proposed) {
    let dates = proposedAt.get(p.staffId);
    if (!dates) proposedAt.set(p.staffId, (dates = new Set()));
    dates.add(p.date);
  }
  const isOverwritten = (staffId: string, date: string) => proposedAt.get(staffId)?.has(date) ?? false;

  // date -> (shiftTypeId -> count). Nested maps avoid any string-key separator.
  const counts = new Map<string, Map<string, number>>();
  const countOf = (date: string, shiftTypeId: string) => counts.get(date)?.get(shiftTypeId) ?? 0;
  const bump = (date: string, shiftTypeId: string) => {
    let byShift = counts.get(date);
    if (!byShift) counts.set(date, (byShift = new Map()));
    byShift.set(shiftTypeId, (byShift.get(shiftTypeId) ?? 0) + 1);
  };

  for (const c of current) {
    if (isOverwritten(c.staffId, c.date)) continue; // replaced by the edit
    bump(c.date, c.shiftTypeId);
  }

  const violations: DayCapCell[] = [];
  for (const p of proposed) {
    const cap = maxPerDayOf(p.shiftTypeId);
    if (cap == null) continue; // uncapped shift
    if (countOf(p.date, p.shiftTypeId) >= cap) {
      violations.push(p); // a rejected cell does NOT count toward the cap
      continue;
    }
    bump(p.date, p.shiftTypeId);
  }
  return violations;
}
