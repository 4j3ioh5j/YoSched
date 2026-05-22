import { requireAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const { error } = await requireAuth("admin");
  if (error) return error;
  const factors = await prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(factors);
}

export async function PUT(req: NextRequest) {
  const { error } = await requireAuth("admin");
  if (error) return error;
  const { factors } = await req.json() as {
    factors: Array<{
      id?: string;
      factorType: string;
      shiftCode?: string | null;
      weight: number;
      enabled: boolean;
      sortOrder: number;
    }>;
  };

  const result = await prisma.$transaction(async (tx) => {
    await tx.equityFactor.deleteMany({});
    if (factors.length > 0) {
      await tx.equityFactor.createMany({
        data: factors.map((f, i) => ({
          factorType: f.factorType,
          shiftCode: f.shiftCode ?? null,
          weight: f.weight,
          enabled: f.enabled,
          sortOrder: f.sortOrder ?? i,
        })),
      });
    }
    return tx.equityFactor.findMany({ orderBy: { sortOrder: "asc" } });
  });

  return NextResponse.json(result);
}
