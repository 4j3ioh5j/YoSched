import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { coerceConditions } from "@/lib/print-column-visibility";
import { deriveConditionCodes } from "@/lib/print-conditions";
import { NextResponse } from "next/server";

// Read: columns whose conditions name shifts by id, with the shifts' CURRENT codes derived alongside.
export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;

  const [columns, shiftTypes] = await Promise.all([
    prisma.printAggregateColumn.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.shiftType.findMany({ select: { id: true, code: true } }),
  ]);
  return NextResponse.json(columns.map((c) => ({ ...c, conditions: deriveConditionCodes(coerceConditions(c.conditions), shiftTypes) })));
}
