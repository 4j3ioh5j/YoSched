import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { coerceConditions } from "@/lib/print-column-visibility";
import { NextRequest, NextResponse } from "next/server";

// Stable id for the singleton residual "Other" column (matches the migration seed)
// so it stays identifiable across replace-all saves.
const OTHER_ID = "aggcol_other_default";

export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;

  const columns = await prisma.printAggregateColumn.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(columns);
}

type ColumnInput = {
  label?: string;
  enabled?: boolean;
  suppressMembers?: boolean;
  isOther?: boolean;
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

  const { columns } = await req.json();
  if (!Array.isArray(columns)) {
    return NextResponse.json({ error: "columns must be an array" }, { status: 400 });
  }

  // Singleton invariant: exactly one residual "Other" (isOther) column must exist —
  // it cannot be deleted or duplicated. Enforced server-side, not just in the UI.
  const otherCount = (columns as ColumnInput[]).filter((c) => c?.isOther === true).length;
  if (otherCount !== 1) {
    return NextResponse.json(
      { error: "exactly one isOther (residual 'Other') column is required" },
      { status: 400 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.printAggregateColumn.deleteMany();
    await tx.printAggregateColumn.createMany({
      data: (columns as ColumnInput[]).map((c, i) => {
        const isOther = c.isOther === true;
        return {
          // Keep the stable seed id for the singleton Other.
          ...(isOther ? { id: OTHER_ID } : {}),
          label: typeof c.label === "string" ? c.label : isOther ? "Other" : "",
          sortOrder: i,
          enabled: c.enabled !== false,
          // The Other column carries no rule and no suppression — neutralize regardless of payload.
          suppressMembers: isOther ? false : c.suppressMembers !== false,
          isOther,
          employmentTypeIds: isOther
            ? []
            : Array.isArray(c.employmentTypeIds)
              ? c.employmentTypeIds.filter((x) => typeof x === "string")
              : [],
          minFtePercentage: isOther ? null : num(c.minFtePercentage),
          maxFtePercentage: isOther ? null : num(c.maxFtePercentage),
          conditions: isOther ? [] : coerceConditions(c.conditions),
        };
      }),
    });
  });

  const result = await prisma.printAggregateColumn.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(result);
}
