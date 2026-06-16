import { describe, it, expect } from "vitest";
import { visibleRequestChanges, type RequestStatusChange } from "../request-sync";

// visibleRequestChanges is the pure guard that stops a schedule:edit caller WITHOUT
// requests:view from learning another staff's hidden PENDING request ids via a write
// response. It mirrors isRequestVisibleToViewer and maps to the bare {id,status} the
// client overlay consumes. (syncRequestApprovals itself is prisma-bound, tested via
// its pure decision logic in schedule-requests.test.ts: reconcileApprovalAction.)
describe("visibleRequestChanges", () => {
  const changes: RequestStatusChange[] = [
    { id: "own-pending", staffId: "me", status: "pending" },
    { id: "other-pending", staffId: "them", status: "pending" },
    { id: "own-approved", staffId: "me", status: "approved" },
    { id: "other-approved", staffId: "them", status: "approved" },
  ];

  it("returns everything (as bare id/status) when the viewer can view all requests", () => {
    const out = visibleRequestChanges(changes, { permissions: ["requests:view"], staffId: "me" });
    expect(out).toEqual([
      { id: "own-pending", status: "pending" },
      { id: "other-pending", status: "pending" },
      { id: "own-approved", status: "approved" },
      { id: "other-approved", status: "approved" },
    ]);
    // staffId is stripped — the client overlay only needs id + status.
    expect(out.every((c) => !("staffId" in c))).toBe(true);
  });

  it("hides OTHER staff's pending changes from a viewer without requests:view", () => {
    const out = visibleRequestChanges(changes, { permissions: ["schedule:edit"], staffId: "me" });
    const ids = out.map((c) => c.id);
    // Own (any status) + everyone's approved are visible; others' pending is hidden.
    expect(ids).toEqual(["own-pending", "own-approved", "other-approved"]);
    expect(ids).not.toContain("other-pending");
  });

  it("with no linked staff and no requests:view, only approved changes survive", () => {
    const out = visibleRequestChanges(changes, { permissions: ["schedule:edit"], staffId: null });
    expect(out.map((c) => c.id)).toEqual(["own-approved", "other-approved"]);
  });

  it("returns an empty array for no changes", () => {
    expect(visibleRequestChanges([], { permissions: ["requests:view"], staffId: "me" })).toEqual([]);
  });
});
