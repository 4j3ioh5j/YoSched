import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Department-wide shift count targets ("Pay-period preferences"). One row per
// (shiftType, window, windowCount); counts are expressed per 1.0 FTE and scaled
// to each staff's FTE at schedule time. A per-staff ShiftMinimumTarget for the
// same key overrides the department default. No shift codes are baked into the
// engine — these rows drive the bias entirely from settings.

const WINDOWS = ["week", "pay_period", "month", "days"] as const;
const STRENGTHS = ["preference", "rule"] as const;

export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;
  const rows = await prisma.departmentShiftTarget.findMany({
    include: { shiftType: { select: { code: true } } },
    orderBy: { shiftType: { sortOrder: "asc" } },
  });
  return NextResponse.json(rows);
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
  const b = parsed as {
    shiftTypeId?: string;
    minCount?: number;
    maxCount?: number | null;
    window?: string;
    windowDays?: number | null;
    windowCount?: number | null;
    strength?: string;
    perFte?: boolean;
  };

  if (!b.shiftTypeId || typeof b.shiftTypeId !== "string") {
    return NextResponse.json({ error: "shiftTypeId is required" }, { status: 400 });
  }
  if (!b.window || !WINDOWS.includes(b.window as (typeof WINDOWS)[number])) {
    return NextResponse.json({ error: `window must be one of ${WINDOWS.join(", ")}` }, { status: 400 });
  }
  const strength = b.strength ?? "preference";
  if (!STRENGTHS.includes(strength as (typeof STRENGTHS)[number])) {
    return NextResponse.json({ error: `strength must be one of ${STRENGTHS.join(", ")}` }, { status: 400 });
  }

  const minCount = Number.isFinite(b.minCount) ? Math.max(0, Math.floor(b.minCount as number)) : 0;
  const maxCount = b.maxCount == null ? null : Math.max(0, Math.floor(b.maxCount));
  if (minCount <= 0 && (maxCount == null || maxCount <= 0)) {
    return NextResponse.json({ error: "target must have a positive minCount or maxCount" }, { status: 400 });
  }
  if (maxCount != null && maxCount < minCount) {
    return NextResponse.json({ error: "maxCount must be >= minCount" }, { status: 400 });
  }

  const isDays = b.window === "days";
  const windowDays = isDays ? Math.max(1, Math.floor(b.windowDays ?? 7)) : null;
  const windowCount = isDays ? 1 : Math.max(1, Math.floor(b.windowCount ?? 1));
  const perFte = b.perFte ?? true;

  const data = {
    shiftTypeId: b.shiftTypeId,
    minCount,
    maxCount,
    window: b.window,
    windowDays,
    windowCount,
    strength,
    perFte,
  };

  try {
    const row = await prisma.departmentShiftTarget.upsert({
      where: {
        shiftTypeId_window_windowCount: {
          shiftTypeId: b.shiftTypeId,
          window: b.window,
          windowCount,
        },
      },
      update: { minCount, maxCount, windowDays, strength, perFte },
      create: data,
      include: { shiftType: { select: { code: true } } },
    });
    return NextResponse.json(row);
  } catch (e) {
    // P2003 = FK violation (unknown shiftTypeId).
    if ((e as { code?: string }).code === "P2003") {
      return NextResponse.json({ error: "unknown shiftTypeId" }, { status: 400 });
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
  const { id } = parsed as { id?: string };
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  await prisma.departmentShiftTarget.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
