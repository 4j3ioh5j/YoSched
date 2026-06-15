import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Required followers: "after shift S, auto-place shift F on the next eligible day."
// At most one rule per source shift (unique sourceShiftId). Fully editable — the
// scheduler reads these rows; no shift codes are baked into the scheduling engine.

export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;
  const rules = await prisma.requiredFollower.findMany({
    include: {
      sourceShift: { select: { code: true } },
      followerShift: { select: { code: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(rules);
}

export async function PUT(req: NextRequest) {
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
  const { sourceShiftId, followerShiftId, scope, countsTowardTargets } = parsed as {
    sourceShiftId?: string; followerShiftId?: string; scope?: string; countsTowardTargets?: boolean;
  };

  if (!sourceShiftId || !followerShiftId) {
    return NextResponse.json({ error: "sourceShiftId and followerShiftId are required" }, { status: 400 });
  }
  if (sourceShiftId === followerShiftId) {
    return NextResponse.json({ error: "a shift cannot be its own follower" }, { status: 400 });
  }
  if (scope !== "each_day" && scope !== "each_run") {
    return NextResponse.json({ error: 'scope must be "each_day" or "each_run"' }, { status: 400 });
  }

  try {
    const rule = await prisma.requiredFollower.upsert({
      where: { sourceShiftId },
      update: { followerShiftId, scope, countsTowardTargets: !!countsTowardTargets },
      create: { sourceShiftId, followerShiftId, scope, countsTowardTargets: !!countsTowardTargets },
      include: {
        sourceShift: { select: { code: true } },
        followerShift: { select: { code: true } },
      },
    });
    return NextResponse.json(rule);
  } catch (e) {
    // P2003 = FK violation (unknown sourceShiftId/followerShiftId), P2025 = not found.
    const code = (e as { code?: string }).code;
    if (code === "P2003" || code === "P2025") {
      return NextResponse.json({ error: "unknown sourceShiftId or followerShiftId" }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
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
  const { sourceShiftId } = parsed as { sourceShiftId?: string };
  if (!sourceShiftId) {
    return NextResponse.json({ error: "sourceShiftId is required" }, { status: 400 });
  }
  await prisma.requiredFollower.deleteMany({ where: { sourceShiftId } });
  return NextResponse.json({ ok: true });
}
