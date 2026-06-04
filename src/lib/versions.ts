// Per-month schedule versioning helpers.
//
// A "version" is a snapshot of one calendar month's assignments. Months are
// identified by (year, month) where `month` is 0-based (0=Jan..11=Dec) to match
// the grid's viewMonth. The pure helpers here are shared by the API routes and
// the client grid so that drift detection (live state vs. saved version) uses
// the exact same canonicalization and hash on both sides.

export type AssignmentSnapshot = {
  providerId: string;
  date: string; // YYYY-MM-DD
  shiftTypeId: string;
  isLocked: boolean;
  source: string;
  notes: string | null;
};

/**
 * UTC date bounds for a calendar month, as [start, endExclusive). Assignment
 * dates are stored at UTC midnight (`new Date(date + "T00:00:00Z")`), so these
 * bounds drive the Prisma `date: { gte: start, lt: end }` filter.
 */
export function monthDateRange(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
  };
}

/** True if a YYYY-MM-DD date string falls within the given calendar month. */
export function dateInMonth(date: string, year: number, month: number): boolean {
  const [y, m] = date.split("-").map(Number);
  return y === year && m === month + 1;
}

/**
 * Canonicalize a set of assignment snapshots into a stable, order-independent
 * form. Sorting by (providerId, date) makes the hash insensitive to row order.
 */
export function canonicalizeSnapshot(snaps: AssignmentSnapshot[]): AssignmentSnapshot[] {
  return [...snaps].sort((a, b) =>
    a.providerId === b.providerId
      ? a.date < b.date
        ? -1
        : a.date > b.date
          ? 1
          : 0
      : a.providerId < b.providerId
        ? -1
        : 1,
  );
}

// Fields the hash covers. Drift detection answers "does the live schedule still
// match the saved version?", so the hash spans only the schedule's content —
// which provider works which shift on which day, plus lock state — and ignores
// bookkeeping fields (source, notes) that the grid doesn't carry client-side.
// The snapshot still stores source/notes for faithful restore.
export type HashableAssignment = Pick<AssignmentSnapshot, "providerId" | "date" | "shiftTypeId" | "isLocked">;

/**
 * Stable content hash of a month's assignments. Two snapshots with the same
 * content (regardless of row order) hash identically; any change to a cell or
 * its lock state changes the hash. FNV-1a — not cryptographic, but a collision
 * only mislabels the "unsaved edits" badge, never risks data.
 */
export function hashSnapshot(snaps: HashableAssignment[]): string {
  const canon = [...snaps].sort((a, b) =>
    a.providerId === b.providerId ? (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : a.providerId < b.providerId ? -1 : 1,
  );
  const str = canon
    .map((s) => `${s.providerId}|${s.date}|${s.shiftTypeId}|${s.isLocked ? 1 : 0}`)
    .join("\n");
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // include length as a cheap extra discriminator
  return `${(h >>> 0).toString(16)}-${canon.length}`;
}

/** The next versionNumber for a month given the existing numbers (1-based). */
export function nextVersionNumber(existing: number[]): number {
  return existing.length === 0 ? 1 : Math.max(...existing) + 1;
}
