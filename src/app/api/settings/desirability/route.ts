import { requireAuth } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest) {
  const { error } = await requireAuth("admin");
  if (error) return error;
  const { weights } = (await req.json()) as {
    weights: Array<{
      shiftTypeId: string;
      dayOfWeek: number;
      weight: number;
      reason?: string;
    }>;
  };

  if (!weights) {
    return NextResponse.json({ error: "Missing weights" }, { status: 400 });
  }

  const shiftTypeIds = [...new Set(weights.map((w) => w.shiftTypeId))];

  await prisma.desirabilityWeight.deleteMany({
    where: { shiftTypeId: { in: shiftTypeIds } },
  });

  const nonZero = weights.filter((w) => w.weight !== 0);
  if (nonZero.length > 0) {
    await prisma.desirabilityWeight.createMany({
      data: nonZero.map((w) => ({
        shiftTypeId: w.shiftTypeId,
        dayOfWeek: w.dayOfWeek,
        weight: w.weight,
        reason: w.reason || null,
      })),
    });
  }

  const result = await prisma.desirabilityWeight.findMany();
  return NextResponse.json(
    result.map((r) => ({
      id: r.id,
      shiftTypeId: r.shiftTypeId,
      dayOfWeek: r.dayOfWeek,
      weight: r.weight,
      reason: r.reason,
    }))
  );
}
