// Keeps request approval state in sync with the schedule. Whenever assignments
// change, a request is auto-approved once every day it covers has a satisfying
// assignment, and an auto-approval is reverted to pending if that stops being
// true. This is the assign→approve direction; the requests route handles the
// approve→assign direction. Satisfaction rules live in schedule-requests.ts.
import { prisma } from "./prisma";
import { isRequestSatisfied, reconcileApprovalAction, type RequestKind } from "./schedule-requests";

type Cell = { providerId: string; date: string }; // date = "YYYY-MM-DD"

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
 */
export async function syncRequestApprovals(
  affected: Cell[],
  approverUserId: string | null,
  opts: { excludeRequestId?: string | null } = {}
): Promise<void> {
  if (affected.length === 0) return;

  const providerIds = [...new Set(affected.map((c) => c.providerId))];
  const dates = affected.map((c) => c.date);
  const winMin = dates.reduce((m, d) => (d < m ? d : m));
  const winMax = dates.reduce((m, d) => (d > m ? d : m));

  // Only requests of an affected provider whose range overlaps a changed day can
  // have flipped — a request is unaffected if none of its days moved.
  const requests = await prisma.scheduleRequest.findMany({
    where: {
      providerId: { in: providerIds },
      status: { in: ["pending", "approved"] },
      startDate: { lte: new Date(winMax + "T00:00:00Z") },
      endDate: { gte: new Date(winMin + "T00:00:00Z") },
    },
    select: {
      id: true, providerId: true, kind: true, shiftTypeIds: true,
      leaveShiftTypeId: true, startDate: true, endDate: true,
      status: true, autoApproved: true,
    },
  });
  if (requests.length === 0) return;

  const offShiftIds = new Set(
    (await prisma.shiftType.findMany({ where: { isOffShift: true }, select: { id: true } })).map((s) => s.id)
  );
  const isOff = (id: string) => offShiftIds.has(id);

  // A request is judged over its WHOLE range, which may extend past the changed
  // window — load assignments spanning the union of candidate request ranges.
  const rangeMin = requests.reduce((m, r) => (r.startDate < m ? r.startDate : m), requests[0].startDate);
  const rangeMax = requests.reduce((m, r) => (r.endDate > m ? r.endDate : m), requests[0].endDate);
  const assignments = await prisma.assignment.findMany({
    where: { providerId: { in: providerIds }, date: { gte: rangeMin, lte: rangeMax } },
    select: { providerId: true, date: true, shiftTypeId: true },
  });
  const byProvider = new Map<string, Map<string, string>>();
  for (const a of assignments) {
    let m = byProvider.get(a.providerId);
    if (!m) { m = new Map(); byProvider.set(a.providerId, m); }
    m.set(ymd(a.date), a.shiftTypeId);
  }

  const updates: Promise<unknown>[] = [];
  for (const r of requests) {
    const dayMap = byProvider.get(r.providerId);
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
    } else if (action === "revert") {
      updates.push(prisma.scheduleRequest.update({
        where: { id: r.id },
        data: { status: "pending", autoApproved: false, approvedAt: null, approvedBy: null },
      }));
    }
  }
  await Promise.all(updates);
}
