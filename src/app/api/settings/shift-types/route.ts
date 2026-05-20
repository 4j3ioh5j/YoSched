import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest) {
  const { id, ...data } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const updated = await prisma.shiftType.update({
    where: { id },
    data: {
      name: data.name,
      code: data.code,
      defaultHours: data.defaultHours,
      countsTowardFte: data.countsTowardFte,
      countsOnWeekend: data.countsOnWeekend,
      isLeave: data.isLeave,
      isPaid: data.isPaid,
      category: data.category,
      postShiftRule: data.postShiftRule || null,
      color: data.color,
      sortOrder: data.sortOrder,
      schedulePriority: data.schedulePriority ?? null,
      isOffShift: data.isOffShift ?? false,
      isFillShift: data.isFillShift ?? false,
      weekendPaired: data.weekendPaired ?? false,
      ignoresWorkingDays: data.ignoresWorkingDays ?? false,
      eligibilityRule: data.eligibilityRule || null,
    },
  });
  return NextResponse.json(updated);
}

export async function POST(req: NextRequest) {
  const data = await req.json();
  if (!data.code || !data.name) {
    return NextResponse.json({ error: "Missing code or name" }, { status: 400 });
  }

  const maxSort = await prisma.shiftType.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.shiftType.create({
    data: {
      name: data.name,
      code: data.code,
      defaultHours: data.defaultHours ?? 8,
      countsTowardFte: data.countsTowardFte ?? true,
      countsOnWeekend: data.countsOnWeekend ?? false,
      isLeave: data.isLeave ?? false,
      isPaid: data.isPaid ?? true,
      category: data.category ?? "work",
      postShiftRule: data.postShiftRule || null,
      color: data.color ?? "#6b7280",
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      schedulePriority: data.schedulePriority ?? null,
      isOffShift: data.isOffShift ?? false,
      isFillShift: data.isFillShift ?? false,
      weekendPaired: data.weekendPaired ?? false,
      ignoresWorkingDays: data.ignoresWorkingDays ?? false,
      eligibilityRule: data.eligibilityRule || null,
    },
  });
  return NextResponse.json(created);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const assignmentCount = await prisma.assignment.count({ where: { shiftTypeId: id } });
  if (assignmentCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${assignmentCount} assignments use this shift type` },
      { status: 409 },
    );
  }

  await prisma.shiftType.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
