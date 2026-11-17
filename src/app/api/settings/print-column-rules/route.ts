import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { coerceConditions } from "@/lib/print-column-visibility";
import { deriveConditionCodes } from "@/lib/print-conditions";
import { NextResponse } from "next/server";
import { gated } from "@/lib/write-gate";

// Read: rules whose conditions name shifts by id, with the shifts' CURRENT codes derived alongside.
async function handleGET() {
  const { error } = await getSession("settings:view");
  if (error) return error;

  const [rules, shiftTypes] = await Promise.all([
    prisma.printColumnRule.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.shiftType.findMany({ select: { id: true, code: true } }),
  ]);
  return NextResponse.json(rules.map((r) => ({ ...r, conditions: deriveConditionCodes(coerceConditions(r.conditions), shiftTypes) })));
}

export const GET = gated(handleGET);
