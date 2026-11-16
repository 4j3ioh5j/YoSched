import { type AssignmentSnapshot, monthDateRange } from "@/lib/versions";

// Version writers' shared reads (card #312). The caller holds the month's day locks
// (lockDayCaps) on `tx`, so the snapshot cannot catch a half-applied save.

type AssignmentReader = {
  assignment: {
    findMany: (args: {
      where: { date: { gte: Date; lt: Date } };
      select: { staffId: true; date: true; shiftTypeId: true; isLocked: true; source: true; notes: true };
    }) => Promise<{ staffId: string; date: Date; shiftTypeId: string; isLocked: boolean; source: string; notes: string | null }[]>;
  };
};

/** The snapshot of a calendar month's current assignments. */
export async function snapshotMonth(tx: AssignmentReader, year: number, month: number): Promise<AssignmentSnapshot[]> {
  const { start, end } = monthDateRange(year, month);
  const rows = await tx.assignment.findMany({
    where: { date: { gte: start, lt: end } },
    select: { staffId: true, date: true, shiftTypeId: true, isLocked: true, source: true, notes: true },
  });
  return rows.map((a) => ({
    staffId: a.staffId,
    date: a.date.toISOString().split("T")[0],
    shiftTypeId: a.shiftTypeId,
    isLocked: a.isLocked,
    source: a.source,
    notes: a.notes,
  }));
}

/** Metadata returned to the browser — never the (large) snapshot blob. */
export const VERSION_LIST_SELECT = {
  id: true,
  year: true,
  month: true,
  versionNumber: true,
  comment: true,
  isCurrent: true,
  isAutoBackup: true,
  snapshotHash: true,
  createdAt: true,
} as const;
