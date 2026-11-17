import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { aggregateColumnOut } from "@/lib/print-criteria";
import { NextResponse } from "next/server";
import { gated } from "@/lib/write-gate";

// Read: columns whose conditions name shifts by id, with the shifts' CURRENT codes derived alongside,
// plus (card #309) each column's effective Include / Exclude rule lines.
async function handleGET() {
  const { error } = await getSession("settings:view");
  if (error) return error;

  const [columns, shiftTypes] = await Promise.all([
    prisma.printAggregateColumn.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.shiftType.findMany({ select: { id: true, code: true } }),
  ]);
  return NextResponse.json(columns.map((c) => aggregateColumnOut(c, shiftTypes)));
}

export const GET = gated(handleGET);
