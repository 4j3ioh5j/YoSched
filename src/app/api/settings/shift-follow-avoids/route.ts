import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { gated } from "@/lib/write-gate";

// Card #177: soft "avoid" follow rules — "avoid shift B the day after shift A". The
// scheduler steers away from these pairs but still uses one when nothing better fills
// the day. Kept apart from the hard allow/block rules (shift-follow-rules).

async function handleGET() {
  const { error } = await getSession("settings:view");
  if (error) return error;
  const rows = await prisma.shiftFollowAvoid.findMany({
    include: { sourceShift: { select: { code: true } }, avoidShift: { select: { code: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(rows);
}

// Replace the avoid list of ONE source shift.
async function handlePUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object") {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }
  const { sourceShiftId, avoidShiftIds } = parsed as { sourceShiftId?: unknown; avoidShiftIds?: unknown };
  if (typeof sourceShiftId !== "string" || !sourceShiftId) {
    return NextResponse.json({ error: "sourceShiftId is required" }, { status: 400 });
  }
  if (!Array.isArray(avoidShiftIds) || avoidShiftIds.some((x) => typeof x !== "string" || !x)) {
    return NextResponse.json({ error: "avoidShiftIds must be a list of shift ids" }, { status: 400 });
  }
  const ids = [...new Set(avoidShiftIds as string[])];

  const known = await prisma.shiftType.findMany({ where: { id: { in: [sourceShiftId, ...ids] } }, select: { id: true } });
  const knownIds = new Set(known.map((s) => s.id));
  const unknown = [sourceShiftId, ...ids].filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    return NextResponse.json({ error: `unknown shift type: ${[...new Set(unknown)].join(", ")}` }, { status: 400 });
  }

  const rows = await prisma.$transaction(async (tx) => {
    await tx.shiftFollowAvoid.deleteMany({ where: { sourceShiftId } });
    if (ids.length > 0) await tx.shiftFollowAvoid.createMany({ data: ids.map((avoidShiftId) => ({ sourceShiftId, avoidShiftId })) });
    return tx.shiftFollowAvoid.findMany({
      where: { sourceShiftId },
      include: { avoidShift: { select: { code: true } } },
      orderBy: { createdAt: "asc" },
    });
  });
  return NextResponse.json(rows);
}

export const GET = gated(handleGET);
export const PUT = gated(handlePUT);
