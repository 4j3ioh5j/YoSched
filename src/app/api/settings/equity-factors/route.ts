import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { deriveEquityFactorCodes } from "@/lib/equity-factors";

// Read: rows linked by shift id, with the shift's CURRENT code derived alongside.
export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;
  const [factors, shiftTypes] = await Promise.all([
    prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.shiftType.findMany({ select: { id: true, code: true } }),
  ]);
  return NextResponse.json(deriveEquityFactorCodes(factors, shiftTypes));
}
