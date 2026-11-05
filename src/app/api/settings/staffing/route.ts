import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type ReqIn = { shiftCode: string; dayKey: string; minCount: number; preferredCount?: number; maxCount?: number | null };

// Staffing Rules: Min / Preferred / Max per shift × day ("0".."6", "holiday").
//  - maxCount: null = no limit; omitted = keep the stored value (an older client
//    that doesn't know the Max column never wipes it).
//  - Columns are deleted ONLY when named in `removedColumns` (the user removed them in
//    that session). An older tab that simply lacks a newer column (e.g. one the Max
//    migration added) can't erase it by omission.
//  - Min and Preferred may not exceed the effective Max (sent, else stored).
//  - The whole save is one transaction.
export async function PUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const { requirements, columns, removedColumns } = await req.json() as {
    requirements: ReqIn[];
    columns: string[];
    removedColumns?: string[];
  };

  if (!Array.isArray(requirements) || !Array.isArray(columns)) {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }
  if (removedColumns !== undefined && (!Array.isArray(removedColumns) || removedColumns.some((c) => typeof c !== "string"))) {
    return NextResponse.json({ error: "removedColumns must be a list of shift codes" }, { status: 400 });
  }
  const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
  for (const r of requirements) {
    if (!isCount(r.minCount) || (r.preferredCount !== undefined && !isCount(r.preferredCount))) {
      return NextResponse.json({ error: "Counts must be whole numbers ≥ 0" }, { status: 400 });
    }
    if (r.maxCount !== undefined && r.maxCount !== null && !isCount(r.maxCount)) {
      return NextResponse.json({ error: "Max must be a whole number ≥ 0, or blank for no limit" }, { status: 400 });
    }
  }
  const removed = (removedColumns ?? []).filter((c) => !requirements.some((r) => r.shiftCode === c));

  const stored = await prisma.staffingRequirement.findMany({ select: { shiftCode: true, dayKey: true, maxCount: true } });
  const storedMax = new Map(stored.map((r) => [`${r.shiftCode}:${r.dayKey}`, r.maxCount] as const));
  for (const r of requirements) {
    const max = r.maxCount !== undefined ? r.maxCount : (storedMax.get(`${r.shiftCode}:${r.dayKey}`) ?? null);
    if (max == null) continue;
    if (r.minCount > max || (r.preferredCount ?? 0) > max) {
      return NextResponse.json(
        { error: `${r.shiftCode}: Min and Preferred can't be more than Max (${max})`, reason: "above-max", shiftCode: r.shiftCode, dayKey: r.dayKey },
        { status: 400 },
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    if (removed.length > 0) await tx.staffingRequirement.deleteMany({ where: { shiftCode: { in: removed } } });
    for (const r of requirements) {
      const max = r.maxCount !== undefined ? { maxCount: r.maxCount } : {};
      await tx.staffingRequirement.upsert({
        where: { shiftCode_dayKey: { shiftCode: r.shiftCode, dayKey: r.dayKey } },
        update: { minCount: r.minCount, preferredCount: r.preferredCount ?? 0, ...max },
        create: { shiftCode: r.shiftCode, dayKey: r.dayKey, minCount: r.minCount, preferredCount: r.preferredCount ?? 0, maxCount: r.maxCount ?? null },
      });
    }
  });

  const result = await prisma.staffingRequirement.findMany({
    orderBy: [{ shiftCode: "asc" }, { dayKey: "asc" }],
  });

  return NextResponse.json(result.map((r) => ({
    id: r.id,
    shiftCode: r.shiftCode,
    dayKey: r.dayKey,
    minCount: r.minCount,
    preferredCount: r.preferredCount,
    maxCount: r.maxCount,
  })));
}
