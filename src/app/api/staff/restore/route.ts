// Card #220: Undo of a staff remove — bring back the same person from the remove's snapshot.
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { restoreStaff, RestoreRefused, isRestoreConflict, REMOVAL_TX } from "@/lib/staff-removal";
import { STAFF_PAGE_INCLUDE, toClientStaff } from "@/lib/staff-client-row";
import { gated } from "@/lib/write-gate";

async function handlePOST(req: NextRequest) {
  const { error } = await getSession("staff:edit");
  if (error) return error;
  const { removalId } = await req.json().catch(() => ({}));
  if (typeof removalId !== "string" || !removalId) return NextResponse.json({ error: "Missing removalId" }, { status: 400 });
  try {
    const row = await prisma.$transaction(async (tx) => {
      const id = await restoreStaff(tx, removalId);
      // Read in the same transaction, under its locks: the row and its rule versions belong together.
      const p = await tx.staff.findUnique({ where: { id }, include: STAFF_PAGE_INCLUDE });
      return p ? toClientStaff(p) : null;
    }, REMOVAL_TX);
    return NextResponse.json(row);
  } catch (e) {
    if (e instanceof RestoreRefused) return NextResponse.json({ error: e.message, reason: "stale" }, { status: 409 });
    if (isRestoreConflict(e)) return NextResponse.json({ error: "This can't be undone any more: something this person used (for example a shift or their staff type) was removed or taken since.", reason: "stale" }, { status: 409 });
    throw e;
  }
}

export const POST = gated(handlePOST);
