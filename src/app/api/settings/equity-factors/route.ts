import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const factors = await prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(factors);
}

export async function PUT(req: NextRequest) {
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

  await prisma.equityFactor.deleteMany({});
  if (factors.length > 0) {
    await prisma.equityFactor.createMany({
      data: factors.map((f, i) => ({
        factorType: f.factorType,
        shiftCode: f.shiftCode ?? null,
        weight: f.weight,
        enabled: f.enabled,
        sortOrder: f.sortOrder ?? i,
      })),
    });
  }

  const result = await prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(result);
}
