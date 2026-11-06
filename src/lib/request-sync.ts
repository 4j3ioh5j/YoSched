// Keeps request approval state in sync with the schedule. Whenever assignments
// change, a request is auto-approved once every day it covers has a satisfying
// assignment, and an auto-approval is reverted to pending if that stops being
// true. This is the assign→approve direction; the requests route handles the
// approve→assign direction. Satisfaction rules live in schedule-requests.ts.
// The approve→assign direction (placing an approved request's shift) lives in
// src/lib/request-approval-resolve.ts since card #67: it re-arranges the grid legally
// or flags the request, under the same day locks.
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { isRequestSatisfied, reconcileApprovalAction, isRequestVisibleToViewer, type RequestKind } from "./schedule-requests";

type Cell = { staffId: string; date: string }; // date = "YYYY-MM-DD"

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

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
        // A satisfied request is no longer "needs resolving" (card #67): the flag clears with the approval.
        data: { status: "approved", autoApproved: true, approvedAt: new Date(), approvedBy: approverUserId, flaggedAt: null, flaggedReason: null, approvalRipple: Prisma.DbNull },
      }));
      changes.push({ id: r.id, staffId: r.staffId, status: "approved", autoApproved: true });
    } else if (action === "revert") {
      updates.push(prisma.scheduleRequest.update({
        where: { id: r.id },
        data: { status: "pending", autoApproved: false, approvedAt: null, approvedBy: null, approvalRipple: Prisma.DbNull }, // card #70: the Undo record dies with the approval
      }));
      changes.push({ id: r.id, staffId: r.staffId, status: "pending", autoApproved: false });
    }
  }
  await Promise.all(updates);
  return changes;
}
