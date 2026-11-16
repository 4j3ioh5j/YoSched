import { planKeepIds } from "@/lib/special-columns";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { coerceConditions, type ShiftCondition } from "@/lib/print-column-visibility";
import { coerceConditionScope } from "@/lib/print-aggregate-columns";
import { deriveConditionCodes, parseConditionsIn } from "@/lib/print-conditions";
import { NextRequest, NextResponse } from "next/server";

// Printed-schedule aggregate columns, with shifts named by ID inside the conditions. The list
// IS the setting: the body replaces all rows. Every shift reference must be a current shift
// id and the body must carry no shift code at all — this path exists so that a save from a
// new tab can never be interpreted by a server that still resolves codes (a pre-slice server
// has no such route and answers 404).
type ColumnInput = {
  label?: unknown;
  enabled?: unknown;
  suppressMembers?: unknown;
  isOther?: unknown;
  employmentTypeIds?: unknown;
  minFtePercentage?: unknown;
  maxFtePercentage?: unknown;
  conditions?: unknown;
  conditionScope?: unknown;
};

/** Coerce a value to a finite number or null (rejects NaN/strings/±Infinity). */
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function bad(error: string, reason: string) {
  return NextResponse.json({ error, reason }, { status: 400 });
}

export async function PUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;

  const body = (await req.json()) as { columns?: unknown };
  if (!Array.isArray(body?.columns)) return bad("columns must be an array", "bad-request");

  const shiftTypes = await prisma.shiftType.findMany({ select: { id: true, code: true } });
  const shifts = { ids: new Set(shiftTypes.map((s) => s.id)), codes: new Set(shiftTypes.map((s) => s.code)) };

  // Validate everything before any write. Non-object entries (e.g. a stray null) are dropped
  // rather than throwing, as before.
  const columns = (body.columns as unknown[]).filter((c): c is ColumnInput => !!c && typeof c === "object");
  const rows: {
    label: string; sortOrder: number; enabled: boolean; suppressMembers: boolean; isOther: boolean;
    employmentTypeIds: string[]; minFtePercentage: number | null; maxFtePercentage: number | null;
    conditions: ShiftCondition[]; conditionScope: string;
  }[] = [];
  for (const [i, c] of columns.entries()) {
    // Validated for every column (a code-shaped payload is a stale tab whatever the column is),
    // then cleared for a catch-all, which carries no rule.
    const parsed = parseConditionsIn(c.conditions, shifts, `column ${i}`);
    if (!parsed.ok) return NextResponse.json(parsed.body, { status: parsed.status });
    const isOther = c.isOther === true;
    rows.push({
      label: typeof c.label === "string" ? c.label : isOther ? "Other" : "",
      sortOrder: i,
      enabled: c.enabled !== false,
      // A catch-all column has no rule and no suppression — neutralize regardless of payload.
      suppressMembers: isOther ? false : c.suppressMembers !== false,
      isOther,
      employmentTypeIds: isOther
        ? []
        : Array.isArray(c.employmentTypeIds) ? c.employmentTypeIds.filter((x): x is string => typeof x === "string") : [],
      minFtePercentage: isOther ? null : num(c.minFtePercentage),
      maxFtePercentage: isOther ? null : num(c.maxFtePercentage),
      conditions: isOther ? [] : parsed.conditions,
      // Catch-all has no conditions, so its scope is meaningless — force "month".
      conditionScope: isOther ? "month" : coerceConditionScope(c.conditionScope),
    });
  }

  // Card #300: a column sent with its id keeps it (the special-column order names columns
  // by id); a column without one — or naming no existing row — is created fresh; rows not
  // sent are deleted. An older tab sends no ids and gets today's replace-all.
  const bodyIds = columns.map((c) => (c as { id?: unknown }).id);
  const result = await prisma.$transaction(async (tx) => {
    const existing = new Set((await tx.printAggregateColumn.findMany({ select: { id: true } })).map((r) => r.id));
    const plan = planKeepIds(existing, bodyIds);
    if (!plan.ok) return plan;
    if (plan.deleteIds.length > 0) await tx.printAggregateColumn.deleteMany({ where: { id: { in: plan.deleteIds } } });
    for (const [i, row] of rows.entries()) {
      const id = plan.keep[i];
      if (id) await tx.printAggregateColumn.upsert({ where: { id }, create: { id, ...row }, update: row });
      else await tx.printAggregateColumn.create({ data: row });
    }
    return tx.printAggregateColumn.findMany({ orderBy: { sortOrder: "asc" } });
  });
  if (!Array.isArray(result)) return bad(result.error, "duplicate-id");

  return NextResponse.json(result.map((c) => ({ ...c, conditions: deriveConditionCodes(coerceConditions(c.conditions), shiftTypes) })));
}
