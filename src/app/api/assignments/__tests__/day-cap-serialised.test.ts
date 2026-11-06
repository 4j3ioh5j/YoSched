import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db, txLog, at, type FakeRow } from "@/lib/__tests__/fake-prisma";
import { DAY_CAP_TX } from "@/lib/day-cap-db";

// Card #65 (Codex #292 WARNING 1): two simultaneous saves could both pass the per-day
// cap check and overfill a day. Every assignment writer now takes the touched dates'
// advisory locks FIRST and reads + writes inside that one transaction. The fake
// database models the lock as a real per-key mutex and yields between statements,
// so the unprotected race reproduces here (see "would overfill without the lock").

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/__tests__/fake-prisma")).prisma }));
vi.mock("@/lib/auth-guard", () => ({
  getSession: async () => ({ error: null, userId: "u1", permissions: ["schedule:edit", "schedule:auto", "requests:view"], staffId: null, session: { user: { id: "u1" } } }),
}));

import { PUT as putOne, POST as postSwap, DELETE as deleteOne } from "../route";
import { PUT as putBulk, DELETE as deleteBulk } from "../bulk/route";
import { POST as postDedicated } from "../dedicated-entry/route";
import { PUT as putPaste } from "../paste/route";
import { PUT as putRosterPaste } from "../roster-paste/route";
import { PUT as putAutoAccept, DELETE as deleteAuto } from "../../auto-schedule/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const MON = "2026-11-09"; // a Monday: ORC is capped at 1 on weekday "1"
const TUE = "2026-11-10"; // no rule → no cap

beforeEach(() => {
  db.reset();
  db.shifts = [
    { id: "orc", code: "ORC", color: "#f00", isOffShift: false },
    { id: "free", code: "FREE", color: null, isOffShift: false },
  ];
  db.rules = [{ shiftTypeId: "orc", dayKey: "1", maxCount: 1 }];
});

/** The transaction's statements must start with the lock(s) and then hold every read the
 *  decision rests on and every write — nothing about the grid read or written outside it. */
function expectLockedTx(txId: number, dates: string[], opts: { reads: RegExp; writes: RegExp }) {
  const log = txLog(txId);
  const locks = log.filter((l) => l.startsWith("lock:"));
  expect(locks).toEqual(dates.map((d) => `lock:${d}`));
  expect(log.slice(0, locks.length)).toEqual(locks); // the locks come first
  expect(log.some((l) => opts.reads.test(l))).toBe(true);
  expect(log.some((l) => opts.writes.test(l))).toBe(true);
  expect(log[log.length - 1]).toBe("commit");
  // Nothing touched the assignment table outside the transaction.
  expect(db.log.filter((l) => /^assignment\./.test(l))).toEqual([]);
  expect(db.txOpts[db.txOpts.length - 1]).toEqual(DAY_CAP_TX);
}

describe("PUT /api/assignments (one cell)", () => {
  it("locks the date, then counts and writes in the same transaction", async () => {
    const res = await putOne(req({ staffId: "s1", date: MON, shiftTypeId: "orc" }));
    expect(res.status).toBe(200);
    expectLockedTx(1, [MON], { reads: /assignment\.(findUnique|count)/, writes: /assignment\.upsert/ });
    expect(db.holders("orc", MON)).toEqual(["s1"]);
    expect((await res.json()).updatedByName).toBe("Pat");
  });

  it("refuses the second ORC on a Max-1 day with the day-full 409 and writes nothing", async () => {
    db.seed([{ staffId: "s1", date: MON, shiftTypeId: "orc" }]);
    const res = await putOne(req({ staffId: "s2", date: MON, shiftTypeId: "orc" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "day-full", code: "ORC", maxPerDay: 1, date: MON, error: "Only 1 ORC allowed on Mondays" });
    expect(db.holders("orc", MON)).toEqual(["s1"]);
    expect(txLog(1)[txLog(1).length - 1]).toBe("rollback");
  });

  it("keeps the locked-cell refusal (400) under the lock", async () => {
    db.seed([{ staffId: "s1", date: MON, shiftTypeId: "free", isLocked: true }]);
    const res = await putOne(req({ staffId: "s1", date: MON, shiftTypeId: "orc" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Cannot modify locked assignment" });
    expect(txLog(1)[0]).toBe(`lock:${MON}`);
  });

  it("two simultaneous saves onto one Max-1 day: exactly one lands (the Codex repro)", async () => {
    const [a, b] = await Promise.all([
      putOne(req({ staffId: "s1", date: MON, shiftTypeId: "orc" })),
      putOne(req({ staffId: "s2", date: MON, shiftTypeId: "orc" })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(db.holders("orc", MON)).toHaveLength(1);
    const refused = a.status === 409 ? a : b;
    expect((await refused.json()).reason).toBe("day-full");
  });

  it("would overfill without the lock — proves the race test bites", async () => {
    db.lockEnabled = false;
    const [a, b] = await Promise.all([
      putOne(req({ staffId: "s1", date: MON, shiftTypeId: "orc" })),
      putOne(req({ staffId: "s2", date: MON, shiftTypeId: "orc" })),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(db.holders("orc", MON)).toEqual(["s1", "s2"]); // the bug card #65 fixes
  });

  it("saves on different dates do not wait for each other", async () => {
    db.rules.push({ shiftTypeId: "orc", dayKey: "2", maxCount: 1 });
    const [a, b] = await Promise.all([
      putOne(req({ staffId: "s1", date: MON, shiftTypeId: "orc" })),
      putOne(req({ staffId: "s2", date: TUE, shiftTypeId: "orc" })),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    // Both transactions were open at once: the second's lock was taken before the first committed.
    const firstCommit = db.log.findIndex((l) => l.endsWith(":commit"));
    const secondLock = db.log.findIndex((l) => l === `t2:lock:${TUE}`);
    expect(secondLock).toBeLessThan(firstCommit);
  });

  it("a transaction that times out waiting is a 409 busy, not a 500, and nothing is written", async () => {
    db.failTxWith = Object.assign(new Error("Transaction already closed"), { code: "P2028" });
    const res = await putOne(req({ staffId: "s1", date: MON, shiftTypeId: "orc" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Another edit on that day is still saving — try again", reason: "busy" });
    expect(db.rows).toEqual([]);
  });

  it("a request-approval sync failure after the commit still reports the saved cell", async () => {
    db.requestSyncThrows = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await putOne(req({ staffId: "s1", date: MON, shiftTypeId: "orc" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staffId).toBe("s1");
    expect(body.requestChanges).toEqual([]);
    expect(db.holders("orc", MON)).toEqual(["s1"]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("assignments PUT: request-approval sync failed after commit"), expect.any(Error));
    spy.mockRestore();
  });
});

describe("POST /api/assignments swap", () => {
  it("locks both dates (sorted) before reading either cell, and rewrites under them", async () => {
    db.seed([{ staffId: "s1", date: TUE, shiftTypeId: "orc" }]);
    const res = await postSwap(req({ action: "swap", from: { staffId: "s1", date: TUE }, to: { staffId: "s2", date: MON } }));
    expect(res.status).toBe(200);
    expectLockedTx(1, [MON, TUE], { reads: /assignment\.findUnique/, writes: /assignment\.(delete|create)/ });
    expect(db.holders("orc", MON)).toEqual(["s2"]);
    expect(db.holders("orc", TUE)).toEqual([]);
  });

  it("refuses a move onto a full day under the lock and keeps both cells", async () => {
    db.seed([{ staffId: "s1", date: TUE, shiftTypeId: "orc" }, { staffId: "s3", date: MON, shiftTypeId: "orc" }]);
    const res = await postSwap(req({ action: "swap", from: { staffId: "s1", date: TUE }, to: { staffId: "s2", date: MON } }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("day-full");
    expect(db.holders("orc", TUE)).toEqual(["s1"]);
    expect(db.holders("orc", MON)).toEqual(["s3"]);
  });

  it("missing source and locked cells keep their 404 / 400", async () => {
    expect((await postSwap(req({ action: "swap", from: { staffId: "s1", date: TUE }, to: { staffId: "s2", date: MON } }))).status).toBe(404);
    db.seed([{ staffId: "s1", date: TUE, shiftTypeId: "orc", isLocked: true }]);
    expect((await postSwap(req({ action: "swap", from: { staffId: "s1", date: TUE }, to: { staffId: "s2", date: MON } }))).status).toBe(400);
  });
});

describe("PUT /api/assignments/bulk", () => {
  it("locks every date first and writes the batch in one transaction", async () => {
    const res = await putBulk(req({ cells: [{ staffId: "s1", date: TUE }, { staffId: "s1", date: MON }], shiftTypeId: "orc" }));
    expect(res.status).toBe(200);
    expectLockedTx(1, [MON, TUE], { reads: /assignment\.findMany/, writes: /assignment\.upsert/ });
    expect((await res.json()).applied).toHaveLength(2);
  });

  it("refuses the whole batch when a selection would overfill a day, writing nothing", async () => {
    const res = await putBulk(req({ cells: [{ staffId: "s1", date: MON }, { staffId: "s2", date: MON }], shiftTypeId: "orc" }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("day-full");
    expect(db.rows).toEqual([]);
  });

  it("still skips locked cells (not a failure) inside the transaction", async () => {
    db.seed([{ staffId: "s1", date: TUE, shiftTypeId: "free", isLocked: true }]);
    const res = await putBulk(req({ cells: [{ staffId: "s1", date: TUE }, { staffId: "s2", date: TUE }], shiftTypeId: "orc" }));
    const body = await res.json();
    expect(body.skipped).toEqual([{ staffId: "s1", date: TUE, reason: "locked" }]);
    expect(body.applied.map((a: FakeRow) => a.staffId)).toEqual(["s2"]);
  });
});

describe("POST /api/assignments/dedicated-entry", () => {
  it("locks the date, reads the roster under it, and writes in the same transaction", async () => {
    db.seed([{ staffId: "s1", date: MON, shiftTypeId: "orc" }]);
    const res = await postDedicated(req({ shiftTypeId: "orc", date: MON, addStaffIds: ["s2"], removeStaffIds: ["s1"] }));
    expect(res.status).toBe(200);
    expectLockedTx(1, [MON], { reads: /assignment\.findMany/, writes: /assignment\.(upsert|deleteMany)/ });
    expect(db.holders("orc", MON)).toEqual(["s2"]);
  });

  it("refuses a resulting roster over the cap and the locked 409 under the lock", async () => {
    db.seed([{ staffId: "s1", date: MON, shiftTypeId: "orc" }]);
    const over = await postDedicated(req({ shiftTypeId: "orc", date: MON, addStaffIds: ["s2"], removeStaffIds: [] }));
    expect(over.status).toBe(409);
    expect((await over.json()).reason).toBe("day-full");
    expect(db.holders("orc", MON)).toEqual(["s1"]);

    db.rows[0].isLocked = true;
    const locked = await postDedicated(req({ shiftTypeId: "orc", date: MON, addStaffIds: [], removeStaffIds: ["s1"] }));
    expect(locked.status).toBe(409);
    expect(await locked.json()).toEqual({ error: "Cannot modify locked assignment", reason: "locked", staffId: "s1" });
  });
});

describe("PUT /api/assignments/paste", () => {
  it("keeps its skip semantics: the over-cap cell is dropped, the rest written, all under the lock", async () => {
    const res = await putPaste(req({ cells: [
      { staffId: "s1", date: MON, shiftTypeId: "orc" },
      { staffId: "s2", date: MON, shiftTypeId: "orc" },
      { staffId: "s3", date: TUE, shiftTypeId: "free" },
    ] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skippedDayCap).toBe(1);
    expect(body.skippedLocked).toBe(0);
    expect(body.applied.map((a: { staffId: string; date: string }) => `${a.staffId}:${a.date}`)).toEqual([`s1:${MON}`, `s3:${TUE}`]);
    expectLockedTx(1, [MON, TUE], { reads: /assignment\.findMany/, writes: /assignment\.upsert/ });
    expect(db.holders("orc", MON)).toEqual(["s1"]);
  });

  it("two concurrent pastes onto one Max-1 day leave one holder", async () => {
    const [a, b] = await Promise.all([
      putPaste(req({ cells: [{ staffId: "s1", date: MON, shiftTypeId: "orc" }] })),
      putPaste(req({ cells: [{ staffId: "s2", date: MON, shiftTypeId: "orc" }] })),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]); // paste skips, it never refuses
    const bodies = await Promise.all([a.json(), b.json()]);
    expect(bodies.map((x) => x.skippedDayCap).sort()).toEqual([0, 1]);
    expect(db.holders("orc", MON)).toHaveLength(1);
  });
});

describe("PUT /api/assignments/roster-paste", () => {
  it("keeps its per-group skip: the full date is skipped with reason day-full, others apply, under the locks", async () => {
    db.seed([{ staffId: "s9", date: MON, shiftTypeId: "orc" }]);
    const res = await putRosterPaste(req({ shiftTypeId: "orc", groups: [
      { date: MON, addStaffIds: ["s1"], removeStaffIds: [] },
      { date: TUE, addStaffIds: ["s1"], removeStaffIds: [] },
    ] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skippedGroups).toEqual([{ date: MON, reason: "day-full" }]);
    expect(body.applied.map((a: { date: string }) => a.date)).toEqual([TUE]);
    expectLockedTx(1, [MON, TUE], { reads: /assignment\.findMany/, writes: /assignment\.upsert/ });
    expect(db.holders("orc", MON)).toEqual(["s9"]);
  });

  it("a timed-out transaction reports busy and none of the groups", async () => {
    db.failTxWith = Object.assign(new Error("timeout"), { code: "P2028" });
    const res = await putRosterPaste(req({ shiftTypeId: "orc", groups: [{ date: TUE, addStaffIds: ["s1"], removeStaffIds: [] }] }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("busy");
    expect(db.rows).toEqual([]);
  });
});

describe("PUT /api/auto-schedule (Live Accept)", () => {
  it("locks every suggested date first and writes the whole batch in one transaction", async () => {
    const res = await putAutoAccept(req({ suggestions: [
      { staffId: "s1", date: MON, shiftTypeId: "orc" },
      { staffId: "s2", date: TUE, shiftTypeId: "free" },
    ], startDate: "2026-11-01", endDate: "2026-11-30" }));
    expect(res.status).toBe(200);
    expectLockedTx(1, [MON, TUE], { reads: /assignment\.findMany/, writes: /assignment\.upsert/ });
    const body = await res.json();
    expect(body.applied).toHaveLength(2);
    expect(body.applied[0]).toMatchObject({ source: "auto", autoMonth: "2026-11" });
  });

  it("refuses the whole accept (nothing written) when a day is already full, naming the cells", async () => {
    db.seed([{ staffId: "s9", date: MON, shiftTypeId: "orc" }]);
    const res = await putAutoAccept(req({ suggestions: [
      { staffId: "s1", date: MON, shiftTypeId: "orc" },
      { staffId: "s2", date: TUE, shiftTypeId: "free" },
    ] }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ reason: "day-full", staffId: "s1", date: MON, rejected: [{ staffId: "s1", date: MON, shiftTypeId: "orc" }] });
    expect(db.rows).toHaveLength(1); // s2's FREE on Tuesday was NOT written either
  });

  it("a manual save that enters while an accept holds the day waits and then sees the accepted row", async () => {
    let manual: Promise<Response> | null = null;
    db.afterLock = (key, txId) => {
      // The accept (tx 1) has just locked Monday: fire a manual ORC save on Monday now.
      if (txId === 1 && key === MON && !manual) manual = putOne(req({ staffId: "s2", date: MON, shiftTypeId: "orc" }));
    };
    const accept = await putAutoAccept(req({ suggestions: [{ staffId: "s1", date: MON, shiftTypeId: "orc" }] }));
    expect(accept.status).toBe(200);
    const res = await manual!;
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("day-full");
    expect(db.holders("orc", MON)).toEqual(["s1"]);
    // The manual save's lock was granted only after the accept committed.
    expect(db.log.indexOf("t1:commit")).toBeLessThan(db.log.indexOf("t2:assignment.findUnique"));
  });

  it("skips locked cells without a per-cell read, from the roster read taken under the lock", async () => {
    db.seed([{ staffId: "s1", date: TUE, shiftTypeId: "free", isLocked: true }]);
    const res = await putAutoAccept(req({ suggestions: [{ staffId: "s1", date: TUE, shiftTypeId: "orc" }, { staffId: "s2", date: TUE, shiftTypeId: "orc" }] }));
    const body = await res.json();
    expect(body.skipped).toEqual([{ staffId: "s1", date: TUE, reason: "locked" }]);
    expect(body.applied.map((a: { staffId: string }) => a.staffId)).toEqual(["s2"]);
    expect(db.rows.find((r) => r.staffId === "s1" && +r.date === +at(TUE))!.shiftTypeId).toBe("free");
  });
});

// Card #70 (Codex #355 WARNING): the deleters take the day locks too, so an approval Undo's
// compare-and-set can never race a clear between its read and its write.
describe("the deleters lock their dates (card #70)", () => {
  it("DELETE /api/assignments: lock, re-read, delete in one transaction; the locked refusal stays 400", async () => {
    db.seed([{ staffId: "s1", date: MON, shiftTypeId: "orc" }]);
    const res = await deleteOne(req({ staffId: "s1", date: MON }));
    expect(res.status).toBe(200);
    expectLockedTx(1, [MON], { reads: /assignment\.findUnique/, writes: /assignment\.deleteMany/ });
    expect(db.holders("orc", MON)).toEqual([]);

    db.seed([{ staffId: "s2", date: MON, shiftTypeId: "orc", isLocked: true }]);
    const locked = await deleteOne(req({ staffId: "s2", date: MON }));
    expect(locked.status).toBe(400);
    expect(await locked.json()).toEqual({ error: "Cannot delete locked assignment" });
    expect(txLog(2)[0]).toBe(`lock:${MON}`);
    expect(txLog(2)[txLog(2).length - 1]).toBe("rollback");
    expect(db.holders("orc", MON)).toEqual(["s2"]);
  });

  it("DELETE /api/assignments/bulk: every date locked first; locked cells still skipped", async () => {
    db.seed([{ staffId: "s1", date: TUE, shiftTypeId: "free" }, { staffId: "s2", date: MON, shiftTypeId: "orc", isLocked: true }]);
    const res = await deleteBulk(req({ cells: [{ staffId: "s1", date: TUE }, { staffId: "s2", date: MON }] }));
    expect(res.status).toBe(200);
    expectLockedTx(1, [MON, TUE], { reads: /assignment\.findUnique/, writes: /assignment\.deleteMany/ });
    expect(await res.json()).toMatchObject({ cleared: 1, skipped: [{ staffId: "s2", date: MON, reason: "locked" }] });
  });

  it("DELETE /api/auto-schedule (Clear Auto): locks the dates its rows sit on, deletes under them, keeps autoMonth scoping", async () => {
    db.seed([
      { staffId: "s1", date: MON, shiftTypeId: "orc", source: "auto" },
      { staffId: "s2", date: TUE, shiftTypeId: "free", source: "manual" },
    ]);
    db.rows[0].autoMonth = "2026-11";
    const res = await deleteAuto(req({ startDate: "2026-11-01", endDate: "2026-11-30" }));
    expect(res.status).toBe(200);
    const log = txLog(1);
    expect(log[0]).toBe(`lock:${MON}`);
    expect(log.indexOf("assignment.findMany")).toBeGreaterThan(0);
    expect(log).toContain("assignment.deleteMany");
    expect(log[log.length - 1]).toBe("commit");
    expect(db.rows.map((r) => r.staffId)).toEqual(["s2"]); // the manual row stays
    expect((await res.json()).removed).toHaveLength(1);
  });

  it("each deleter answers a timed-out lock wait with the 409 busy, not a 500, and clears nothing (Codex #361 WARNING)", async () => {
    const BUSY = { error: "Another edit on that day is still saving — try again", reason: "busy" };
    db.seed([
      { staffId: "s1", date: MON, shiftTypeId: "orc", source: "auto" },
      { staffId: "s2", date: TUE, shiftTypeId: "free" },
    ]);
    db.rows[0].autoMonth = "2026-11";
    const calls = [
      () => deleteOne(req({ staffId: "s2", date: TUE })),
      () => deleteBulk(req({ cells: [{ staffId: "s2", date: TUE }] })),
      () => deleteAuto(req({ startDate: "2026-11-01", endDate: "2026-11-30" })),
    ];
    for (const call of calls) {
      db.failTxWith = Object.assign(new Error("Transaction already closed"), { code: "P2028" });
      const res = await call();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual(BUSY);
      expect(db.rows).toHaveLength(2);
    }
  });
});

