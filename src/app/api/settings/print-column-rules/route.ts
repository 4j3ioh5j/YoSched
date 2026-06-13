import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { coerceConditions } from "@/lib/print-column-visibility";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;

  const rules = await prisma.printColumnRule.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(rules);
}

type RuleInput = {
  label?: string;
  enabled?: boolean;
  mode?: string;
  employmentTypeIds?: string[];
  minFtePercentage?: number | null;
  maxFtePercentage?: number | null;
  conditions?: unknown;
};

/** Coerce a value to a finite number or null (rejects NaN/strings/±Infinity). */
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function PUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;

  const { rules } = await req.json();
  if (!Array.isArray(rules)) {
    return NextResponse.json({ error: "rules must be an array" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.printColumnRule.deleteMany();
    if (rules.length > 0) {
      await tx.printColumnRule.createMany({
        data: rules.map((r: RuleInput, i: number) => ({
          label: typeof r.label === "string" ? r.label : "",
          sortOrder: i,
          enabled: r.enabled !== false,
          mode: r.mode === "exclude" ? "exclude" : "include",
          employmentTypeIds: Array.isArray(r.employmentTypeIds)
            ? r.employmentTypeIds.filter((x) => typeof x === "string")
            : [],
          minFtePercentage: num(r.minFtePercentage),
          maxFtePercentage: num(r.maxFtePercentage),
          // New rules use `conditions`; legacy columns are left at defaults.
          conditions: coerceConditions(r.conditions),
        })),
      });
    }
  });

  const result = await prisma.printColumnRule.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(result);
}
