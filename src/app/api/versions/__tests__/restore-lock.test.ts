import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db, txLog, ymd, type FakeVersion } from "@/lib/__tests__/fake-prisma";
import { dateKeysBetween, DAY_CAP_TX } from "@/lib/day-cap-db";

// Card #65, Codex #304 CRITICAL: version restore reads a month for its auto-backup, then
// deletes and recreates the month. Without the per-date locks a save committed between
// that read and the delete was erased AND missing from the backup. The restore now locks
// every date of the month before the backup read, so a save either committed before
// (and is in the backup) or waits and lands on the restored month.

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/__tests__/fake-prisma")).prisma }));
vi.mock("@/lib/auth-guard", () => ({
  getSession: async () => ({ error: null, userId: "u1", permissions: ["schedule:edit"], staffId: null, session: { user: { id: "u1" } } }),
}));

import { POST as restore } from "../[id]/restore/route";
import { PUT as putOne } from "../../assignments/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const MON = "2026-11-09";
const NOV = dateKeysBetween(new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 11, 1)));

beforeEach(() => {
  db.reset();
  db.shifts = [{ id: "orc", code: "ORC", color: "#f00", isOffShift: false }, { id: "free", code: "FREE", color: null, isOffShift: false }];
  db.rules = [{ shiftTypeId: "orc", dayKey: "1", maxCount: 1 }];
  db.versions = [{
    id: "v1", year: 2026, month: 10, versionNumber: 1, comment: "saved", isAutoBackup: false, isCurrent: false, createdAt: new Date(),
    snapshotHash: "h", snapshot: [{ staffId: "s7", date: "2026-11-03", shiftTypeId: "free", isLocked: false, source: "manual", notes: null }],
  }];
});

const backup = (): FakeVersion | undefined => db.versions.find((v) => v.isAutoBackup);

describe("POST /api/versions/[id]/restore", () => {
  it("locks every date of the month, in order, BEFORE the backup read; everything else follows in the same transaction", async () => {
    db.seed([{ staffId: "s1", date: MON, shiftTypeId: "orc" }]);
    const res = await restore(req({}), ctx("v1"));
    expect(res.status).toBe(200);
    const log = txLog(1);
    expect(log.slice(0, 30)).toEqual(NOV.map((d) => `lock:${d}`));
    expect(log[30]).toBe("assignment.findMany"); // the backup read, only after the last lock
    expect(log).toContain("assignment.deleteMany");
    expect(log).toContain("assignment.createMany");
    expect(log[log.length - 1]).toBe("commit");
    expect(db.txOpts[0]).toEqual(DAY_CAP_TX);
    expect(backup()!.snapshot).toEqual([{ staffId: "s1", date: MON, shiftTypeId: "orc", isLocked: false, source: "manual", notes: null }]);
    expect(db.rows.map((r) => `${r.staffId}:${ymd(r.date)}`)).toEqual(["s7:2026-11-03"]);
  });

  it("a save that enters while the restore holds the month waits, and lands on the restored month", async () => {
    let save: Promise<Response> | null = null;
    db.afterLock = (key, txId) => {
      // The restore (tx 1) has locked Monday; a user saves an ORC on Monday right now.
      if (txId === 1 && key === MON && !save) save = putOne(req({ staffId: "s1", date: MON, shiftTypeId: "orc" }));
    };
    const res = await restore(req({}), ctx("v1"));
    expect(res.status).toBe(200);
    const saved = await save!;
    expect(saved.status).toBe(200);
    // The save was not in the backup (it had not committed), and it is NOT lost: it is on
    // the restored month, written after the restore committed.
    expect(backup()!.snapshot).toEqual([]);
    expect(db.holders("orc", MON)).toEqual(["s1"]);
    expect(db.log.indexOf("t1:commit")).toBeLessThan(db.log.indexOf("t2:assignment.findUnique"));
  });

  it("a save that committed before the restore began is in the backup (and replaced knowingly)", async () => {
    const saved = await putOne(req({ staffId: "s1", date: MON, shiftTypeId: "orc" }));
    expect(saved.status).toBe(200);
    const res = await restore(req({}), ctx("v1"));
    expect(res.status).toBe(200);
    expect(backup()!.snapshot).toEqual([{ staffId: "s1", date: MON, shiftTypeId: "orc", isLocked: false, source: "manual", notes: null }]);
    expect(db.holders("orc", MON)).toEqual([]); // the restored month wins; the backup keeps the save
  });

  it("without the locks the concurrent save is erased and absent from the backup (the bug)", async () => {
    db.lockEnabled = false;
    let save: Promise<Response> | null = null;
    db.afterLock = (key, txId) => {
      // Fired a few statements before the restore's backup read so that the save's
      // upsert lands between that read and the month delete — the production race.
      if (txId === 1 && key === "2026-11-28" && !save) save = putOne(req({ staffId: "s1", date: MON, shiftTypeId: "orc" }));
    };
    const res = await restore(req({}), ctx("v1"));
    expect(res.status).toBe(200);
    expect((await save!).status).toBe(200);
    expect(backup()!.snapshot).toEqual([]);
    expect(db.holders("orc", MON)).toEqual([]); // saved, reported 200, gone — unrecoverable
  });

  it("a timed-out wait is a 409 busy with nothing restored", async () => {
    db.seed([{ staffId: "s1", date: MON, shiftTypeId: "orc" }]);
    db.failTxWith = Object.assign(new Error("timeout"), { code: "P2028" });
    const res = await restore(req({}), ctx("v1"));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("busy");
    expect(db.holders("orc", MON)).toEqual(["s1"]);
    expect(backup()).toBeUndefined();
  });

  it("a request-approval sync failure after the commit still reports the restore", async () => {
    db.seed([{ staffId: "s1", date: MON, shiftTypeId: "orc" }]);
    db.requestSyncThrows = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await restore(req({}), ctx("v1"));
    expect(res.status).toBe(200);
    expect((await res.json()).version.id).toBe("v1");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("versions restore: request-approval sync failed after commit"), expect.any(Error));
    spy.mockRestore();
  });
});
