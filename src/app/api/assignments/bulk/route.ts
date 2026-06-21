import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals, visibleRequestChanges } from "@/lib/request-sync";
import { resolveAutoOverride } from "@/lib/assignment-attribution";
import { NextRequest, NextResponse } from "next/server";

type BulkItem = { staffId: string; date: string };

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
      update: { shiftTypeId, source: "manual", autoShiftTypeId: resolveAutoOverride(existing, shiftTypeId) },
      create: {
        staffId,
        date: new Date(date + "T00:00:00Z"),
        shiftTypeId,
        source: "manual",
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
