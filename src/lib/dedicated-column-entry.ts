/**
 * Pure helper for the printed schedule's "reverse" dedicated-column entry. A
 * dedicated column (e.g. ICU, CARD) lists the initials of whoever covers that
 * shift each day. Typing initials directly into that column should assign the
 * shift to those staff. This helper just resolves a raw text entry to known
 * staff — case-insensitive exact matches on initials — and reports any tokens
 * that matched nobody. Kept DB/React-free so it is unit-testable in isolation.
 */

export type EntryStaff = { id: string; initials: string };

export type ResolveResult = {
  resolved: EntryStaff[]; // matched staff, in input order, de-duplicated
  unknown: string[]; // tokens that matched no staff, in input order, de-duplicated
};

/**
 * Split `raw` on commas/whitespace and resolve each token to a staff by exact
 * (case-insensitive) initials match. Blank input yields no resolved staff and no
 * unknowns (the caller treats that as "clear this column for the date"). Tokens
 * and matches are de-duplicated so repeated initials don't double-apply.
 */
export function resolveInitials(raw: string, staff: readonly EntryStaff[]): ResolveResult {
  const byInitials = new Map<string, EntryStaff>();
  for (const s of staff) byInitials.set(s.initials.trim().toUpperCase(), s);

  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const resolved: EntryStaff[] = [];
  const unknown: string[] = [];
  const seenResolved = new Set<string>();
  const seenUnknown = new Set<string>();

  for (const token of tokens) {
    const match = byInitials.get(token.toUpperCase());
    if (match) {
      if (!seenResolved.has(match.id)) {
        seenResolved.add(match.id);
        resolved.push(match);
      }
    } else {
      const key = token.toUpperCase();
      if (!seenUnknown.has(key)) {
        seenUnknown.add(key);
        unknown.push(token);
      }
    }
  }

  return { resolved, unknown };
}
