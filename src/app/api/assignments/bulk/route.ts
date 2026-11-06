import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovalsAfterCommit, visibleRequestChanges } from "@/lib/request-sync";
import { resolveAutoOverride, resolveUpdaterNames } from "@/lib/assignment-attribution";
import { dayCapViolations } from "@/lib/max-per-day";
import { loadDayCaps, lockDayCaps, DAY_CAP_TX, DayCapRefused, refusalResponse, isTxTimeout, busyResponse } from "@/lib/day-cap-db";
import { NextRequest, NextResponse } from "next/server";

type BulkItem = { staffId: string; date: string };
type AppliedRow = { id: string; staffId: string; date: string; shiftTypeId: string; isLocked: boolean; code: string; color: string; source: string; autoMonth: string | null; autoShiftTypeId: string | null; updatedByName: string | null; updatedAt: string };
type SkippedRow = { staffId: string; date: string; reason: string };

const asUtcDate = (date: string) => new Date(date + "T00:00:00Z");
const dateKey = (d: Date) => d.toISOString().split("T")[0];

export async function PUT(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:edit");
  if (error) return error;
  const { cells, shiftTypeId } = await req.json() as {
    cells: BulkItem[];
    shiftTypeId: string;
  };

  if (!cells?.length || !shiftTypeId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const caps = await loadDayCaps(cells.map((c) => c.date));
  const actorName = userId ? (await resolveUpdaterNames([userId])).get(userId) ?? null : null;

  // One transaction for the whole batch: the touched dates are locked first, the cap
  // check reads under the lock, and the cells are written under it. The batch is now
  // atomic — a failure part-way rolls every cell back, which is what the grid already
  // assumes (it reverts every involved cell on a non-2xx).
  let outcome: { results: AppliedRow[]; skipped: SkippedRow[] };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      await lockDayCaps(tx, cells.map((c) => c.date));

      // Per-day cap: bulk applies ONE shift to many cells, so a selection spanning a
      // date more than its cap (Staffing Rules "Max" for that day) would over-fill it.
      // Refuse the whole batch (atomic, matching the client guard) rather than silently
      // dropping cells.
      if (cells.some((c) => caps.capOf(shiftTypeId, c.date) != null)) {
        const dates = [...new Set(cells.map((c) => c.date))].map(asUtcDate);
        const onDates = await tx.assignment.findMany({ where: { date: { in: dates }, shiftTypeId }, select: { staffId: true, date: true } });
        const current = onDates.map((e) => ({ staffId: e.staffId, date: dateKey(e.date), shiftTypeId }));
        const proposed = cells.map((c) => ({ staffId: c.staffId, date: c.date, shiftTypeId }));
        const violations = dayCapViolations(proposed, current, caps.capOf);
        if (violations.length > 0) throw new DayCapRefused(shiftTypeId, violations[0].date);
      }

      const results: AppliedRow[] = [];
      const skipped: SkippedRow[] = [];
      for (const { staffId, date } of cells) {
        const existing = await tx.assignment.findUnique({
          where: { staffId_date: { staffId, date: new Date(date + "T00:00:00Z") } },
        });
        if (existing?.isLocked) {
          skipped.push({ staffId, date, reason: "locked" });
          continue;
        }
        const a = await tx.assignment.upsert({
          where: {
            staffId_date: { staffId, date: new Date(date + "T00:00:00Z") },
          },
          update: { shiftTypeId, source: "manual", autoShiftTypeId: resolveAutoOverride(existing, shiftTypeId), updatedBy: userId },
          create: {
            staffId,
            date: new Date(date + "T00:00:00Z"),
            shiftTypeId,
            source: "manual",
            updatedBy: userId,
          },
          include: { shiftType: true },
        });
        results.push({
          id: a.id,
          staffId: a.staffId,
          date,
          shiftTypeId: a.shiftTypeId,
          isLocked: a.isLocked,
          code: a.shiftType.code,
          color: a.shiftType.color ?? "#6b7280",
          source: a.source,
          autoMonth: a.autoMonth,
          autoShiftTypeId: a.autoShiftTypeId,
          updatedByName: actorName,
          updatedAt: a.updatedAt.toISOString(),
        });
      }
      return { results, skipped };
    }, DAY_CAP_TX);
  } catch (e) {
    const refused = refusalResponse(e, caps);
    if (refused) return refused;
    throw e;
  }

  const requestChanges = await syncRequestApprovalsAfterCommit(
    "assignments bulk PUT",
    outcome.results.map((r) => ({ staffId: r.staffId, date: r.date })),
    userId
  );

  return NextResponse.json({ applied: outcome.results, skipped: outcome.skipped, requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}

export async function DELETE(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:edit");
  if (error) return error;
  const { cells } = await req.json() as { cells: BulkItem[] };

  if (!cells?.length) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const skipped: { staffId: string; date: string; reason: string }[] = [];
  const clearedCells: BulkItem[] = [];
  // Card #70: one transaction, every touched date locked FIRST, then read → check → delete.
  try {
    await prisma.$transaction(async (tx) => {
      await lockDayCaps(tx, cells.map((c) => c.date));
      for (const { staffId, date } of cells) {
        const existing = await tx.assignment.findUnique({
          where: { staffId_date: { staffId, date: new Date(date + "T00:00:00Z") } },
        });
        if (existing?.isLocked) {
          skipped.push({ staffId, date, reason: "locked" });
          continue;
        }
        await tx.assignment.deleteMany({ where: { staffId, date: new Date(date + "T00:00:00Z") } });
        clearedCells.push({ staffId, date });
      }
    }, DAY_CAP_TX);
  } catch (e) {
    if (isTxTimeout(e)) return busyResponse(); // waited out behind another writer: nothing was cleared
    throw e;
  }

  const requestChanges = await syncRequestApprovalsAfterCommit("assignments bulk DELETE", clearedCells, userId);

  return NextResponse.json({ ok: true, cleared: clearedCells.length, skipped, requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}
