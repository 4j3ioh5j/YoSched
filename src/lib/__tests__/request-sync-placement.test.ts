import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "./fake-prisma";

// The approve→assign placement moved to src/lib/request-approval-resolve.ts (card #67);
// its lock protocol and outcomes are covered in request-approval-resolve.test.ts. What
// stays here is the after-commit sync wrapper the routes call once the placement is saved.

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./fake-prisma")).prisma }));

import { syncRequestApprovalsAfterCommit, syncRequestApprovals } from "../request-sync";

beforeEach(() => {
  db.reset();
  db.shifts = [{ id: "orc", code: "ORC", color: null, isOffShift: false }, { id: "off", code: "OFF", color: null, isOffShift: true }];
});

describe("syncRequestApprovalsAfterCommit", () => {
  it("returns no changes and logs under the label when the sync throws; returns the sync's result otherwise", async () => {
    expect(await syncRequestApprovalsAfterCommit("x", [{ staffId: "s1", date: "2026-11-09" }], "u1")).toEqual([]);
    db.requestSyncThrows = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await syncRequestApprovalsAfterCommit("my route", [{ staffId: "s1", date: "2026-11-09" }], "u1")).toEqual([]);
    expect(spy).toHaveBeenCalledWith("my route: request-approval sync failed after commit (assignments persisted)", expect.any(Error));
    spy.mockRestore();
  });
});

describe("syncRequestApprovals — the flag clears with an auto-approval (card #67)", () => {
  it("a flagged pending request that becomes satisfied is approved with its flag cleared", async () => {
    db.seedRequest({ id: "r1", staffId: "s1", startDate: "2026-11-09", endDate: "2026-11-09", kind: "REQUEST_SHIFT", shiftTypeIds: ["orc"], flaggedAt: new Date(), flaggedReason: "Mon 11/9 already has its 1 ORC" });
    db.seed([{ staffId: "s1", date: "2026-11-09", shiftTypeId: "orc", source: "manual" }]);
    const changes = await syncRequestApprovals([{ staffId: "s1", date: "2026-11-09" }], "u1");
    expect(changes).toEqual([{ id: "r1", staffId: "s1", status: "approved", autoApproved: true }]);
    expect(db.requests[0]).toMatchObject({ status: "approved", autoApproved: true, flaggedAt: null, flaggedReason: null });
  });
});
