import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
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
  const { error } = await getSession("settings:edit");
  if (error) return error;

  const body = (await req.json().catch(() => null)) as { order?: unknown } | null;
  const order = body?.order;
  if (!Array.isArray(order) || !order.every((k) => typeof k === "string")) {
    return NextResponse.json({ error: "Body must be { order: string[] }" }, { status: 400 });
  }

  const existing = await prisma.autoGenFactor.findMany({ orderBy: { sortOrder: "asc" } });
  const existingKeys = existing.map((f) => f.key);

  // The new order must be an exact permutation of the current factor keys — no
  // missing, no extra, no duplicates. This keeps the catalog fixed in Slice 1 and
  // guarantees the engine still sees every known factor (so it honors the config
  // instead of falling back to the hardcoded order).
  const submitted = order as string[];
  const dupFree = new Set(submitted).size === submitted.length;
  const sameSet =
    submitted.length === existingKeys.length && submitted.every((k) => existingKeys.includes(k));
  if (!dupFree || !sameSet) {
    return NextResponse.json(
      { error: "order must be a permutation of the existing factor keys", expected: existingKeys },
      { status: 400 },
    );
  }

  const byKey = new Map(existing.map((f) => [f.key, f]));
  await prisma.$transaction(
    submitted.map((key, i) =>
      prisma.autoGenFactor.update({ where: { id: byKey.get(key)!.id }, data: { sortOrder: i } }),
    ),
  );

  const updated = await prisma.autoGenFactor.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(updated);
}
