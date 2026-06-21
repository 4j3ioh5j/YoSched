import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals, placeApprovedRequestShift } from "@/lib/request-sync";
import { resolveRequestPlacement, eachDateInclusive, validateRestoreInput, type RequestKind } from "@/lib/schedule-requests";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

const at = (date: string) => new Date(date + "T00:00:00Z");

// PUT — recreate a request VERBATIM under its original id (undo of a delete, or
// redo of a create). Keeping the id stable is what stops other undo-stack
// entries that reference this request from going stale. Requires schedule:edit.
//
// The row is recreated with its full lifecycle state (status / approval stamp),
// and if it was approved and resolves to a single shift, that shift is re-placed
// — so undoing the delete of an approved request restores BOTH the request and
// its placement, exactly like the original approve.
export async function PUT(req: NextRequest, { params }: Ctx) {
  const result = await getSession("schedule:edit");
  if (result.error) return result.error;
  const { id: routeId } = await params;

  const body = await req.json();
  const parsed = validateRestoreInput({ ...body, id: routeId });
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const v = parsed.value;

  // Idempotent: if the id is somehow already present (double-undo / race), don't
  // duplicate — just report it back.
  const already = await prisma.scheduleRequest.findUnique({ where: { id: v.id } });
  if (already) {
    return NextResponse.json({ id: already.id, status: already.status }, { status: 200 });
  }

  const offId = (await prisma.shiftType.findFirst({ where: { isOffShift: true }, select: { id: true } }))?.id ?? null;
  const placement = resolveRequestPlacement(
    { kind: v.kind as RequestKind, shiftTypeIds: v.shiftTypeIds, leaveShiftTypeId: v.leaveShiftTypeId },
    offId
  );
  const cells = eachDateInclusive(v.startDate, v.endDate).map((date) => ({ staffId: v.staffId, date }));

  // Replay placement BEFORE creating the row, using the SAME validated path as
  // PATCH approve. If a covered day is now locked and unsatisfied, approval
  // can't be honoured — fall back to recreating the request as PENDING rather
  // than minting an approved row whose shift isn't actually placed (the state
  // PATCH refuses). Faithful when nothing is blocked.
  let finalStatus = v.status;
  let blockedDates: string[] = [];
  if (v.status === "approved" && placement) {
    const { blocked } = await placeApprovedRequestShift(
      { staffId: v.staffId, kind: v.kind as RequestKind, shiftTypeIds: v.shiftTypeIds, leaveShiftTypeId: v.leaveShiftTypeId, startDate: v.startDate, endDate: v.endDate },
      placement
    );
    if (blocked.length > 0) { finalStatus = "pending"; blockedDates = blocked; }
  }
  const approved = finalStatus === "approved";

  const created = await prisma.scheduleRequest.create({
    data: {
      id: v.id,
      staffId: v.staffId,
      startDate: at(v.startDate),
      endDate: at(v.endDate),
      kind: v.kind,
      shiftTypeIds: v.shiftTypeIds,
      leaveShiftTypeId: v.leaveShiftTypeId,
      strength: v.strength,
      source: v.source,
      notes: v.notes,
      offStrategyOrder: v.offStrategyOrder,
      status: finalStatus,
      // Mirror PATCH's invariant: an approved single-shift request is auto
      // (revertible when the shift is removed); approved-with-no-placement is sticky.
      autoApproved: approved && placement != null,
      ...(approved ? { approvedAt: v.approvedAt ? new Date(v.approvedAt) : new Date(), approvedBy: v.approvedBy ?? result.userId } : {}),
      ...(v.receivedAt ? { receivedAt: new Date(v.receivedAt) } : {}),
    },
  });

  // Reconcile any neighbour requests the re-placement satisfies; never re-derive this one.
  if (approved && placement) await syncRequestApprovals(cells, result.userId, { excludeRequestId: v.id });

  return NextResponse.json({ id: created.id, status: created.status, ...(blockedDates.length ? { blockedDates } : {}) }, { status: 201 });
}
