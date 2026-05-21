import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest) {
  const { id, defaultEligibleShiftTypeIds, ...data } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.employmentType.update({
    where: { id },
    data: {
      name: data.name,
      defaultIsAutoScheduled: data.defaultIsAutoScheduled,
      defaultFtePercentage: data.defaultFtePercentage,
      defaultWorkingDays: data.defaultWorkingDays,
      sortOrder: data.sortOrder,
    },
  });

  if (Array.isArray(defaultEligibleShiftTypeIds)) {
    await prisma.employmentTypeDefaultShift.deleteMany({ where: { employmentTypeId: id } });
    if (defaultEligibleShiftTypeIds.length > 0) {
      await prisma.employmentTypeDefaultShift.createMany({
        data: defaultEligibleShiftTypeIds.map((stId: string) => ({
          employmentTypeId: id,
          shiftTypeId: stId,
        })),
      });
    }
  }

  const result = await prisma.employmentType.findUnique({
    where: { id },
    include: { defaultEligibleShifts: true },
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const data = await req.json();
  if (!data.name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  const maxSort = await prisma.employmentType.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.employmentType.create({
    data: {
      name: data.name,
      defaultIsAutoScheduled: data.defaultIsAutoScheduled ?? true,
      defaultFtePercentage: data.defaultFtePercentage ?? 1.0,
      defaultWorkingDays: data.defaultWorkingDays ?? [1, 2, 3, 4, 5],
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  });

  const allShiftTypes = await prisma.shiftType.findMany({ select: { id: true } });
  if (allShiftTypes.length > 0) {
    await prisma.employmentTypeDefaultShift.createMany({
      data: allShiftTypes.map((st) => ({
        employmentTypeId: created.id,
        shiftTypeId: st.id,
      })),
    });
  }

  const result = await prisma.employmentType.findUnique({
    where: { id: created.id },
    include: { defaultEligibleShifts: true },
  });

  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const providerCount = await prisma.provider.count({ where: { employmentTypeId: id } });
  if (providerCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${providerCount} staff member(s) use this type` },
      { status: 409 },
    );
  }

  await prisma.employmentType.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
