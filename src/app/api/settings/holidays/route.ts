import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { getFederalHolidays } from "@/lib/federal-holidays";
import { holidayTypeNameFor } from "@/lib/holiday-rules";
import { NextRequest, NextResponse } from "next/server";

// Card #210: every holiday row links to a holiday TYPE by id (holiday rules use the type). A new
// row with no type given gets the type named like it (" (observed)" dropped), created if needed;
// an existing row keeps its type unless the body sets one (null unlinks).

const out = (h: { id: string; date: Date; name: string; holidayTypeId: string | null }) => ({
  id: h.id,
  date: h.date.toISOString().split("T")[0],
  name: h.name,
  holidayTypeId: h.holidayTypeId,
});

async function typeIdForName(name: string): Promise<string | null> {
  const base = holidayTypeNameFor(name);
  if (!base) return null;
  const t = await prisma.holidayType.upsert({ where: { name: base }, update: {}, create: { name: base }, select: { id: true } });
  return t.id;
}

/** The type a write should store: the body's choice, else the row's current one, else by name. */
async function resolveType(date: Date, name: string, requested: unknown): Promise<{ id: string | null } | { error: string }> {
  if (requested === null) return { id: null };
  if (typeof requested === "string") {
    const t = await prisma.holidayType.findUnique({ where: { id: requested }, select: { id: true } });
    return t ? { id: t.id } : { error: "That holiday type no longer exists — reload the page" };
  }
  if (requested !== undefined) return { error: "holidayTypeId must be a string or null" };
  const existing = await prisma.holiday.findUnique({ where: { date }, select: { holidayTypeId: true } });
  if (existing?.holidayTypeId) return { id: existing.holidayTypeId };
  return { id: await typeIdForName(name) };
}

export async function POST(req: NextRequest) {
  const { error } = await getSession("settings:edit");
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
      const date = new Date(h.date + "T00:00:00Z");
      const t = await resolveType(date, h.name, undefined);
      const typeId = "id" in t ? t.id : null;
      const holiday = await prisma.holiday.upsert({
        where: { date },
        update: { name: h.name, holidayTypeId: typeId },
        create: { date, name: h.name, holidayTypeId: typeId },
      });
      created.push(out(holiday));
    }
    return NextResponse.json(created);
  }

  const { date, name } = body;
  if (!date || !name) {
    return NextResponse.json({ error: "Missing date or name" }, { status: 400 });
  }
  const day = new Date(date + "T00:00:00Z");
  const t = await resolveType(day, name, body.holidayTypeId);
  if ("error" in t) return NextResponse.json({ error: t.error }, { status: 400 });

  const holiday = await prisma.holiday.upsert({
    where: { date: day },
    update: { name, holidayTypeId: t.id },
    create: { date: day, name, holidayTypeId: t.id },
  });

  return NextResponse.json(out(holiday));
}

export async function DELETE(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.holiday.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
