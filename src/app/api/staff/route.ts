import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest) {
  const { id, ...data } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const updated = await prisma.provider.update({
    where: { id },
    data: {
      name: data.name,
      initials: data.initials,
      employmentTypeId: data.employmentTypeId,
      ftePercentage: data.ftePercentage,
      workingDays: data.workingDays,
      takesCall: data.takesCall,
      takesLate: data.takesLate,
      specialQualifications: data.specialQualifications ?? [],
      isActive: data.isActive,
      isAutoScheduled: data.isAutoScheduled,
      sortOrder: data.sortOrder,
    },
    include: { employmentType: true },
  });

  return NextResponse.json(updated);
}

export async function POST(req: NextRequest) {
  const data = await req.json();
  if (!data.name || !data.initials) {
    return NextResponse.json({ error: "Missing name or initials" }, { status: 400 });
  }

  let employmentTypeId = data.employmentTypeId;
  if (!employmentTypeId) {
    const defaultType = await prisma.employmentType.findFirst({ orderBy: { sortOrder: "asc" } });
    employmentTypeId = defaultType!.id;
  }

  const maxSort = await prisma.provider.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.provider.create({
    data: {
      name: data.name,
      initials: data.initials,
      employmentTypeId,
      ftePercentage: data.ftePercentage ?? 1.0,
      workingDays: data.workingDays ?? [1, 2, 3, 4, 5],
      takesCall: data.takesCall ?? true,
      takesLate: data.takesLate ?? true,
      specialQualifications: data.specialQualifications ?? [],
      isActive: true,
      isAutoScheduled: data.isAutoScheduled ?? true,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
    include: { employmentType: true },
  });

  return NextResponse.json(created);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const assignmentCount = await prisma.assignment.count({ where: { providerId: id } });
  if (assignmentCount > 0) {
    await prisma.provider.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }

  await prisma.provider.delete({ where: { id } });
  return NextResponse.json({ ok: true, deleted: true });
}
