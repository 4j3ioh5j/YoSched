import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { type AssignmentSnapshot, monthDateRange, hashSnapshot, nextVersionNumber } from "@/lib/versions";

type Ctx = { params: Promise<{ id: string }> };

const LIST_SELECT = {
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

// POST /api/versions/[id]/restore — overwrite the version's calendar month with
// its saved snapshot. The current month state is auto-backed-up to a new version
// first so nothing is ever lost, then the target version is marked current.
export async function POST(_req: NextRequest, { params }: Ctx) {
  const { error } = await getSession("schedule:edit");
  if (error) return error;
  const { id } = await params;

  const target = await prisma.scheduleVersion.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  const { year, month } = target;
  const snapshot = target.snapshot as unknown as AssignmentSnapshot[];
  const { start, end } = monthDateRange(year, month);

  try {
    const restored = await prisma.$transaction(async (tx) => {
      // 1. Auto-backup the current live month so the pre-restore state is recoverable.
      const liveRows = await tx.assignment.findMany({
        where: { date: { gte: start, lt: end } },
        select: { staffId: true, date: true, shiftTypeId: true, isLocked: true, source: true, notes: true },
      });
      const backupSnap: AssignmentSnapshot[] = liveRows.map((a) => ({
        staffId: a.staffId,
        date: a.date.toISOString().split("T")[0],
        shiftTypeId: a.shiftTypeId,
        isLocked: a.isLocked,
        source: a.source,
        notes: a.notes,
      }));

      const existing = await tx.scheduleVersion.findMany({ where: { year, month }, select: { versionNumber: true } });
      const backupNumber = nextVersionNumber(existing.map((v) => v.versionNumber));
      await tx.scheduleVersion.create({
        data: {
          year,
          month,
          versionNumber: backupNumber,
          comment: `Auto-backup before restoring v${target.versionNumber}`,
          snapshot: backupSnap,
          snapshotHash: hashSnapshot(backupSnap),
          isAutoBackup: true,
          isCurrent: false,
        },
      });

      // 2. Overwrite the month: clear it, then recreate from the target snapshot.
      await tx.assignment.deleteMany({ where: { date: { gte: start, lt: end } } });
      if (snapshot.length > 0) {
        await tx.assignment.createMany({
          data: snapshot.map((s) => ({
            staffId: s.staffId,
            date: new Date(s.date + "T00:00:00Z"),
            shiftTypeId: s.shiftTypeId,
            isLocked: s.isLocked,
            source: s.source,
            notes: s.notes,
          })),
        });
      }

      // 3. Make the restored version the current one for this month.
      await tx.scheduleVersion.updateMany({ where: { year, month, isCurrent: true }, data: { isCurrent: false } });
      return tx.scheduleVersion.update({ where: { id }, data: { isCurrent: true }, select: LIST_SELECT });
    });

    return NextResponse.json({ version: restored });
  } catch (e) {
    // Most likely an FK violation: the snapshot references a staff or shift
    // type that has since been deleted. Fail loudly rather than silently drop rows.
    const msg = e instanceof Error ? e.message : "Restore failed";
    return NextResponse.json(
      { error: "Restore failed — the saved version references staff or shift types that no longer exist.", detail: msg },
      { status: 409 },
    );
  }
}
