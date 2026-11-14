import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { HOLIDAY_RULES_LOCK_KEY } from "@/lib/holiday-rules-db";

// Card #210: holiday types — what a dated holiday is (e.g. "Thanksgiving Day"), so rules link to
// every year's row by id. Renaming keeps the id; deleting removes that type's rules and unlinks
// its holidays (the Settings page confirms first).

const NAME_MAX = 60;
const cleanName = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const n = v.trim();
  return n.length >= 1 && n.length <= NAME_MAX ? n : null;
};
const isUniqueClash = (e: unknown): boolean => !!e && typeof e === "object" && (e as { code?: unknown }).code === "P2002";

export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;
  const types = await prisma.holidayType.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return NextResponse.json(types);
}

export async function POST(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = cleanName(body?.name);
  if (!name) return NextResponse.json({ error: `A holiday type needs a name of 1–${NAME_MAX} characters`, reason: "invalid" }, { status: 400 });
  try {
    const t = await prisma.holidayType.create({ data: { name }, select: { id: true, name: true } });
    return NextResponse.json(t);
  } catch (e) {
    if (isUniqueClash(e)) return NextResponse.json({ error: `There is already a holiday type named ${name}`, reason: "duplicate" }, { status: 400 });
    throw e;
  }
}

export async function PATCH(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const body = (await req.json().catch(() => null)) as { id?: unknown; name?: unknown } | null;
  const name = cleanName(body?.name);
  if (typeof body?.id !== "string" || !body.id) return NextResponse.json({ error: "Missing id", reason: "bad-request" }, { status: 400 });
  if (!name) return NextResponse.json({ error: `A holiday type needs a name of 1–${NAME_MAX} characters`, reason: "invalid" }, { status: 400 });
  try {
    const t = await prisma.holidayType.update({ where: { id: body.id }, data: { name }, select: { id: true, name: true } });
    return NextResponse.json(t);
  } catch (e) {
    if (isUniqueClash(e)) return NextResponse.json({ error: `There is already a holiday type named ${name}`, reason: "duplicate" }, { status: 400 });
    if (e && typeof e === "object" && (e as { code?: unknown }).code === "P2025") return NextResponse.json({ error: "That holiday type no longer exists — reload the page", reason: "gone" }, { status: 404 });
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "string" || !body.id) return NextResponse.json({ error: "Missing id", reason: "bad-request" }, { status: 400 });
  const id = body.id;
  await prisma.$transaction(async (tx) => {
    // Same lock as the rules: a rules save in flight never sees half a deletion.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${HOLIDAY_RULES_LOCK_KEY}::bigint)`;
    await tx.holidayType.deleteMany({ where: { id } });
  });
  return NextResponse.json({ ok: true });
}
