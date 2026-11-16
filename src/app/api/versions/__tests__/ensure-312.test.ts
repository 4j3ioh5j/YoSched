import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db, txLog } from "@/lib/__tests__/fake-prisma";
import { dateKeysBetween, DAY_CAP_TX } from "@/lib/day-cap-db";
import { hashSnapshot } from "@/lib/versions";

// Card #312: Print and Export call POST /api/versions/ensure first. For each month it
// saves a new version when the month has none (a blank month → Version 1) or its cells
// changed since the current one; an unchanged month keeps its version. The server must
// still see the cells the browser printed (expectedHash), else it saves nothing (409).

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/__tests__/fake-prisma")).prisma }));
const auth = { allowed: true, asked: [] as unknown[] };
vi.mock("@/lib/auth-guard", () => ({
  getSession: async (perm: unknown) => {
    auth.asked.push(perm);
    return auth.allowed
      ? { error: null, userId: "u1", permissions: ["schedule:edit"], staffId: null, session: { user: { id: "u1" } } }
      : { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), session: null };
  },
}));

import { POST as ensure } from "../ensure/route";
import { POST as saveVersion } from "../route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const NOV = dateKeysBetween(new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 11, 1)));
const DEC = dateKeysBetween(new Date(Date.UTC(2026, 11, 1)), new Date(Date.UTC(2027, 0, 1)));
const h = (cells: { staffId: string; date: string; shiftTypeId: string; isLocked?: boolean }[]) =>
  hashSnapshot(cells.map((c) => ({ ...c, isLocked: c.isLocked ?? false })));
const NOV_CELLS = [{ staffId: "s1", date: "2026-11-09", shiftTypeId: "orc" }];

beforeEach(() => {
  db.reset();
  auth.allowed = true;
  auth.asked = [];
  db.seed(NOV_CELLS);
});

describe("POST /api/versions/ensure (card #312)", () => {
  it("needs schedule:edit", async () => {
    auth.allowed = false;
    const res = await ensure(req({ kind: "print", comment: "Auto", months: [{ year: 2026, month: 10, expectedHash: h(NOV_CELLS) }] }));
    expect(res.status).toBe(403);
    expect(auth.asked).toEqual(["schedule:edit"]);
    expect(db.versions).toEqual([]);
  });

  it("a month with no version gets Version 1, current, with the comment and the server's snapshot", async () => {
    const res = await ensure(req({ kind: "print", comment: "Auto: printed 2026-11-16 14:05", months: [{ year: 2026, month: 10, expectedHash: h(NOV_CELLS) }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(db.versions).toHaveLength(1);
    const v = db.versions[0];
    expect(v).toMatchObject({ year: 2026, month: 10, versionNumber: 1, isCurrent: true, isAutoBackup: false, comment: "Auto: printed 2026-11-16 14:05", snapshotHash: h(NOV_CELLS) });
    expect(body.versions).toEqual([expect.objectContaining({ year: 2026, month: 10, versionNumber: 1, snapshotHash: h(NOV_CELLS) })]);
    expect(body.created).toEqual([{ year: 2026, month: 10 }]);
  });

  it("a blank month with no version gets Version 1 too", async () => {
    const res = await ensure(req({ kind: "print", comment: "Auto", months: [{ year: 2026, month: 11, expectedHash: hashSnapshot([]) }] }));
    expect(res.status).toBe(200);
    expect(db.versions).toEqual([expect.objectContaining({ year: 2026, month: 11, versionNumber: 1, isCurrent: true, snapshot: [] })]);
  });

  it("an unchanged month keeps its current version: nothing is created", async () => {
    db.versions = [{ id: "v3", year: 2026, month: 10, versionNumber: 3, comment: null, snapshot: [], snapshotHash: h(NOV_CELLS), isAutoBackup: false, isCurrent: true, createdAt: new Date() }];
    const res = await ensure(req({ kind: "print", comment: "Auto", months: [{ year: 2026, month: 10, expectedHash: h(NOV_CELLS) }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(db.versions).toHaveLength(1);
    expect(body.created).toEqual([]);
    expect(body.versions).toEqual([expect.objectContaining({ id: "v3", versionNumber: 3 })]);
  });

  it("a changed month gets the next number and becomes the only current version", async () => {
    db.versions = [
      { id: "v1", year: 2026, month: 10, versionNumber: 1, comment: null, snapshot: [], snapshotHash: "old", isAutoBackup: false, isCurrent: false, createdAt: new Date() },
      { id: "v2", year: 2026, month: 10, versionNumber: 2, comment: null, snapshot: [], snapshotHash: "older", isAutoBackup: true, isCurrent: false, createdAt: new Date() },
      { id: "v4", year: 2026, month: 10, versionNumber: 4, comment: null, snapshot: [], snapshotHash: "stale", isAutoBackup: false, isCurrent: true, createdAt: new Date() },
    ];
    const res = await ensure(req({ kind: "print", comment: "Auto", months: [{ year: 2026, month: 10, expectedHash: h(NOV_CELLS) }] }));
    expect(res.status).toBe(200);
    expect(db.versions.filter((v) => v.isCurrent).map((v) => v.versionNumber)).toEqual([5]);
  });

  it("locks every date of every month BEFORE reading any cell, all in one transaction", async () => {
    const res = await ensure(req({ kind: "export", comment: "Auto", months: [
      { year: 2026, month: 10, expectedHash: h(NOV_CELLS) },
      { year: 2026, month: 11, expectedHash: hashSnapshot([]) },
    ] }));
    expect(res.status).toBe(200);
    const log = txLog(1);
    const locks = [...NOV, ...DEC].map((d) => `lock:${d}`).sort();
    expect(log.slice(0, locks.length)).toEqual(locks);
    expect(log[locks.length]).toBe("assignment.findMany");
    expect(log[log.length - 1]).toBe("commit");
    expect(db.txOpts[0]).toEqual(DAY_CAP_TX);
  });

  it("if ANY month differs from what the browser printed, nothing is saved and the stale months come back (409)", async () => {
    db.versions = [{ id: "v1", year: 2026, month: 11, versionNumber: 1, comment: null, snapshot: [], snapshotHash: "x", isAutoBackup: false, isCurrent: true, createdAt: new Date() }];
    const res = await ensure(req({ kind: "export", comment: "Auto", months: [
      { year: 2026, month: 11, expectedHash: hashSnapshot([]) }, // fine on its own: would be saved
      { year: 2026, month: 10, expectedHash: hashSnapshot([]) }, // the server has an ORC the browser didn't see
    ] }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.stale).toEqual([{ year: 2026, month: 10 }]);
    expect(db.versions).toHaveLength(1);
    expect(db.versions[0]).toMatchObject({ id: "v1", isCurrent: true });
  });

  it("a lock flip counts as a change (same rule as the unsaved-edits star)", async () => {
    const res = await ensure(req({ kind: "print", comment: "Auto", months: [{ year: 2026, month: 10, expectedHash: h([{ ...NOV_CELLS[0], isLocked: true }]) }] }));
    expect(res.status).toBe(409);
  });

  it.each([
    [{}],
    [{ kind: "print", comment: "Auto", months: [] }],
    [{ kind: "print", comment: "Auto", months: Array.from({ length: 13 }, (_, i) => ({ year: 2026 + Math.floor(i / 12), month: i % 12, expectedHash: "h" })) }],
    [{ kind: "print", comment: "Auto", months: [{ year: 2026, month: 12, expectedHash: "h" }] }],
    [{ kind: "print", comment: "Auto", months: [{ year: 2026.5, month: 1, expectedHash: "h" }] }],
    [{ kind: "print", comment: "Auto", months: [{ year: 2026, month: 1 }] }],
    [{ kind: "print", comment: "Auto", months: [{ year: 2026, month: 1, expectedHash: "h" }, { year: 2026, month: 1, expectedHash: "h" }] }],
    [{ kind: "nope", comment: "Auto", months: [{ year: 2026, month: 1, expectedHash: "h" }] }],
    [{ kind: "print", comment: "x".repeat(201), months: [{ year: 2026, month: 1, expectedHash: "h" }] }],
  ])("rejects a bad body without writing: %j", async (body) => {
    const res = await ensure(req(body));
    expect(res.status).toBe(400);
    expect(db.versions).toEqual([]);
    expect(db.txSeq).toBe(0);
  });

  it("a lock wait that times out answers busy, saving nothing", async () => {
    db.failTxWith = Object.assign(new Error("Transaction already closed"), { code: "P2028" });
    const res = await ensure(req({ kind: "print", comment: "Auto", months: [{ year: 2026, month: 10, expectedHash: h(NOV_CELLS) }] }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("busy");
    expect(db.versions).toEqual([]);
  });
});

describe("POST /api/versions (manual Save) now snapshots under the month's locks (card #312)", () => {
  it("locks every date of the month before reading it, in one transaction", async () => {
    const res = await saveVersion(req({ year: 2026, month: 10, comment: "mine" }));
    expect(res.status).toBe(200);
    const log = txLog(1);
    expect(log.slice(0, NOV.length)).toEqual(NOV.map((d) => `lock:${d}`));
    expect(log[NOV.length]).toBe("assignment.findMany");
    expect(db.versions).toEqual([expect.objectContaining({ versionNumber: 1, isCurrent: true, comment: "mine", snapshotHash: h(NOV_CELLS) })]);
  });
});
