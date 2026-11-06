// The authoritative post-change state of everything a request status change can touch:
// the visible (pending/approved) requests of the touched staff overlapping the touched
// cells — which includes any co-approved/reverted NEIGHBOUR requests — and the current
// assignment on each touched cell. The client replaces its local state for this window
// so co-approval cascades, placement and (card #67) the ripple onto other staff are
// always reflected exactly, and undo/redo (which PATCH back) get the inverse window the
// same way. Shared by PATCH /api/requests/[id] and PUT /api/requests/[id]/restore.
import { prisma } from "@/lib/prisma";
import { resolveUpdaterNames } from "@/lib/assignment-attribution";
import { isRequestVisibleToViewer } from "@/lib/schedule-requests";

export type AffectedCell = { staffId: string; date: string }; // date = "YYYY-MM-DD"
/** The authenticated caller: the same visibility rule the schedule page and every assignment
 *  write apply (`visibleRequestChanges`) — without `requests:view` another staff's PENDING
 *  request (its id, its flagged reason) must not leak through a write response (review #328). */
export type AffectedViewer = { permissions: readonly string[]; staffId: string | null };

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const at = (d: string) => new Date(d + "T00:00:00Z");

/** The engine's soft warnings for the viewer. They are free text that can name another staff's
 *  PENDING request ("… conflicts with CD's pending OFF"), so a caller without `requests:view`
 *  gets none of them (review #330): the saved grid is unaffected, only the advisory text is. */
export function visibleWarnings(warnings: readonly string[], viewer: AffectedViewer): string[] {
  return viewer.permissions.includes("requests:view") ? [...warnings] : [];
}

/** Cells deduplicated by (staffId, date), in input order. */
export function uniqueCells(cells: readonly AffectedCell[]): AffectedCell[] {
  const seen = new Set<string>();
  const out: AffectedCell[] = [];
  for (const c of cells) {
    const k = `${c.staffId}:${c.date}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ staffId: c.staffId, date: c.date });
  }
  return out;
}

export async function affectedWindow(cellsIn: readonly AffectedCell[], viewer: AffectedViewer) {
  const cells = uniqueCells(cellsIn);
  if (cells.length === 0) return { requests: [], cells: [] };
  const staffIds = [...new Set(cells.map((c) => c.staffId))];
  const dates = [...new Set(cells.map((c) => c.date))].sort();
  const canViewAll = viewer.permissions.includes("requests:view");
  const [requestRows, assignments] = await Promise.all([
    prisma.scheduleRequest.findMany({
      where: {
        staffId: { in: staffIds },
        status: { in: ["pending", "approved"] },
        startDate: { lte: at(dates[dates.length - 1]) },
        endDate: { gte: at(dates[0]) },
      },
      // autoApproved is what the client overlay needs to label Auto- vs
      // Manually-approved; approvedBy/approvedAt drive the "by <name> (<date>)";
      // flaggedReason is the "needs resolving" sentence (card #67).
      select: { id: true, staffId: true, status: true, autoApproved: true, approvedBy: true, approvedAt: true, flaggedReason: true },
    }),
    prisma.assignment.findMany({
      where: { staffId: { in: staffIds }, date: { in: dates.map(at) } },
      select: { id: true, staffId: true, date: true, shiftTypeId: true, isLocked: true },
    }),
  ]);
  const requests = requestRows.filter((r) => isRequestVisibleToViewer(r, { canViewAll, viewerStaffId: viewer.staffId }));
  const byKey = new Map(assignments.map((a) => [`${a.staffId}:${ymd(a.date)}`, a]));
  // These routes are schedule:edit-only, so the caller is always allowed approver
  // names (NAME only — same gating the /requests page applies to viewers).
  const approverNames = await resolveUpdaterNames(requests.map((r) => r.approvedBy));
  return {
    requests: requests.map((r) => ({
      id: r.id,
      status: r.status,
      autoApproved: r.autoApproved,
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
      approvedByName: r.approvedBy ? approverNames.get(r.approvedBy) ?? "Unknown" : null,
      flaggedReason: r.flaggedReason ?? null,
    })),
    cells: cells.map((c) => {
      const a = byKey.get(`${c.staffId}:${c.date}`);
      return {
        staffId: c.staffId,
        date: c.date,
        assignment: a ? { id: a.id, shiftTypeId: a.shiftTypeId, isLocked: a.isLocked } : null,
      };
    }),
  };
}
