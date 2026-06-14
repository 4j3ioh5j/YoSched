import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { coerceConditions } from "@/lib/print-column-visibility";
import { coerceConditionScope } from "@/lib/print-aggregate-columns";
import { NextRequest, NextResponse } from "next/server";

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
  conditionScope?: unknown;
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

  // No singleton constraint: a "catch-all" (isOther) column is just an ordinary column
  // with the residual flag set. There may be zero, one, or several. Catch-all columns
  // are still SANITIZED on write — they carry no rule (the residual = "staff in no
  // other column"), so any rule fields in the payload are cleared. Non-object entries
  // (e.g. a stray null) are dropped rather than throwing.
  const data = (columns as unknown[])
    .filter((c): c is ColumnInput => !!c && typeof c === "object")
    .map((c, i) => {
      const isOther = c.isOther === true;
      return {
        label: typeof c.label === "string" ? c.label : isOther ? "Other" : "",
        sortOrder: i,
        enabled: c.enabled !== false,
        // A catch-all column has no rule and no suppression — neutralize regardless of payload.
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
        // Catch-all has no conditions, so its scope is meaningless — force "month".
        conditionScope: isOther ? "month" : coerceConditionScope(c.conditionScope),
      };
    });

  await prisma.$transaction(async (tx) => {
    await tx.printAggregateColumn.deleteMany();
    // createMany throws on an empty data array — skip it when all columns were removed.
    if (data.length > 0) {
      await tx.printAggregateColumn.createMany({ data });
    }
  });

  const result = await prisma.printAggregateColumn.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(result);
}
