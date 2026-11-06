import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals, syncRequestApprovalsAfterCommit } from "@/lib/request-sync";
import { affectedWindow, uniqueCells, visibleWarnings } from "@/lib/request-affected-window";
import { resolveApproval, ApprovalRetry } from "@/lib/request-approval-resolve";
import { busyResponse, isTxTimeout, lockDayCaps, DAY_CAP_TX } from "@/lib/day-cap-db";
import { unapproveUnderLocks, RippleStale } from "@/lib/request-unapprove";
import { parseRipple } from "@/lib/request-approval-outcome";
import { resolveRequestPlacement, releasableDates, eachDateInclusive, isRequestSatisfied, type RequestKind, type RequestStrength } from "@/lib/schedule-requests";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

// Allowed status transitions. "approved" stamps approver + time; the terminal
// states (declined/withdrawn/fulfilled) just record the outcome.
const STATUSES = ["pending", "approved", "declined", "withdrawn", "fulfilled"] as const;

type RequestRow = {
  id: string;
  staffId: string;
  kind: string;
  shiftTypeIds: string[];
  leaveShiftTypeId: string | null;
  startDate: Date;
  endDate: Date;
  strength: string;
  offStrategyOrder: string[];
};

function serialize(r: { id: string; status: string; approvedAt: Date | null; flaggedReason?: string | null }) {
  return { id: r.id, status: r.status, approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null, flaggedReason: r.flaggedReason ?? null };
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

async function offShiftId(): Promise<string | null> {
  const off = await prisma.shiftType.findFirst({ where: { isOffShift: true }, select: { id: true } });
  return off?.id ?? null;
}

const reqShape = (r: RequestRow) => ({
  kind: r.kind as RequestKind,
  shiftTypeIds: r.shiftTypeIds,
  leaveShiftTypeId: r.leaveShiftTypeId,
  startDate: ymd(r.startDate),
  endDate: ymd(r.endDate),
});

/** The single shift this request would place if approved directly, or null when
 *  it doesn't resolve to one concrete shift (multi-option REQUEST_SHIFT / NEGATE). */
const placementOf = (r: RequestRow, offId: string | null): string | null =>
  resolveRequestPlacement(
    { kind: r.kind as RequestKind, shiftTypeIds: r.shiftTypeIds, leaveShiftTypeId: r.leaveShiftTypeId },
    offId
  );

const coveredCells = (r: RequestRow) =>
  eachDateInclusive(ymd(r.startDate), ymd(r.endDate)).map((date) => ({ staffId: r.staffId, date }));

/** Every status transition clears the "needs resolving" flag (card #67). */
// Card #70: approvalRipple is valid only while the approval that wrote it stands: every other
// status write clears it (only an explicit Undo, undoApproval: true, ever restores it).
const CLEAR_FLAG = { flaggedAt: null, flaggedReason: null, approvalRipple: Prisma.DbNull };

/** Dates of `r` whose request-placed shift is safe to clear when r is removed —
 *  excludes dates another still-approved request also resolves to the same shift,
 *  so removing one request never yanks a shift another still relies on. */
async function datesToRelease(r: RequestRow, placement: string | null, offId: string | null, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<Date[]> {
  if (!placement) return [];
  const days = coveredCells(r).map((c) => c.date);
  const others = await db.scheduleRequest.findMany({
    where: {
      staffId: r.staffId,
      id: { not: r.id },
      status: "approved",
      startDate: { lte: new Date(days[days.length - 1] + "T00:00:00Z") },
      endDate: { gte: new Date(days[0] + "T00:00:00Z") },
    },
  });
  return releasableDates(
    { startDate: ymd(r.startDate), endDate: ymd(r.endDate) },
    placement,
    others.map((o) => ({
      kind: o.kind as RequestKind,
      shiftTypeIds: o.shiftTypeIds,
      leaveShiftTypeId: o.leaveShiftTypeId,
      startDate: ymd(o.startDate),
      endDate: ymd(o.endDate),
    })),
    offId
  ).map((d) => new Date(d + "T00:00:00Z"));
}

// The shifts a just-unapproved request would RE-APPROVE on: returned ONLY when the
// request is still FULLY satisfied (every covered day) by shifts it didn't place
// (auto/manual) — because re-approval needs the whole range (isRequestSatisfied),
// so a partially-satisfied multi-day request stays pending and must NOT warn.
// Caller gates on placement != null, so NEGATE / multi-option requests don't reach
// here. Returns the covered-day cells to clear so the unapprove sticks. Pure read.
async function stillScheduledDays(req: RequestRow): Promise<{ date: string; shiftTypeId: string; code: string }[]> {
  const days = coveredCells(req).map((c) => c.date);
  if (days.length === 0) return [];
  const offIds = new Set(
    (await prisma.shiftType.findMany({ where: { isOffShift: true }, select: { id: true } })).map((s) => s.id),
  );
  const rows = await prisma.assignment.findMany({
    where: { staffId: req.staffId, date: { in: days.map((d) => new Date(d + "T00:00:00Z")) } },
    select: { date: true, shiftTypeId: true, shiftType: { select: { code: true } } },
  });
  const byDate = new Map(rows.map((a) => [ymd(a.date), a]));
  // Only a request still satisfied across its WHOLE range re-approves next reconcile.
  if (!isRequestSatisfied(reqShape(req), (d) => byDate.get(d)?.shiftTypeId ?? null, (s) => offIds.has(s))) return [];
  return [...byDate.values()].map((a) => ({ date: ymd(a.date), shiftTypeId: a.shiftTypeId, code: a.shiftType.code }));
}

// PATCH — change a request's status (the approval action). Requires schedule:edit.
//
// Approval and assignment are two routes to the same end state, so this keeps
// them in sync:
//   • approve a request that resolves to one shift (LEAVE / OFF / single-option
//     REQUEST_SHIFT) → place that shift on every covered day, re-arranging only
//     auto-placed cells when the day is full and only when every hard rule still
//     holds (card #67; the policy is a Setting). When that is impossible the
//     request stays PENDING and is FLAGGED with the reason — a maximum is never
//     broken. Satisfaction then drives the status (syncRequestApprovals), and
//     removing the shift later reverts it to pending.
//   • approve a multi-option REQUEST_SHIFT / NEGATE_SHIFT → there's no single
//     shift to place, so it's a sticky human override (autoApproved=false).
//   • decline / withdraw / re-open → pull back any shift this request placed.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await getSession("schedule:edit");
  if (result.error) return result.error;
  const { id } = await params;
  const viewer = { permissions: result.permissions!, staffId: result.staffId ?? null };

  const existing = await prisma.scheduleRequest.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  const body = await req.json();
  const status: string = body?.status;
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
  }

  const cells = coveredCells(existing);
  const offId = await offShiftId();
  const placement = placementOf(existing, offId);

  if (status === "approved") {
    if (placement) {
      let resolved;
      try {
        resolved = await resolveApproval(
          {
            id: existing.id,
            staffId: existing.staffId,
            ...reqShape(existing),
            strength: existing.strength as RequestStrength,
            offStrategyOrder: existing.offStrategyOrder,
          },
          placement,
          result.userId,
          // The row's status rides in the SAME transaction as the placement: approved
          // with its shifts, or pending + flagged with nothing placed — never one without the other.
          (tx, outcome, ripple) =>
            outcome.ok
              ? tx.scheduleRequest.update({
                  where: { id },
                  data: { status: "approved", autoApproved: true, approvedAt: new Date(), approvedBy: result.userId, ...CLEAR_FLAG, approvalRipple: ripple ?? Prisma.DbNull },
                })
              : tx.scheduleRequest.update({
                  where: { id },
                  data: { status: "pending", autoApproved: false, approvedAt: null, approvedBy: null, flaggedAt: new Date(), flaggedReason: outcome.reason, approvalRipple: Prisma.DbNull },
                }),
        );
      } catch (e) {
        // Waited on another writer of those days for longer than the transaction allows,
        // or the rule windows changed under us: nothing was placed, the request is still pending.
        if (isTxTimeout(e) || e instanceof ApprovalRetry) return busyResponse();
        throw e;
      }
      const { outcome, result: updated } = resolved;
      if (!outcome.ok) {
        return NextResponse.json({ ...serialize(updated), flagged: true, flaggedReason: outcome.reason, affected: await affectedWindow(cells, viewer) });
      }
      // Co-approve / revert any OTHER requests the placement and the ripple touched; never re-derive this one.
      const touched = uniqueCells([...cells, ...outcome.writes.map((w) => ({ staffId: w.staffId, date: w.date }))]);
      await syncRequestApprovalsAfterCommit("PATCH /api/requests/[id]", touched, result.userId, { excludeRequestId: id });
      return NextResponse.json({ ...serialize(updated), affected: await affectedWindow(touched, viewer), ripple: outcome.writes, warnings: visibleWarnings(outcome.warnings, viewer) });
    }
    // Explicit approval is authoritative — stamp it directly regardless of the
    // prior status (don't delegate to sync, which only promotes pending rows).
    // A request with no single shift to place is a sticky override.
    const updated = await prisma.scheduleRequest.update({
      where: { id },
      data: { status: "approved", autoApproved: false, approvedAt: new Date(), approvedBy: result.userId, ...CLEAR_FLAG },
    });
    // Co-approve any OTHER requests the placement satisfies; never re-derive this one.
    await syncRequestApprovals(cells, result.userId, { excludeRequestId: id });
    return NextResponse.json({ ...serialize(updated), affected: await affectedWindow(cells, viewer) });
  }

  if (status === "declined" || status === "withdrawn" || status === "pending") {
    // Pull back this request's placed shift — but only on dates no OTHER approved
    // request still needs it, and never a cell a scheduler took over (source flips
    // to "manual") or locked. Card #70: under the day locks, and on an explicit Undo
    // (undoApproval: true) the approval's ripple onto other staff is put back too.
    const undo = body?.undoApproval === true && existing.status === "approved";
    const ripple = undo ? parseRipple(existing.approvalRipple) : null;
    let done;
    try {
      done = await unapproveUnderLocks({
        requestId: id,
        staffId: existing.staffId,
        coveredDates: cells.map((c) => c.date),
        ripple,
        storedRipple: existing.approvalRipple,
        userId: result.userId,
        release: async (tx) => {
          const release = await datesToRelease(existing, placement, offId, tx);
          if (release.length > 0) {
            await tx.assignment.deleteMany({
              where: {
                staffId: existing.staffId,
                source: "request",
                isLocked: false,
                shiftTypeId: placement!,
                date: { in: release },
              },
            });
          }
        },
        setStatus: (tx) =>
          tx.scheduleRequest.update({
            where: { id },
            data: { status, autoApproved: false, approvedAt: null, approvedBy: null, ...CLEAR_FLAG },
          }),
      });
    } catch (e) {
      if (e instanceof RippleStale) {
        return NextResponse.json({ error: "This approval changed since — reload to see the current schedule.", reason: "stale" }, { status: 409 });
      }
      if (isTxTimeout(e) || e instanceof ApprovalRetry) return busyResponse();
      throw e;
    }
    const { updated, ripple: restore } = done;
    const touched = restore ? uniqueCells([...cells, ...restore.cells]) : cells;
    // Reconcile OTHER requests on those cells, but never re-derive THIS one — the
    // explicit transition is authoritative, even if a satisfying shift remains.
    await syncRequestApprovalsAfterCommit("PATCH /api/requests/[id] un-approve", touched, result.userId, { excludeRequestId: id });
    // Only PENDING re-approves on the next reconcile, so the "still scheduled"
    // warning only matters there; declined/withdrawn stay put regardless. Gate on
    // placement: a single concrete shift (REQUEST_SHIFT-of-one / LEAVE / OFF) — not
    // NEGATE or multi-option, which place nothing to "leave behind".
    const stillScheduled = status === "pending" && placement != null ? await stillScheduledDays(existing) : [];
    return NextResponse.json({
      ...serialize(updated),
      affected: await affectedWindow(touched, viewer),
      stillScheduled,
      ...(restore ? { rippleRestored: restore.restored, rippleReason: restore.reason } : {}),
    });
  }

  // fulfilled — record the outcome only; leave assignments and the stamp as-is.
  const updated = await prisma.scheduleRequest.update({ where: { id }, data: { status, ...CLEAR_FLAG } });
  return NextResponse.json({ ...serialize(updated), affected: await affectedWindow(cells, viewer) });
}

// DELETE — remove a request entirely. Requires schedule:edit.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const result = await getSession("schedule:edit");
  if (result.error) return result.error;
  const { id } = await params;

  const existing = await prisma.scheduleRequest.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  // Pull back this request's placed shift before removing it — but only on dates
  // no OTHER approved request still needs it — then reconcile neighbours.
  const cells = coveredCells(existing);
  const offId = await offShiftId();
  const placement = placementOf(existing, offId);
  // Card #70: lock → re-read → release → delete, in one transaction under the day locks.
  try {
    await prisma.$transaction(async (tx) => {
      await lockDayCaps(tx, cells.map((c) => c.date));
      const release = await datesToRelease(existing, placement, offId, tx);
      if (release.length > 0) {
        await tx.assignment.deleteMany({
          where: {
            staffId: existing.staffId,
            source: "request",
            isLocked: false,
            shiftTypeId: placement!,
            date: { in: release },
          },
        });
      }
      await tx.scheduleRequest.delete({ where: { id } });
    }, DAY_CAP_TX);
  } catch (e) {
    if (isTxTimeout(e)) return busyResponse();
    throw e;
  }
  await syncRequestApprovals(cells, result.userId);
  return NextResponse.json({ ok: true });
}
