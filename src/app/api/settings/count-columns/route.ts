import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { NextResponse } from "next/server";
import { deriveCountColumnCodes } from "@/lib/count-columns";
import { gated } from "@/lib/write-gate";

// Read: rows linked by shift id, with the shifts' CURRENT codes derived alongside.
async function handleGET() {
  const { error } = await getSession("settings:view");
  if (error) return error;

  const [columns, shiftTypes] = await Promise.all([
    prisma.countColumn.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.shiftType.findMany({ select: { id: true, code: true } }),
  ]);
  return NextResponse.json(deriveCountColumnCodes(columns, shiftTypes));
}

export const GET = gated(handleGET);
