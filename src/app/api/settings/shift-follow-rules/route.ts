import { requireAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const { error } = await requireAuth("admin");
  if (error) return error;
  const rules = await prisma.shiftFollowRule.findMany({
    include: { sourceShift: { select: { code: true } }, allowedShift: { select: { code: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(rules);
}

export async function PUT(req: NextRequest) {
  const { error } = await requireAuth("admin");
  if (error) return error;
  const { sourceShiftId, rules } = await req.json() as {
    sourceShiftId: string;
    rules: Array<{ allowedShiftId: string | null; allowOffShifts: boolean }>;
  };

  const result = await prisma.$transaction(async (tx) => {
    await tx.shiftFollowRule.deleteMany({ where: { sourceShiftId } });
    if (rules.length > 0) {
      await tx.shiftFollowRule.createMany({
        data: rules.map((r) => ({
          sourceShiftId,
          allowedShiftId: r.allowedShiftId,
          allowOffShifts: r.allowOffShifts,
        })),
      });
    }
    return tx.shiftFollowRule.findMany({
      where: { sourceShiftId },
      include: { allowedShift: { select: { code: true } } },
    });
  });

  return NextResponse.json(result);
}
