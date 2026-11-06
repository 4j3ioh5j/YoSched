// Keeps request approval state in sync with the schedule. Whenever assignments
// change, a request is auto-approved once every day it covers has a satisfying
// assignment, and an auto-approval is reverted to pending if that stops being
// true. This is the assign→approve direction; the requests route handles the
// approve→assign direction. Satisfaction rules live in schedule-requests.ts.
import { prisma } from "./prisma";
import { DAY_CAP_TX, lockDayCaps } from "./day-cap-db";
import { isRequestSatisfied, reconcileApprovalAction, lockedBlockingDates, eachDateInclusive, isRequestVisibleToViewer, type RequestKind } from "./schedule-requests";

type Cell = { staffId: string; date: string }; // date = "YYYY-MM-DD"

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

type PlaceableRequest = {
  staffId: string;
  kind: RequestKind;
  shiftTypeIds: string[];
  leaveShiftTypeId: string | null;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
};

/**
 * Place an approved request's resolved shift across its covered days — the
 * approve→assign half of the sync, shared by the PATCH-approve route and the
 * undo /restore route so the lock rule and placement stay identical in both.
 *
 * A locked day that doesn't already satisfy the request can't be honoured
 * (approval can neither place its shift nor lean on what's there): such days are
 * returned in `blocked` and NOTHING is placed — the caller decides whether to
 * refuse (PATCH → 409) or fall back to pending (restore). When nothing is
 * blocked, the shift is upserted (source:"request") on every covered,
 * non-locked day. Caller still owns the request row's status + a follow-up
 * syncRequestApprovals to reconcile neighbours.
 */
export async function placeApprovedRequestShift(
  req: PlaceableRequest,
  placement: string,
): Promise<{ blocked: string[] }> {
  const at = (date: string) => new Date(date + "T00:00:00Z");
  const dates = eachDateInclusive(req.startDate, req.endDate);
  const offSet = new Set(
    (await prisma.shiftType.findMany({ where: { isOffShift: true }, select: { id: true } })).map((s) => s.id)
  );
  // This is an assignment WRITER like the grid routes, so it joins their lock protocol
  // (src/lib/day-cap-db.ts): the per-date locks first, then the read the decision rests
  // on, then the writes, all in one transaction. Without it a request approval could
  // land between another writer's cap check and its write. It does not itself check
  // the per-day cap (card #67 is that decision).
  return prisma.$transaction(async (tx) => {
    await lockDayCaps(tx, dates);
    const existing = await tx.assignment.findMany({
      where: { staffId: req.staffId, date: { in: dates.map(at) } },
      select: { date: true, shiftTypeId: true, isLocked: true },
    });
    const byDate = new Map(existing.map((c) => [ymd(c.date), c]));
    const blocked = lockedBlockingDates(
      req,
      (date) => {
        const c = byDate.get(date);
        return c ? { shiftTypeId: c.shiftTypeId, isLocked: c.isLocked } : null;
      },
      (s) => offSet.has(s)
    );
    if (blocked.length > 0) return { blocked };

    for (const date of dates) {
      if (byDate.get(date)?.isLocked) continue; // already satisfies (else it'd be blocked)
      await tx.assignment.upsert({
        where: { staffId_date: { staffId: req.staffId, date: at(date) } },
        update: { shiftTypeId: placement, source: "request" },
        create: { staffId: req.staffId, date: at(date), shiftTypeId: placement, source: "request" },
      });
    }
    return { blocked: [] };
  }, DAY_CAP_TX);
}

/**
 * Reconcile request approval after assignments change for the given cells.
 *   - pending & now fully satisfied            → approved (autoApproved = true)
 *   - approved & autoApproved & no longer satisfied → reverted to pending
 * Sticky approvals (autoApproved = false — multi-option/NEGATE overrides and any
 * manual decision) are never touched, and contradictions are never auto-declined;
 * they surface through the existing cell warnings instead. Runs after the
 * assignment write has committed, so it reads the post-change schedule.
 *
 * `excludeRequestId` skips a request the caller is explicitly transitioning, so
 * a manual un-approve isn't instantly re-derived back to approved.
 *
 * Returns the requests whose status it flipped (id + new status) so a caller can
 * mirror the change into client state without a full refetch — auto-schedule uses
 * this to keep the grid's request overlay in sync the moment shifts are applied.
 */
export type RequestStatusChange = { id: string; staffId: string; status: "approved" | "pending"; autoApproved: boolean };

/** Narrow a set of status changes to those the viewer is allowed to see, mapping
 *  to the bare {id, status} the client overlay consumes. A caller with
 *  schedule:edit but not requests:view must not learn another staff's hidden
 *  PENDING request ids via a write response — same visibility rule the schedule
 *  page applies to props (isRequestVisibleToViewer). Pure. */
export function visibleRequestChanges(
  changes: RequestStatusChange[],
  viewer: { permissions: string[]; staffId: string | null }
): { id: string; status: "approved" | "pending"; autoApproved: boolean }[] {
  const canViewAll = viewer.permissions.includes("requests:view");
  return changes
    .filter((c) => isRequestVisibleToViewer(c, { canViewAll, viewerStaffId: viewer.staffId }))
    .map((c) => ({ id: c.id, status: c.status, autoApproved: c.autoApproved }));
}

/**
 * syncRequestApprovals for a route whose assignment write has ALREADY committed. The
 * sync is a derived, secondary effect: if it fails, the route must still report the
 * rows it saved, or the client would revert cells the server kept and the two would
 * diverge. Logs under `label` and returns no changes; a later write or refresh
 * re-derives the approval state.
 */
export async function syncRequestApprovalsAfterCommit(
  label: string,
  affected: Cell[],
  approverUserId: string | null,
  opts: { excludeRequestId?: string | null } = {}
): Promise<RequestStatusChange[]> {
  try {
    return await syncRequestApprovals(affected, approverUserId, opts);
  } catch (err) {
    console.error(`${label}: request-approval sync failed after commit (assignments persisted)`, err);
    return [];
  }
}

export async function syncRequestApprovals(
  affected: Cell[],
  approverUserId: string | null,
  opts: { excludeRequestId?: string | null } = {}
): Promise<RequestStatusChange[]> {
  if (affected.length === 0) return [];

  const staffIds = [...new Set(affected.map((c) => c.staffId))];
  const dates = affected.map((c) => c.date);
  const winMin = dates.reduce((m, d) => (d < m ? d : m));
  const winMax = dates.reduce((m, d) => (d > m ? d : m));

  // Only requests of an affected staff whose range overlaps a changed day can
  // have flipped — a request is unaffected if none of its days moved.
  const requests = await prisma.scheduleRequest.findMany({
    where: {
      staffId: { in: staffIds },
      status: { in: ["pending", "approved"] },
      startDate: { lte: new Date(winMax + "T00:00:00Z") },
      endDate: { gte: new Date(winMin + "T00:00:00Z") },
    },
    select: {
      id: true, staffId: true, kind: true, shiftTypeIds: true,
      leaveShiftTypeId: true, startDate: true, endDate: true,
      status: true, autoApproved: true,
    },
  });
  if (requests.length === 0) return [];

  const offShiftIds = new Set(
    (await prisma.shiftType.findMany({ where: { isOffShift: true }, select: { id: true } })).map((s) => s.id)
  );
  const isOff = (id: string) => offShiftIds.has(id);

  // A request is judged over its WHOLE range, which may extend past the changed
  // window — load assignments spanning the union of candidate request ranges.
  const rangeMin = requests.reduce((m, r) => (r.startDate < m ? r.startDate : m), requests[0].startDate);
  const rangeMax = requests.reduce((m, r) => (r.endDate > m ? r.endDate : m), requests[0].endDate);
  const assignments = await prisma.assignment.findMany({
    where: { staffId: { in: staffIds }, date: { gte: rangeMin, lte: rangeMax } },
    select: { staffId: true, date: true, shiftTypeId: true },
  });
  const byStaff = new Map<string, Map<string, string>>();
  for (const a of assignments) {
    let m = byStaff.get(a.staffId);
    if (!m) { m = new Map(); byStaff.set(a.staffId, m); }
    m.set(ymd(a.date), a.shiftTypeId);
  }

  const updates: Promise<unknown>[] = [];
  const changes: RequestStatusChange[] = [];
  for (const r of requests) {
    const dayMap = byStaff.get(r.staffId);
    const satisfied = isRequestSatisfied(
      {
        kind: r.kind as RequestKind,
        shiftTypeIds: r.shiftTypeIds,
        leaveShiftTypeId: r.leaveShiftTypeId,
        startDate: ymd(r.startDate),
        endDate: ymd(r.endDate),
      },
      (date) => dayMap?.get(date) ?? null,
      isOff
    );

    const action = reconcileApprovalAction(r, satisfied, { excludeRequestId: opts.excludeRequestId });
    if (action === "approve") {
      updates.push(prisma.scheduleRequest.update({
        where: { id: r.id },
        data: { status: "approved", autoApproved: true, approvedAt: new Date(), approvedBy: approverUserId },
      }));
      changes.push({ id: r.id, staffId: r.staffId, status: "approved", autoApproved: true });
    } else if (action === "revert") {
      updates.push(prisma.scheduleRequest.update({
        where: { id: r.id },
        data: { status: "pending", autoApproved: false, approvedAt: null, approvedBy: null },
      }));
      changes.push({ id: r.id, staffId: r.staffId, status: "pending", autoApproved: false });
    }
  }
  await Promise.all(updates);
  return changes;
}
