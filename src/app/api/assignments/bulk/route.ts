import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type BulkItem = { providerId: string; date: string };

export async function PUT(req: NextRequest) {
  const { cells, shiftTypeId } = await req.json() as {
    cells: BulkItem[];
    shiftTypeId: string;
  };

  if (!cells?.length || !shiftTypeId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const results = await Promise.all(
    cells.map(async ({ providerId, date }) => {
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
      return {
        id: a.id,
        providerId: a.providerId,
        date,
        shiftTypeId: a.shiftTypeId,
        isLocked: a.isLocked,
        code: a.shiftType.code,
        color: a.shiftType.color ?? "#6b7280",
      };
    }),
  );

  return NextResponse.json(results);
}

export async function DELETE(req: NextRequest) {
  const { cells } = await req.json() as { cells: BulkItem[] };

  if (!cells?.length) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  await Promise.all(
    cells.map(({ providerId, date }) =>
      prisma.assignment.deleteMany({
        where: {
          providerId,
          date: new Date(date + "T00:00:00Z"),
        },
      }),
    ),
  );

  return NextResponse.json({ ok: true, cleared: cells.length });
}
