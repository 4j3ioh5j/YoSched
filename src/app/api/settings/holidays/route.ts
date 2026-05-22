import { requireAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { getFederalHolidays } from "@/lib/federal-holidays";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { error } = await requireAuth("admin");
  if (error) return error;
  const body = await req.json();

  if (body.action === "auto-populate") {
    const years: number[] = body.years;
    if (!years?.length) {
      return NextResponse.json({ error: "Missing years" }, { status: 400 });
    }

    const allHolidays = years.flatMap((y) => getFederalHolidays(y));
    const created = [];
    for (const h of allHolidays) {
      const holiday = await prisma.holiday.upsert({
        where: { date: new Date(h.date + "T00:00:00Z") },
        update: { name: h.name },
        create: { date: new Date(h.date + "T00:00:00Z"), name: h.name },
      });
      created.push({
        id: holiday.id,
        date: holiday.date.toISOString().split("T")[0],
        name: holiday.name,
      });
    }
    return NextResponse.json(created);
  }

  const { date, name } = body;
  if (!date || !name) {
    return NextResponse.json({ error: "Missing date or name" }, { status: 400 });
  }

  const holiday = await prisma.holiday.upsert({
    where: { date: new Date(date + "T00:00:00Z") },
    update: { name },
    create: { date: new Date(date + "T00:00:00Z"), name },
  });

  return NextResponse.json({
    id: holiday.id,
    date: holiday.date.toISOString().split("T")[0],
    name: holiday.name,
  });
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAuth("admin");
  if (error) return error;
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.holiday.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
