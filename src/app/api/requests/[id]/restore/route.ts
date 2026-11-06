import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals, syncRequestApprovalsAfterCommit } from "@/lib/request-sync";
import { affectedWindow, uniqueCells, visibleWarnings } from "@/lib/request-affected-window";
import { resolveApproval, ApprovalRetry } from "@/lib/request-approval-resolve";
import { busyResponse, isTxTimeout } from "@/lib/day-cap-db";
import { resolveRequestPlacement, eachDateInclusive, validateRestoreInput, type RequestKind, type RequestStrength } from "@/lib/schedule-requests";
import { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

const at = (date: string) => new Date(date + "T00:00:00Z");

// PUT — recreate a request VERBATIM under its original id (undo of a delete, or
// redo of a create). Keeping the id stable is what stops other undo-stack
// entries that reference this request from going stale. Requires schedule:edit.
//
// The row is recreated with its full lifecycle state (status / approval stamp),
// and if it was approved and resolves to a single shift, that shift is re-placed
// through the SAME resolve as PATCH approve (card #67): the grid is re-arranged
// legally or the request comes back PENDING and flagged with the reason, never as
// an approved row whose shift isn't actually placed.
export async function PUT(req: NextRequest, { params }: Ctx) {
  const result = await getSession("schedule:edit");
  if (result.error) return result.error;
  const { id: routeId } = await params;
  const viewer = { permissions: result.permissions!, staffId: result.staffId ?? null };

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

  const rowData = (approved: boolean): Prisma.ScheduleRequestUncheckedCreateInput => ({
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
    status: approved ? "approved" : v.status === "approved" ? "pending" : v.status,
    // Mirror PATCH's invariant: an approved single-shift request is auto
    // (revertible when the shift is removed); approved-with-no-placement is sticky.
    autoApproved: approved && placement != null,
    ...(approved ? { approvedAt: v.approvedAt ? new Date(v.approvedAt) : new Date(), approvedBy: v.approvedBy ?? result.userId } : {}),
    ...(v.receivedAt ? { receivedAt: new Date(v.receivedAt) } : {}),
  });

  if (v.status === "approved" && placement) {
    let resolved;
    try {
      resolved = await resolveApproval(
        {
          id: v.id,
          staffId: v.staffId,
          kind: v.kind as RequestKind,
          shiftTypeIds: v.shiftTypeIds,
          leaveShiftTypeId: v.leaveShiftTypeId,
          startDate: v.startDate,
          endDate: v.endDate,
          strength: v.strength as RequestStrength,
          offStrategyOrder: v.offStrategyOrder,
        },
        placement,
        result.userId,
        (tx, outcome, ripple) =>
          outcome.ok
            ? tx.scheduleRequest.create({ data: { ...rowData(true), approvalRipple: ripple ?? Prisma.DbNull } })
            : tx.scheduleRequest.create({ data: { ...rowData(false), flaggedAt: new Date(), flaggedReason: outcome.reason } }),
      );
    } catch (e) {
      // Waited too long on another writer of those days (or the rule windows changed
      // under us): nothing placed, nothing recreated yet — the client retries the undo.
      if (isTxTimeout(e) || e instanceof ApprovalRetry) return busyResponse();
      throw e;
    }
    const { outcome, result: created } = resolved;
    if (!outcome.ok) {
      return NextResponse.json(
        { id: created.id, status: created.status, flagged: true, flaggedReason: outcome.reason, affected: await affectedWindow(cells, viewer) },
        { status: 201 },
      );
    }
    const touched = uniqueCells([...cells, ...outcome.writes.map((w) => ({ staffId: w.staffId, date: w.date }))]);
    // Reconcile any neighbour requests the re-placement satisfies; never re-derive this one.
    await syncRequestApprovalsAfterCommit("PUT /api/requests/[id]/restore", touched, result.userId, { excludeRequestId: v.id });
    return NextResponse.json(
      { id: created.id, status: created.status, affected: await affectedWindow(touched, viewer), ripple: outcome.writes, warnings: visibleWarnings(outcome.warnings, viewer) },
      { status: 201 },
    );
  }

  const created = await prisma.scheduleRequest.create({ data: rowData(v.status === "approved") });
  if (v.status === "approved") await syncRequestApprovals(cells, result.userId, { excludeRequestId: v.id });
  return NextResponse.json({ id: created.id, status: created.status, affected: await affectedWindow(cells, viewer) }, { status: 201 });
}
