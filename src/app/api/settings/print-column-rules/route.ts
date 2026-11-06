import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { coerceConditions } from "@/lib/print-column-visibility";
import { deriveConditionCodes } from "@/lib/print-conditions";
import { STALE_CLIENT } from "@/lib/stale-client";
import { NextResponse } from "next/server";

// Read: rules whose conditions name shifts by id, with the shifts' CURRENT codes derived alongside.
export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;

  const [rules, shiftTypes] = await Promise.all([
    prisma.printColumnRule.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.shiftType.findMany({ select: { id: true, code: true } }),
  ]);
  return NextResponse.json(rules.map((r) => ({ ...r, conditions: deriveConditionCodes(coerceConditions(r.conditions), shiftTypes) })));
}

// Write moved to PUT /api/settings/print-column-rules/by-shift-id (ids only). The only
// callers of THIS path are Settings tabs on a pre-slice bundle, whose conditions name shifts
// by code; a renamed-and-reused code can name the wrong shift, so nothing is written — the
// tab reloads. (Refusal stub; removed in a later slice.)
export async function PUT() {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  return NextResponse.json(STALE_CLIENT, { status: 409 });
}
