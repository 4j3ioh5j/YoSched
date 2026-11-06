import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, txLog } from "./fake-prisma";
import { DAY_CAP_TX } from "../day-cap-db";

// Card #65, Codex #304 WARNING: approving a request places its shift on every covered
// day — an assignment writer like the grid routes — so it joins their lock protocol:
// locks first, then the read the decision rests on, then the upserts, in one transaction.
// (It does not check the per-day cap itself: card #67 is that decision.)

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./fake-prisma")).prisma }));

import { placeApprovedRequestShift, syncRequestApprovalsAfterCommit } from "../request-sync";

beforeEach(() => {
  db.reset();
  db.shifts = [{ id: "orc", code: "ORC", color: null, isOffShift: false }, { id: "off", code: "OFF", color: null, isOffShift: true }];
});

const request = { staffId: "s1", kind: "REQUEST_SHIFT" as const, shiftTypeIds: ["orc"], leaveShiftTypeId: null, startDate: "2026-11-09", endDate: "2026-11-11" };

describe("placeApprovedRequestShift", () => {
  it("locks the covered dates first, then reads and upserts in the same transaction", async () => {
    const out = await placeApprovedRequestShift(request, "orc");
    expect(out).toEqual({ blocked: [] });
    const log = txLog(1);
    expect(log.slice(0, 3)).toEqual(["lock:2026-11-09", "lock:2026-11-10", "lock:2026-11-11"]);
    expect(log[3]).toBe("assignment.findMany");
    expect(log.filter((l) => l === "assignment.upsert")).toHaveLength(3);
    expect(log[log.length - 1]).toBe("commit");
    expect(db.txOpts[0]).toEqual(DAY_CAP_TX);
    expect(db.log.filter((l) => /^assignment\./.test(l))).toEqual([]);
    expect(db.rows.map((r) => r.source)).toEqual(["request", "request", "request"]);
  });

  it("a locked, unsatisfied day blocks the placement under the lock and nothing is written", async () => {
    db.seed([{ staffId: "s1", date: "2026-11-10", shiftTypeId: "off", isLocked: true }]);
    const out = await placeApprovedRequestShift(request, "orc");
    expect(out).toEqual({ blocked: ["2026-11-10"] });
    expect(db.rows).toHaveLength(1);
    expect(txLog(1)[0]).toBe("lock:2026-11-09");
    expect(txLog(1)).not.toContain("assignment.upsert");
  });

  it("waits for a grid save on one of its days rather than interleaving with it", async () => {
    db.rules = [{ shiftTypeId: "orc", dayKey: "1", maxCount: 1 }];
    // A placement entering while another transaction holds Monday must not read until it commits.
    const { prisma } = await import("./fake-prisma");
    let placement: Promise<{ blocked: string[] }> | null = null;
    db.afterLock = (key, txId) => { if (txId === 1 && key === "2026-11-09" && !placement) placement = placeApprovedRequestShift(request, "orc"); };
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${1}::int, hashtext(${"2026-11-09"}::text))`;
      await tx.assignment.upsert({ where: { staffId_date: { staffId: "s9", date: new Date("2026-11-09T00:00:00Z") } }, update: {}, create: { staffId: "s9", date: new Date("2026-11-09T00:00:00Z"), shiftTypeId: "orc" } });
    });
    await placement!;
    expect(db.log.indexOf("t1:commit")).toBeLessThan(db.log.indexOf("t2:assignment.findMany"));
  });
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
