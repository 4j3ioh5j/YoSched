import { planKeepIds } from "@/lib/special-columns";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { coerceConditionScope } from "@/lib/print-aggregate-columns";
import { aggregateColumnOut, legacyMirror, legacySnapshot, parseCriteriaIn, type CriteriaLine } from "@/lib/print-criteria";
import { NextRequest, NextResponse } from "next/server";
import { gated } from "@/lib/write-gate";

// Card #309: printed-schedule aggregate columns with their Include / Exclude rule lines. The list
// IS the setting: the body replaces all rows (a column sent with its id keeps it, see card #300).
// This route is new, so a tab running this code against a rolled-back server gets 404 and the
// "reload" message instead of a save that would drop its rule lines.
type ColumnInput = {
  id?: unknown;
  label?: unknown;
  enabled?: unknown;
  suppressMembers?: unknown;
  isOther?: unknown;
  criteria?: unknown;
  conditionScope?: unknown;
};

function bad(error: string, reason: string) {
  return NextResponse.json({ error, reason }, { status: 400 });
}

async function handlePUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;

  const body = (await req.json().catch(() => null)) as { columns?: unknown } | null;
  if (!Array.isArray(body?.columns)) return bad("columns must be an array", "bad-request");

  const shiftTypes = await prisma.shiftType.findMany({ select: { id: true, code: true } });
  const shifts = { ids: new Set(shiftTypes.map((s) => s.id)), codes: new Set(shiftTypes.map((s) => s.code)) };

  // Validate everything before any write.
  const columns = (body.columns as unknown[]).filter((c): c is ColumnInput => !!c && typeof c === "object");
  const rows: { label: string; sortOrder: number; enabled: boolean; suppressMembers: boolean; isOther: boolean; conditionScope: string; criteria: CriteriaLine[] }[] = [];
  for (const [i, c] of columns.entries()) {
    const parsed = parseCriteriaIn(c.criteria, shifts, `column ${i + 1}`);
    if (!parsed.ok) return NextResponse.json(parsed.body, { status: parsed.status });
    const isOther = c.isOther === true;
    rows.push({
      label: typeof c.label === "string" ? c.label : isOther ? "Other" : "",
      sortOrder: i,
      enabled: c.enabled !== false,
      // A catch-all claims nobody, so it never suppresses anyone's own column.
      suppressMembers: isOther ? false : c.suppressMembers !== false,
      isOther,
      // A catch-all without rule lines has nothing for a scope to apply to: store "month".
      conditionScope: isOther && parsed.criteria.length === 0 ? "month" : coerceConditionScope(c.conditionScope),
      criteria: parsed.criteria,
    });
  }

  const bodyIds = columns.map((c) => c.id);
  const result = await prisma.$transaction(async (tx) => {
    const existing = new Set((await tx.printAggregateColumn.findMany({ select: { id: true } })).map((r) => r.id));
    const plan = planKeepIds(existing, bodyIds);
    if (!plan.ok) return plan;
    if (plan.deleteIds.length > 0) await tx.printAggregateColumn.deleteMany({ where: { id: { in: plan.deleteIds } } });
    for (const [i, row] of rows.entries()) {
      // The old single-rule fields, for a code rollback: the lines when one Include line can say
      // them; otherwise left as stored (a new row: empty), so the old code prints that column by
      // its rule from before. A catch-all has no old rule.
      const mirror = row.isOther
        ? { employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions: [] }
        : legacyMirror(row.criteria);
      const id = plan.keep[i];
      const empty = { employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions: [] };
      // The legacy fields this row will hold, and their snapshot beside the lines (liveCriteria).
      const stored = id ? await tx.printAggregateColumn.findUnique({ where: { id } }) : null;
      const legacy = mirror ?? (stored ? { employmentTypeIds: stored.employmentTypeIds, minFtePercentage: stored.minFtePercentage, maxFtePercentage: stored.maxFtePercentage, conditions: stored.conditions } : empty);
      const data = { ...row, ...legacy, conditions: legacy.conditions ?? [], criteriaBase: legacySnapshot({ isOther: row.isOther, conditionScope: row.conditionScope, ...legacy }) };
      if (id) await tx.printAggregateColumn.upsert({ where: { id }, create: { id, ...data }, update: data });
      else await tx.printAggregateColumn.create({ data });
    }
    return tx.printAggregateColumn.findMany({ orderBy: { sortOrder: "asc" } });
  });
  if (!Array.isArray(result)) return bad(result.error, "duplicate-id");

  return NextResponse.json(result.map((c) => aggregateColumnOut(c, shiftTypes)));
}

export const PUT = gated(handlePUT);
