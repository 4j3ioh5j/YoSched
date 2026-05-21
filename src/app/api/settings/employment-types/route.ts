import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest) {
  const { id, ...data } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const updated = await prisma.employmentType.update({
    where: { id },
    data: {
      name: data.name,
      defaultIsAutoScheduled: data.defaultIsAutoScheduled,
      defaultFtePercentage: data.defaultFtePercentage,
      defaultTakesCall: data.defaultTakesCall,
      defaultTakesWeekendCall: data.defaultTakesWeekendCall,
      defaultTakesLate: data.defaultTakesLate,
      defaultWorkingDays: data.defaultWorkingDays,
      sortOrder: data.sortOrder,
    },
  });

  return NextResponse.json(updated);
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
      defaultTakesCall: data.defaultTakesCall ?? true,
      defaultTakesWeekendCall: data.defaultTakesWeekendCall ?? true,
      defaultTakesLate: data.defaultTakesLate ?? true,
      defaultWorkingDays: data.defaultWorkingDays ?? [1, 2, 3, 4, 5],
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  });

  return NextResponse.json(created);
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
