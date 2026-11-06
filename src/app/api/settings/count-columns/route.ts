import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { NextResponse } from "next/server";
import { deriveCountColumnCodes } from "@/lib/count-columns";
import { STALE_CLIENT } from "@/lib/stale-client";

// Read: rows linked by shift id, with the shifts' CURRENT codes derived alongside.
export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;

  const [columns, shiftTypes] = await Promise.all([
    prisma.countColumn.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.shiftType.findMany({ select: { id: true, code: true } }),
  ]);
  return NextResponse.json(deriveCountColumnCodes(columns, shiftTypes));
}

// Write moved to PUT /api/settings/count-columns/by-shift-id (ids only). The only callers
// of THIS path are Settings tabs on a pre-slice bundle, which name shifts by code; a
// renamed-and-reused code can name the wrong shift, so nothing is written — the tab
// reloads. (Refusal stub; removed in a later slice.)
export async function PUT() {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  return NextResponse.json(STALE_CLIENT, { status: 409 });
}
