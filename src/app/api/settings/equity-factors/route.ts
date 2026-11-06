import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { deriveEquityFactorCodes } from "@/lib/equity-factors";
import { STALE_CLIENT } from "@/lib/stale-client";

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

// Write moved to PUT /api/settings/equity-factors/by-shift-id (ids only). The only
// callers of THIS path are Settings tabs on a pre-slice bundle, which name shifts by
// code; a renamed-and-reused code can name the wrong shift, so nothing is written —
// the tab reloads. (Refusal stub; removed in a later slice.)
export async function PUT() {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  return NextResponse.json(STALE_CLIENT, { status: 409 });
}
