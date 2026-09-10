import { getSession } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Batch-write Staff.sortOrder for the settings "Staff column ordering" section's
 * all-manual mode. Only display order is written (no other staff fields), so it
 * is gated on settings:edit like the section that drives it, not staff:edit.
 */
export async function POST(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const { orderedIds } = await req.json();
  if (!Array.isArray(orderedIds) || orderedIds.length === 0 || !orderedIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "orderedIds must be a non-empty array of staff ids" }, { status: 400 });
  }
  if (new Set(orderedIds).size !== orderedIds.length) {
    return NextResponse.json({ error: "orderedIds contains duplicates" }, { status: 400 });
  }

  const known = await prisma.staff.findMany({ where: { id: { in: orderedIds } }, select: { id: true } });
  if (known.length !== orderedIds.length) {
    return NextResponse.json({ error: "orderedIds contains unknown staff ids" }, { status: 400 });
  }

  // Positions restart at 1 for the submitted list. Staff not in the list (e.g.
  // inactive) keep their old values; the display comparator's unconditional
  // initials/id tie-break keeps any resulting collisions deterministic.
  await prisma.$transaction(
    orderedIds.map((id: string, idx: number) =>
      prisma.staff.update({ where: { id }, data: { sortOrder: idx + 1 } }),
    ),
  );

  return NextResponse.json({ ok: true });
}
