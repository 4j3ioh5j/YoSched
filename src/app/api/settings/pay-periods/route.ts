import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const { targetHours } = await req.json();

  if (targetHours !== undefined) {
    await prisma.payPeriod.updateMany({
      data: { targetHours },
    });
  }

  const periods = await prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } });
  return NextResponse.json(
    periods.map((p) => ({
      id: p.id,
      startDate: p.startDate.toISOString().split("T")[0],
      endDate: p.endDate.toISOString().split("T")[0],
      targetHours: p.targetHours,
    })),
  );
}

export async function POST(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const { startDate, periodCount, targetHours } = await req.json();

  if (!startDate || !periodCount) {
    return NextResponse.json({ error: "Missing startDate or periodCount" }, { status: 400 });
  }

  const start = new Date(startDate + "T00:00:00Z");
  const periodsData: { startDate: Date; endDate: Date; targetHours: number }[] = [];
  for (let i = 0; i < periodCount; i++) {
    const ppStart = new Date(start);
    ppStart.setDate(ppStart.getDate() + i * 14);
    const ppEnd = new Date(ppStart);
    ppEnd.setDate(ppEnd.getDate() + 13);

    periodsData.push({
      startDate: ppStart,
      endDate: ppEnd,
      targetHours: targetHours ?? 80,
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.payPeriod.deleteMany({});
    await tx.payPeriod.createMany({ data: periodsData });
    return tx.payPeriod.findMany({ orderBy: { startDate: "asc" } });
  });

  return NextResponse.json(
    created.map((p) => ({
      id: p.id,
      startDate: p.startDate.toISOString().split("T")[0],
      endDate: p.endDate.toISOString().split("T")[0],
      targetHours: p.targetHours,
    })),
  );
}
