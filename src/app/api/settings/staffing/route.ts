import { requireAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest) {
  const { error } = await requireAuth("admin");
  if (error) return error;
  const { requirements, columns } = await req.json() as {
    requirements: { shiftCode: string; dayKey: string; minCount: number }[];
    columns: string[];
  };

  if (!requirements || !columns) {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }

  // Remove columns that are no longer tracked
  await prisma.staffingRequirement.deleteMany({
    where: { shiftCode: { notIn: columns } },
  });

  // Upsert all requirements
  for (const req of requirements) {
    await prisma.staffingRequirement.upsert({
      where: { shiftCode_dayKey: { shiftCode: req.shiftCode, dayKey: req.dayKey } },
      update: { minCount: req.minCount },
      create: req,
    });
  }

  const result = await prisma.staffingRequirement.findMany({
    orderBy: [{ shiftCode: "asc" }, { dayKey: "asc" }],
  });

  return NextResponse.json(result.map((r) => ({
    id: r.id,
    shiftCode: r.shiftCode,
    dayKey: r.dayKey,
    minCount: r.minCount,
  })));
}
