import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest) {
  const { providerId, date, shiftTypeId } = await req.json();

  if (!providerId || !date || !shiftTypeId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const assignment = await prisma.assignment.upsert({
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

  return NextResponse.json({
    id: assignment.id,
    providerId: assignment.providerId,
    date,
    shiftTypeId: assignment.shiftTypeId,
    isLocked: assignment.isLocked,
    code: assignment.shiftType.code,
    color: assignment.shiftType.color ?? "#6b7280",
  });
}

export async function DELETE(req: NextRequest) {
  const { providerId, date } = await req.json();

  if (!providerId || !date) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  await prisma.assignment.deleteMany({
    where: {
      providerId,
      date: new Date(date + "T00:00:00Z"),
    },
  });

  return NextResponse.json({ ok: true });
}
