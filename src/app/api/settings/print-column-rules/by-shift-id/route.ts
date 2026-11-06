import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { coerceConditions, type ShiftCondition } from "@/lib/print-column-visibility";
import { deriveConditionCodes, parseConditionsIn } from "@/lib/print-conditions";
import { NextRequest, NextResponse } from "next/server";

// Printed-schedule column rules, with shifts named by ID inside the conditions. The list IS
// the setting: the body replaces all rows. Every shift reference must be a current shift id
// and the body must carry no shift code at all — this path exists so that a save from a new
// tab can never be interpreted by a server that still resolves codes (a pre-slice server has
// no such route and answers 404).
type RuleInput = {
  label?: unknown;
  enabled?: unknown;
  mode?: unknown;
  employmentTypeIds?: unknown;
  minFtePercentage?: unknown;
  maxFtePercentage?: unknown;
  conditions?: unknown;
  shiftCodes?: unknown;
  shiftMatch?: unknown;
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

  const body = (await req.json()) as { rules?: unknown };
  if (!Array.isArray(body?.rules)) return bad("rules must be an array", "bad-request");
  const rules = body.rules as RuleInput[];

  const shiftTypes = await prisma.shiftType.findMany({ select: { id: true, code: true } });
  const shifts = { ids: new Set(shiftTypes.map((s) => s.id)), codes: new Set(shiftTypes.map((s) => s.code)) };

  // Validate everything before any write.
  const rows: {
    label: string; sortOrder: number; enabled: boolean; mode: string; employmentTypeIds: string[];
    minFtePercentage: number | null; maxFtePercentage: number | null; conditions: ShiftCondition[];
  }[] = [];
  for (const [i, r] of rules.entries()) {
    if (!r || typeof r !== "object") return bad(`rule ${i}: not an object`, "bad-request");
    // The legacy single selector is a pre-slice payload shape.
    if ("shiftCodes" in r || "shiftMatch" in r) return bad(`rule ${i}: shiftCodes/shiftMatch are not accepted here; send conditions with shiftTypeIds`, "bad-request");
    const parsed = parseConditionsIn(r.conditions, shifts, `rule ${i}`);
    if (!parsed.ok) return NextResponse.json(parsed.body, { status: parsed.status });
    rows.push({
      label: typeof r.label === "string" ? r.label : "",
      sortOrder: i,
      enabled: r.enabled !== false,
      mode: r.mode === "exclude" ? "exclude" : "include",
      employmentTypeIds: Array.isArray(r.employmentTypeIds) ? r.employmentTypeIds.filter((x): x is string => typeof x === "string") : [],
      minFtePercentage: num(r.minFtePercentage),
      maxFtePercentage: num(r.maxFtePercentage),
      conditions: parsed.conditions,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.printColumnRule.deleteMany();
    if (rows.length > 0) await tx.printColumnRule.createMany({ data: rows });
    return tx.printColumnRule.findMany({ orderBy: { sortOrder: "asc" } });
  });

  return NextResponse.json(result.map((r) => ({ ...r, conditions: deriveConditionCodes(coerceConditions(r.conditions), shiftTypes) })));
}
