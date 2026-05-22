import { requireAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest) {
  const { error } = await requireAuth("admin");
  if (error) return error;
  const { targets } = await req.json() as {
    targets: { ftePercentage: number; targetHours: number }[];
  };

  if (!targets?.length) {
    return NextResponse.json({ error: "Missing targets" }, { status: 400 });
  }

  // Delete targets not in the new list
  const fteValues = targets.map((t) => t.ftePercentage);
  await prisma.fteTarget.deleteMany({
    where: { ftePercentage: { notIn: fteValues } },
  });

  // Upsert all targets
  for (const t of targets) {
    await prisma.fteTarget.upsert({
      where: { ftePercentage: t.ftePercentage },
      update: { targetHours: t.targetHours },
      create: t,
    });
  }

  const result = await prisma.fteTarget.findMany({ orderBy: { ftePercentage: "desc" } });
  return NextResponse.json(
    result.map((r) => ({
      id: r.id,
      ftePercentage: r.ftePercentage,
      targetHours: r.targetHours,
    })),
  );
}
