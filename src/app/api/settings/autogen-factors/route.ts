import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { validateFactorOrder } from "@/lib/autogen-factor-order";
import { NextRequest, NextResponse } from "next/server";

// Auto-generation objective priority (#252, Slice 1). The negotiable factors are a
// fixed catalog seeded by migration; Slice 1 only lets an admin REORDER them (no
// add/remove/disable yet). GET returns them in precedence order; PUT accepts the new
// order and rewrites sortOrder. Reordering only affects how schedules are GRADED
// (multi-option selection + Live expansion), not yet how the builder places shifts.

export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;
  const factors = await prisma.autoGenFactor.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(factors);
}

export async function PUT(req: NextRequest) {
  // Admin-level carveout (#252 follow-up): changing the priority order needs its own
  // permission, not the general settings:edit — a stray reorder shifts dept-wide scheduling.
  const { error } = await getSession("settings:autogen-priority");
  if (error) return error;

  const body = (await req.json().catch(() => null)) as { order?: unknown } | null;

  const existing = await prisma.autoGenFactor.findMany({ orderBy: { sortOrder: "asc" } });
  const existingKeys = existing.map((f) => f.key);

  const result = validateFactorOrder(body?.order, existingKeys);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, expected: existingKeys }, { status: 400 });
  }

  const byKey = new Map(existing.map((f) => [f.key, f]));
  await prisma.$transaction(
    result.order.map((key, i) =>
      prisma.autoGenFactor.update({ where: { id: byKey.get(key)!.id }, data: { sortOrder: i } }),
    ),
  );

  const updated = await prisma.autoGenFactor.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(updated);
}
