import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals } from "@/lib/request-sync";
import { NextRequest, NextResponse } from "next/server";

type BulkItem = { providerId: string; date: string };

export async function PUT(req: NextRequest) {
  const { error, userId } = await getSession("schedule:edit");
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
  for (const { providerId, date } of cells) {
    const existing = await prisma.assignment.findUnique({
      where: { providerId_date: { providerId, date: new Date(date + "T00:00:00Z") } },
    });
    if (existing?.isLocked) {
      skipped.push({ providerId, date, reason: "locked" });
      continue;
    }
    const a = await prisma.assignment.upsert({
      where: {
        providerId_date: { providerId, date: new Date(date + "T00:00:00Z") },
      },
      update: { shiftTypeId, source: "manual" },
      create: {
        providerId,
        date: new Date(date + "T00:00:00Z"),
        shiftTypeId,
        source: "manual",
      },
      include: { shiftType: true },
    });
    results.push({
      id: a.id,
      providerId: a.providerId,
      date,
      shiftTypeId: a.shiftTypeId,
      isLocked: a.isLocked,
      code: a.shiftType.code,
      color: a.shiftType.color ?? "#6b7280",
    });
  }

  await syncRequestApprovals(
    results.map((r) => ({ providerId: r.providerId, date: r.date })),
    userId
  );

  return NextResponse.json({ applied: results, skipped });
}

export async function DELETE(req: NextRequest) {
  const { error, userId } = await getSession("schedule:edit");
  if (error) return error;
  const { cells } = await req.json() as { cells: BulkItem[] };

  if (!cells?.length) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const skipped = [];
  const clearedCells: BulkItem[] = [];
  for (const { providerId, date } of cells) {
    const existing = await prisma.assignment.findUnique({
      where: { providerId_date: { providerId, date: new Date(date + "T00:00:00Z") } },
    });
    if (existing?.isLocked) {
      skipped.push({ providerId, date, reason: "locked" });
      continue;
    }
    await prisma.assignment.deleteMany({
      where: {
        providerId,
        date: new Date(date + "T00:00:00Z"),
      },
    });
    clearedCells.push({ providerId, date });
  }

  await syncRequestApprovals(clearedCells, userId);

  return NextResponse.json({ ok: true, cleared: clearedCells.length, skipped });
}
