import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Accepting a Live / auto-generated schedule (PUT /api/auto-schedule) re-checks the per-day caps
// (Staffing Rules "Max") on the server: the browser engine honours them itself, but its copy of
// the rules or of the saved grid can be stale. An over-cap batch is refused whole (409 day-full,
// nothing written) and names the offending cell(s).

type Row = { id: string; staffId: string; date: Date; shiftTypeId: string; isLocked: boolean; source: string; autoMonth: string | null; autoShiftTypeId: string | null; updatedBy: string | null };
const db = vi.hoisted(() => ({
  rows: [] as Row[],
  caps: [] as { shiftTypeId: string; dayKey: string; maxCount: number | null }[],
  holidays: [] as string[],
  seq: 0,
}));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, userId: "u", permissions: ["schedule:auto"], staffId: null }) }));
vi.mock("@/lib/request-sync", () => ({ syncRequestApprovals: async () => [], syncRequestApprovalsAfterCommit: async () => [], visibleRequestChanges: () => [] }));
vi.mock("@/lib/prisma", () => {
  const key = (staffId: string, date: Date) => `${staffId}:${date.toISOString().slice(0, 10)}`;
  const assignment = {
    findMany: async (a: { where: { date: { in: Date[] } } }) => {
      const want = new Set(a.where.date.in.map((d) => d.toISOString().slice(0, 10)));
      return db.rows.filter((r) => want.has(r.date.toISOString().slice(0, 10))).map((r) => ({ ...r }));
    },
    findUnique: async (a: { where: { staffId_date: { staffId: string; date: Date } } }) =>
      db.rows.find((r) => key(r.staffId, r.date) === key(a.where.staffId_date.staffId, a.where.staffId_date.date)) ?? null,
    upsert: async (a: { where: { staffId_date: { staffId: string; date: Date } }; update: Partial<Row>; create: Omit<Row, "id" | "isLocked" | "autoShiftTypeId"> }) => {
      const k = key(a.where.staffId_date.staffId, a.where.staffId_date.date);
      let r = db.rows.find((x) => key(x.staffId, x.date) === k);
      if (r) Object.assign(r, a.update);
      else db.rows.push((r = { id: `a${++db.seq}`, isLocked: false, autoShiftTypeId: null, ...a.create }));
      return { ...r };
    },
  };
  const shiftType = {
    findMany: async () => [
      { id: "st-orc", code: "ORC", color: "#111" },
      { id: "st-or", code: "OR", color: "#222" },
    ],
  };
  const staffingRequirement = { findMany: async () => db.caps.filter((c) => c.maxCount != null) };
  const holiday = { findMany: async () => db.holidays.map((d) => ({ date: new Date(d + "T00:00:00Z") })) };
  const client = { assignment, shiftType, staffingRequirement, holiday };
  // The route now runs its check + writes in one transaction under per-date advisory locks
  // (card #65); the lock statement is a no-op here. The serialisation itself is tested in
  // src/app/api/assignments/__tests__/day-cap-serialised.test.ts.
  return { prisma: { ...client, $transaction: async (fn: (tx: typeof client & { $executeRaw: () => Promise<number> }) => Promise<unknown>) => fn({ ...client, $executeRaw: async () => 1 }) } };
});

import { PUT as acceptRun } from "../route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const MON = "2026-11-02", TUE = "2026-11-03"; // 2026-11-02 is a Monday (dayKey "1")
const sug = (staffId: string, date: string, shiftTypeId: string) => ({ staffId, date, shiftTypeId });
const row = (staffId: string, date: string, shiftTypeId: string, isLocked = false): Row =>
  ({ id: `seed-${staffId}-${date}`, staffId, date: new Date(date + "T00:00:00Z"), shiftTypeId, isLocked, source: "manual", autoMonth: null, autoShiftTypeId: null, updatedBy: null });

beforeEach(() => {
  db.rows = [];
  db.caps = [{ shiftTypeId: "st-orc", dayKey: "1", maxCount: 1 }]; // one ORC on Mondays; OR uncapped
  db.holidays = [];
  db.seq = 0;
});

describe("PUT /api/auto-schedule (Accept) re-checks per-day caps on the server", () => {
  it("two capped shifts on one day in the batch → 409 day-full naming the second cell, nothing written", async () => {
    const res = await acceptRun(req({ suggestions: [sug("a", MON, "st-orc"), sug("b", MON, "st-orc"), sug("c", MON, "st-or")] }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ reason: "day-full", code: "ORC", maxPerDay: 1, date: MON, staffId: "b", shiftTypeId: "st-orc" });
    expect(body.rejected).toEqual([sug("b", MON, "st-orc")]);
    expect(body.error).toMatch(/Only 1 ORC allowed on Mondays/);
    expect(db.rows).toEqual([]);
  });

  it("a saved cell already holds the day's only ORC → a suggested ORC for someone else is refused; the holder's own cell may be re-pinned", async () => {
    db.rows = [row("a", MON, "st-orc")];
    const other = await acceptRun(req({ suggestions: [sug("b", MON, "st-orc")] }));
    expect(other.status).toBe(409);
    expect(db.rows).toHaveLength(1);
    const same = await acceptRun(req({ suggestions: [sug("a", MON, "st-orc")] }));
    expect(same.status).toBe(200);
    expect((await same.json()).applied).toHaveLength(1);
  });

  it("a locked cell is skipped, so a suggestion onto it neither counts nor replaces", async () => {
    db.rows = [row("a", MON, "st-orc", true)];
    // Overwriting a's locked ORC with OR would (if counted as a replacement) free the ORC slot
    // for b — but the write skips locked cells, so a's ORC stays and b's ORC must be refused.
    const res = await acceptRun(req({ suggestions: [sug("a", MON, "st-or"), sug("b", MON, "st-orc")] }));
    expect(res.status).toBe(409);
    expect((await res.json()).staffId).toBe("b");
    expect(db.rows.map((r) => r.shiftTypeId)).toEqual(["st-orc"]);
  });

  it("within the caps the batch is applied; the cap is per day (Tuesday is uncapped here) and per shift", async () => {
    const res = await acceptRun(req({ suggestions: [sug("a", MON, "st-orc"), sug("b", TUE, "st-orc"), sug("c", TUE, "st-orc"), sug("d", MON, "st-or"), sug("e", MON, "st-or")], startDate: "2026-11-01", endDate: "2026-11-30" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toHaveLength(5);
    expect(body.skipped).toEqual([]);
    expect(db.rows.every((r) => r.source === "auto" && r.autoMonth === "2026-11")).toBe(true);
  });

  it("a holiday uses the holiday cap, not the weekday's", async () => {
    db.holidays = [MON];
    db.caps = [{ shiftTypeId: "st-orc", dayKey: "1", maxCount: 1 }, { shiftTypeId: "st-orc", dayKey: "holiday", maxCount: 0 }];
    const res = await acceptRun(req({ suggestions: [sug("a", MON, "st-orc")] }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Only 0 ORC allowed on holidays/);
  });

  it("malformed suggestions → 400, nothing written", async () => {
    expect((await acceptRun(req({ suggestions: [] }))).status).toBe(400);
    expect((await acceptRun(req({ suggestions: [{ staffId: "a", date: "Nov 2", shiftTypeId: "st-orc" }] }))).status).toBe(400);
    expect((await acceptRun(req({ suggestions: [{ staffId: "a", date: MON }] }))).status).toBe(400);
    expect((await acceptRun(req({ suggestions: "nope" }))).status).toBe(400);
    expect(db.rows).toEqual([]);
  });
});
