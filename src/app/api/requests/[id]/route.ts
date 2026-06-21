import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals, placeApprovedRequestShift } from "@/lib/request-sync";
import { resolveUpdaterNames } from "@/lib/assignment-attribution";
import { resolveRequestPlacement, releasableDates, eachDateInclusive, type RequestKind } from "@/lib/schedule-requests";
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
};

function serialize(r: { id: string; status: string; approvedAt: Date | null }) {
  return { id: r.id, status: r.status, approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null };
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

/** Dates of `r` whose request-placed shift is safe to clear when r is removed —
 *  excludes dates another still-approved request also resolves to the same shift,
 *  so removing one request never yanks a shift another still relies on. */
async function datesToRelease(r: RequestRow, placement: string | null, offId: string | null): Promise<Date[]> {
  if (!placement) return [];
  const days = coveredCells(r).map((c) => c.date);
  const others = await prisma.scheduleRequest.findMany({
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

// The authoritative post-change state of everything a status change can touch:
// the visible (pending/approved) requests overlapping the covered cells — which
// includes any co-approved/reverted NEIGHBOUR requests — and the current
// assignment on each covered cell. The client replaces its local state for this
// window so co-approval cascades and placement are always reflected exactly,
// and undo/redo (which PATCH back) get the inverse window the same way.
async function affectedWindow(staffId: string, cells: { staffId: string; date: string }[]) {
  if (cells.length === 0) return { requests: [], cells: [] };
  const dates = cells.map((c) => c.date).sort();
  const at = (d: string) => new Date(d + "T00:00:00Z");
  const [requests, assignments] = await Promise.all([
    prisma.scheduleRequest.findMany({
      where: {
        staffId,
        status: { in: ["pending", "approved"] },
        startDate: { lte: at(dates[dates.length - 1]) },
        endDate: { gte: at(dates[0]) },
      },
      // autoApproved is what the client overlay needs to label Auto- vs
      // Manually-approved; approvedBy/approvedAt drive the "by <name> (<date>)".
      select: { id: true, status: true, autoApproved: true, approvedBy: true, approvedAt: true },
    }),
    prisma.assignment.findMany({
      where: { staffId, date: { in: cells.map((c) => at(c.date)) } },
      select: { id: true, date: true, shiftTypeId: true, isLocked: true },
    }),
  ]);
  const byDate = new Map(assignments.map((a) => [ymd(a.date), a]));
  // This route is schedule:edit-only, so the caller is always allowed approver
  // names (NAME only — same gating the /requests page applies to viewers).
  const approverNames = await resolveUpdaterNames(requests.map((r) => r.approvedBy));
  return {
    requests: requests.map((r) => ({
      id: r.id,
      status: r.status,
      autoApproved: r.autoApproved,
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
      approvedByName: r.approvedBy ? approverNames.get(r.approvedBy) ?? "Unknown" : null,
    })),
    cells: cells.map((c) => {
      const a = byDate.get(c.date);
      return {
        staffId: c.staffId,
        date: c.date,
        assignment: a ? { id: a.id, shiftTypeId: a.shiftTypeId, isLocked: a.isLocked } : null,
      };
    }),
  };
}

// PATCH — change a request's status (the approval action). Requires schedule:edit.
//
// Approval and assignment are two routes to the same end state, so this keeps
// them in sync:
//   • approve a request that resolves to one shift (LEAVE / OFF / single-option
//     REQUEST_SHIFT) → place that shift on every covered day; satisfaction then
//     drives the status (syncRequestApprovals), and removing the shift later
//     reverts it to pending.
//   • approve a multi-option REQUEST_SHIFT / NEGATE_SHIFT → there's no single
//     shift to place, so it's a sticky human override (autoApproved=false).
//   • decline / withdraw / re-open → pull back any shift this request placed.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await getSession("schedule:edit");
  if (result.error) return result.error;
  const { id } = await params;

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
      // A locked day that doesn't already satisfy the request can't be honoured —
      // approval can neither place its shift nor lean on what's there. Refuse the
      // approval (place nothing) and leave the request pending so the scheduler
      // resolves the lock; the grid keeps surfacing it as an unmet request.
      // (Shared with /restore via placeApprovedRequestShift so the lock rule and
      // placement are identical in both.)
      const { blocked } = await placeApprovedRequestShift({ ...reqShape(existing), staffId: existing.staffId }, placement);
      if (blocked.length > 0) {
        return NextResponse.json(
          {
            error: `Can't approve — ${blocked.length} covered day(s) locked (${blocked.join(", ")}). Unlock them or place the shift manually, then approve.`,
            blockedDates: blocked,
          },
          { status: 409 }
        );
      }
    }
    // Explicit approval is authoritative — stamp it directly regardless of the
    // prior status (don't delegate to sync, which only promotes pending rows).
    // Placement-backed approvals are autoApproved (revert if the shift is later
    // removed); a request with no single shift to place is a sticky override.
    const updated = await prisma.scheduleRequest.update({
      where: { id },
      data: { status: "approved", autoApproved: placement != null, approvedAt: new Date(), approvedBy: result.userId },
    });
    // Co-approve any OTHER requests the placement satisfies; never re-derive this one.
    await syncRequestApprovals(cells, result.userId, { excludeRequestId: id });
    return NextResponse.json({ ...serialize(updated), affected: await affectedWindow(existing.staffId, cells) });
  }

  if (status === "declined" || status === "withdrawn" || status === "pending") {
    // Pull back this request's placed shift — but only on dates no OTHER approved
    // request still needs it, and never a cell a scheduler took over (source flips
    // to "manual") or locked.
    const release = await datesToRelease(existing, placement, offId);
    if (release.length > 0) {
      await prisma.assignment.deleteMany({
        where: {
          staffId: existing.staffId,
          source: "request",
          isLocked: false,
          shiftTypeId: placement!,
          date: { in: release },
        },
      });
    }
    const updated = await prisma.scheduleRequest.update({
      where: { id },
      data: { status, autoApproved: false, approvedAt: null, approvedBy: null },
    });
    // Reconcile OTHER requests on those cells, but never re-derive THIS one — the
    // explicit transition is authoritative, even if a satisfying shift remains.
    await syncRequestApprovals(cells, result.userId, { excludeRequestId: id });
    return NextResponse.json({ ...serialize(updated), affected: await affectedWindow(existing.staffId, cells) });
  }

  // fulfilled — record the outcome only; leave assignments and the stamp as-is.
  const updated = await prisma.scheduleRequest.update({ where: { id }, data: { status } });
  return NextResponse.json({ ...serialize(updated), affected: await affectedWindow(existing.staffId, cells) });
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
  const release = await datesToRelease(existing, placement, offId);
  if (release.length > 0) {
    await prisma.assignment.deleteMany({
      where: {
        staffId: existing.staffId,
        source: "request",
        isLocked: false,
        shiftTypeId: placement!,
        date: { in: release },
      },
    });
  }

  await prisma.scheduleRequest.delete({ where: { id } });
  await syncRequestApprovals(cells, result.userId);
  return NextResponse.json({ ok: true });
}
