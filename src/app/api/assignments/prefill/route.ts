import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { dates } = await req.json() as { dates: string[] };
  if (!Array.isArray(dates) || dates.length === 0) {
    return NextResponse.json({ error: "Missing dates" }, { status: 400 });
  }

  const [offShift, providers, existing] = await Promise.all([
    prisma.shiftType.findFirst({ where: { isOffShift: true } }),
    prisma.provider.findMany({ where: { isActive: true }, select: { id: true } }),
    prisma.assignment.findMany({
      where: { date: { in: dates.map((d) => new Date(d + "T00:00:00")) } },
      select: { providerId: true, date: true },
    }),
  ]);

  if (!offShift) return NextResponse.json({ created: 0 });

  const assigned = new Set(
    existing.map((a) => `${a.providerId}:${a.date.toISOString().split("T")[0]}`)
  );

  const toCreate: { providerId: string; date: Date; shiftTypeId: string; source: string }[] = [];
  for (const date of dates) {
    for (const p of providers) {
      if (!assigned.has(`${p.id}:${date}`)) {
        toCreate.push({ providerId: p.id, date: new Date(date + "T00:00:00"), shiftTypeId: offShift.id, source: "auto" });
      }
    }
  }

  if (toCreate.length > 0) {
    await prisma.assignment.createMany({ data: toCreate, skipDuplicates: true });
  }

  return NextResponse.json({ created: toCreate.length });
}
