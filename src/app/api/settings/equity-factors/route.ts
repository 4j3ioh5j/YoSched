import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { deriveEquityFactorCodes } from "@/lib/equity-factors";
import { gated } from "@/lib/write-gate";

// Read: rows linked by shift id, with the shift's CURRENT code derived alongside.
async function handleGET() {
  const { error } = await getSession("settings:view");
  if (error) return error;
  const [factors, shiftTypes] = await Promise.all([
    prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.shiftType.findMany({ select: { id: true, code: true } }),
  ]);
  return NextResponse.json(deriveEquityFactorCodes(factors, shiftTypes));
}

export const GET = gated(handleGET);
