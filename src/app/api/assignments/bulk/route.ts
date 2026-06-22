import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals, visibleRequestChanges } from "@/lib/request-sync";
import { resolveAutoOverride, resolveUpdaterNames } from "@/lib/assignment-attribution";
import { dayCapViolations } from "@/lib/max-per-day";
import { NextRequest, NextResponse } from "next/server";

type BulkItem = { staffId: string; date: string };

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

  // Per-day cap: bulk applies ONE shift to many cells, so a selection spanning a
  // date more than maxPerDay times would over-fill it. Refuse the whole batch
  // (atomic, matching the client guard) rather than silently dropping cells.
  const capSt = await prisma.shiftType.findUnique({ where: { id: shiftTypeId }, select: { code: true, maxPerDay: true } });
  if (capSt?.maxPerDay != null) {
    const dates = [...new Set(cells.map((c) => c.date))].map(asUtcDate);
    const onDates = await prisma.assignment.findMany({ where: { date: { in: dates }, shiftTypeId }, select: { staffId: true, date: true } });
    const current = onDates.map((e) => ({ staffId: e.staffId, date: dateKey(e.date), shiftTypeId }));
    const proposed = cells.map((c) => ({ staffId: c.staffId, date: c.date, shiftTypeId }));
    if (dayCapViolations(proposed, current, () => capSt.maxPerDay).length > 0) {
      return NextResponse.json(
        { error: `Only ${capSt.maxPerDay} ${capSt.code} allowed per day`, reason: "day-full", code: capSt.code, maxPerDay: capSt.maxPerDay },
        { status: 409 },
      );
    }
  }

  const actorName = userId ? (await resolveUpdaterNames([userId])).get(userId) ?? null : null;
  const results = [];
  const skipped = [];
  for (const { staffId, date } of cells) {
    const existing = await prisma.assignment.findUnique({
      where: { staffId_date: { staffId, date: new Date(date + "T00:00:00Z") } },
    });
    if (existing?.isLocked) {
      skipped.push({ staffId, date, reason: "locked" });
      continue;
    }
    const a = await prisma.assignment.upsert({
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

  const requestChanges = await syncRequestApprovals(
    results.map((r) => ({ staffId: r.staffId, date: r.date })),
    userId
  );

  return NextResponse.json({ applied: results, skipped, requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}

export async function DELETE(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:edit");
  if (error) return error;
  const { cells } = await req.json() as { cells: BulkItem[] };

  if (!cells?.length) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const skipped = [];
  const clearedCells: BulkItem[] = [];
  for (const { staffId, date } of cells) {
    const existing = await prisma.assignment.findUnique({
      where: { staffId_date: { staffId, date: new Date(date + "T00:00:00Z") } },
    });
    if (existing?.isLocked) {
      skipped.push({ staffId, date, reason: "locked" });
      continue;
    }
    await prisma.assignment.deleteMany({
      where: {
        staffId,
        date: new Date(date + "T00:00:00Z"),
      },
    });
    clearedCells.push({ staffId, date });
  }

  const requestChanges = await syncRequestApprovals(clearedCells, userId);

  return NextResponse.json({ ok: true, cleared: clearedCells.length, skipped, requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}
