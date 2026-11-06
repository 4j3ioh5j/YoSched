import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, at, type FakeTx } from "./fake-prisma";
import type { AutoScheduleInput } from "../auto-scheduler";

// Card #70 — Undo of an approval puts its ripple onto other staff back: the stored inverse,
// the compare-and-set (shift + source + unlocked), the approval's own verifier over the whole
// proposed grid, all under the padded day locks in one transaction.

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./fake-prisma")).prisma }));

vi.mock("@/lib/pay-periods-server", () => ({
  getPayPeriods: async () => {
    db.log.push("getPayPeriods");
    return db.payPeriods.map((p) => ({ ...p }));
  },
}));

// The real input builder reads ~20 tables; here the fixture input is built from the fake's
// assignment rows THROUGH the client the caller hands over, so the read is visibly inside the tx.
const fixture = vi.hoisted(() => ({ staffTargets: [] as { shiftTypeId: string; minCount: number; maxCount?: number | null; window: "days" | "week" | "pay_period" | "month"; windowDays?: number | null }[] }));
vi.mock("@/lib/build-auto-schedule-input", async (importOriginal) => {
  const real = await importOriginal<typeof import("../build-auto-schedule-input")>();
  const { whenToColumns, legacyPatternToWhen } = await import("../recurrence");
  const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
  const shift = (id: string, code: string, extra: Record<string, unknown> = {}) => ({
    id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0, countsTowardFte: true, countsAsHolidayWork: true,
    isLeave: false, isOffShift: false, isFillShift: false, sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
    ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...extra,
  });
  const staff = (id: string, initials: string) => ({
    id, initials, ftePercentage: 1, fixedHoursPerPp: null, inFairness: true, eligibleShiftTypeIds: ["orc", "free", "off"],
    availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })),
    isActive: true, isAutoScheduled: true, specialQualifications: [], shiftMinimumTargets: id === "s1" ? fixture.staffTargets : [],
  });
  return {
    ...real,
    buildAutoScheduleInput: async (startDate: string, endDate: string, opts: { client?: FakeTx; payPeriods?: { startDate: Date; endDate: Date; targetHours: number }[] } = {}): Promise<AutoScheduleInput> => {
      const client = opts.client!;
      const pps = opts.payPeriods!;
      const { effectiveStart, effectiveEnd } = real.coveringRange(pps, startDate, endDate);
      const rows = await client.assignment.findMany({ where: { date: { gte: at(effectiveStart), lte: at(effectiveEnd) } } });
      const dates: string[] = [];
      for (let d = at(effectiveStart); d <= at(effectiveEnd); d = new Date(d.getTime() + 86_400_000)) dates.push(d.toISOString().slice(0, 10));
      const codes: Record<string, string> = { orc: "ORC", free: "OR", off: "X" };
      return {
        dates,
        staff: [staff("s1", "AB"), staff("s2", "CD"), staff("s9", "ZZ")],
        shiftTypes: [shift("orc", "ORC"), shift("free", "OR", { schedulePriority: 1, isFillShift: true }), shift("off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false })],
        existingAssignments: rows.map((r) => ({ staffId: r.staffId, date: r.date.toISOString().slice(0, 10), shiftTypeId: r.shiftTypeId, code: codes[r.shiftTypeId] ?? "?", isLocked: r.isLocked, source: r.source })),
        payPeriods: pps.map((p) => ({ startDate: p.startDate.toISOString().slice(0, 10), endDate: p.endDate.toISOString().slice(0, 10), targetHours: p.targetHours })),
        holidays: [],
        desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [], historicalAssignments: [],
        staffingRequirements: db.rules.map((r) => ({ shiftTypeId: r.shiftTypeId, dayKey: r.dayKey, minCount: 0, maxCount: r.maxCount })),
        schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
        equityFactors: [], followRules: [],
        // The requests as stored, read through the caller's client (so rule 8 — other approvals — is live here).
        scheduleRequests: (await client.scheduleRequest.findMany({})).map((r) => ({
          id: r.id, staffId: r.staffId, startDate: r.startDate.toISOString().slice(0, 10), endDate: r.endDate.toISOString().slice(0, 10),
          kind: r.kind as "REQUEST_SHIFT", shiftTypeIds: r.shiftTypeIds, leaveShiftTypeId: r.leaveShiftTypeId, strength: r.strength as "hard",
          status: r.status as "pending", autoApproved: r.autoApproved, receivedAt: null, offStrategyOrder: r.offStrategyOrder,
        })),
      };
    },
  };
});

import { resolveApproval } from "../request-approval-resolve";
import { unapproveUnderLocks, RippleStale } from "../request-unapprove";
import { parseRipple } from "../request-approval-outcome";

const MON = "2026-11-09"; // pay period 2026-11-08..21; ORC Max 1 on Mondays
const reqOf = (id: string, staffId: string, shift: string) => ({ id, staffId, kind: "REQUEST_SHIFT" as const, shiftTypeIds: [shift], leaveShiftTypeId: null, startDate: MON, endDate: MON, strength: "hard" as const, offStrategyOrder: [] });
const cell = (staffId: string, date = MON) => db.rows.find((r) => r.staffId === staffId && r.date.toISOString().startsWith(date));
const reqRow = (id: string) => db.requests.find((r) => r.id === id)!;
const grid = () => db.rows.map((r) => `${r.staffId}|${r.date.toISOString().slice(0, 10)}|${r.shiftTypeId}|${r.source}|${r.autoMonth ?? "-"}|${r.isLocked}`).sort().join("\n");

// Approve like the PATCH route does: placement + status + the stored inverse, one transaction.
async function approve(id = "r1", staffId = "s1", shift = "orc") {
  const { outcome } = await resolveApproval(reqOf(id, staffId, shift), shift, "u1", (tx, o, ripple) =>
    tx.scheduleRequest.update({ where: { id }, data: o.ok ? { status: "approved", approvalRipple: ripple as never } : { status: "pending" } }));
  expect(outcome.ok).toBe(true);
  return reqRow(id);
}

// Un-approve like the PATCH route does. `undo` = the grid's Undo (restore the inverse); otherwise
// a plain reset (release the request-placed shift, keep everyone else).
async function unapprove(id = "r1", staffId = "s1", shift = "orc", undo = true) {
  const row = reqRow(id);
  return unapproveUnderLocks({
    requestId: id,
    staffId,
    coveredDates: [MON],
    ripple: undo && row.status === "approved" ? parseRipple(row.approvalRipple) : null,
    storedRipple: row.approvalRipple,
    userId: "u1",
    release: async (tx) => {
      await tx.assignment.deleteMany({ where: { staffId, source: "request", isLocked: false, shiftTypeId: shift, date: { in: [at(MON)] } } });
    },
    setStatus: (tx) => tx.scheduleRequest.update({ where: { id }, data: { status: "pending", autoApproved: false, approvalRipple: null as never } }),
  });
}
const undo = () => unapprove();

beforeEach(() => {
  db.reset();
  fixture.staffTargets = [];
  db.shifts = [{ id: "orc", code: "ORC", color: null, isOffShift: false }, { id: "free", code: "OR", color: null, isOffShift: false }, { id: "off", code: "X", color: null, isOffShift: true }];
  db.rules = [{ shiftTypeId: "orc", dayKey: "1", maxCount: 1 }];
  db.payPeriods = [{ id: "pp1", startDate: at("2026-11-08"), endDate: at("2026-11-21"), targetHours: 80 }];
  db.prefs = { id: "default", payPeriodLengthDays: 14, approvalConflictPolicy: "resolve-pp" };
  db.seedRequest({ id: "r1", staffId: "s1", startDate: MON, endDate: MON, kind: "REQUEST_SHIFT", shiftTypeIds: ["orc"] });
  db.seed([{ staffId: "s2", date: MON, shiftTypeId: "orc", source: "auto" }]);
  db.rows[0].autoMonth = "2026-11";
});

describe("card #70 — the approval stores the inverse of its ripple", () => {
  it("records every cell it wrote: CD's displaced ORC (shift, source, autoMonth) and the requester's own cell", async () => {
    const row = await approve();
    const ripple = parseRipple(row.approvalRipple)!;
    expect(ripple).not.toBeNull();
    expect(ripple.find((c) => c.staffId === "s2" && c.date === MON)?.before).toEqual({ shiftTypeId: "orc", source: "auto", autoMonth: "2026-11" });
    expect(ripple.find((c) => c.staffId === "s1" && c.date === MON)).toEqual({ staffId: "s1", date: MON, before: null, after: { shiftTypeId: "orc", source: "request" } });
  });
});

describe("card #70 — Undo puts the ripple back, all or nothing", () => {
  it("restores CD's ORC with its provenance and gives back AB's cell as it was", async () => {
    const start = grid();
    await approve();
    const r = await undo();
    expect(grid()).toBe(start);
    expect(r.ripple).toMatchObject({ restored: true, reason: null });
    expect(cell("s2")).toMatchObject({ shiftTypeId: "orc", source: "auto", autoMonth: "2026-11", isLocked: false });
    expect(cell("s1")).toBeUndefined();
    expect(db.requests[0].status).toBe("pending");
    expect(db.holders("orc", MON)).toEqual(["s2"]);
  });

  it("a hand re-paste of the SAME shift on a displaced cell (source → manual) blocks the restore", async () => {
    const row = await approve();
    const c = parseRipple(row.approvalRipple)!.find((x) => x.staffId === "s2")!;
    const now = cell("s2");
    if (c.after) { expect(now).toBeDefined(); now!.source = "manual"; }
    else db.seed([{ staffId: "s2", date: MON, shiftTypeId: "free", source: "manual" }]);
    const snapshot = JSON.stringify(cell("s2"));
    const r = await undo();
    expect(r.ripple?.restored).toBe(false);
    expect(r.ripple?.reason).toBe("CD's Mon 11/9 was changed after the approval, so the other staff were left as they are");
    expect(JSON.stringify(cell("s2"))).toBe(snapshot); // untouched
    expect(db.requests[0].status).toBe("pending"); // the un-approval itself still happened
  });

  it("a displaced cell locked since blocks the restore", async () => {
    const row = await approve();
    const c = parseRipple(row.approvalRipple)!.find((x) => x.staffId === "s2")!;
    if (!c.after) db.seed([{ staffId: "s2", date: MON, shiftTypeId: "free", source: "auto" }]);
    cell("s2")!.isLocked = true;
    const r = await undo();
    expect(r.ripple?.restored).toBe(false);
    expect(cell("s2")!.shiftTypeId).not.toBe("orc");
  });

  it("the requester's ORC taken over by hand since → nothing restored, the hand-set cell kept", async () => {
    await approve();
    cell("s1")!.source = "manual"; // a scheduler took the cell over: the release leaves it
    const r = await undo();
    expect(r.ripple?.restored).toBe(false);
    expect(r.ripple?.reason).toBe("AB's Mon 11/9 was changed after the approval, so the other staff were left as they are");
    expect(db.holders("orc", MON)).toEqual(["s1"]);
  });

  it("an ORC set by hand for someone else since → restoring CD's would be 2 at Max 1: the verifier refuses, only the plain release runs", async () => {
    await approve();
    db.seed([{ staffId: "s9", date: MON, shiftTypeId: "orc", source: "manual" }]); // outside the inverse: the compare-and-set passes
    const s2Before = JSON.stringify(cell("s2") ?? null);
    const r = await undo();
    expect(r.ripple?.restored).toBe(false);
    expect(r.ripple?.reason).toMatch(/^the other staff were left as they are: putting them back would break a rule \(.*ORC.*\)$/);
    expect(cell("s1")).toBeUndefined(); // the request's own placement released as usual
    expect(JSON.stringify(cell("s2") ?? null)).toBe(s2Before); // CD left as they are
    expect(db.holders("orc", MON)).toEqual(["s9"]);
  });

  it("a stale Undo (the stored ripple changed since) writes nothing", async () => {
    await approve();
    const row = db.requests[0];
    const stale = { ripple: parseRipple(row.approvalRipple), stored: row.approvalRipple };
    db.requests[0].approvalRipple = [...(row.approvalRipple as unknown[])]; // a later approval rewrote it (new object, same JSON)…
    (db.requests[0].approvalRipple as unknown[]).push({ staffId: "s9", date: MON, before: null, after: null }); // …with different content
    const rows = JSON.stringify(db.rows);
    await expect(unapproveUnderLocks({
      requestId: "r1", staffId: "s1", coveredDates: [MON], ripple: stale.ripple, storedRipple: stale.stored, userId: "u1",
      release: async (tx) => { await tx.assignment.deleteMany({ where: { staffId: "s1", source: "request" } }); },
      setStatus: (tx) => tx.scheduleRequest.update({ where: { id: "r1" }, data: { status: "pending", approvalRipple: null as never } }),
    })).rejects.toBeInstanceOf(RippleStale);
    expect(JSON.stringify(db.rows)).toBe(rows);
    expect(db.requests[0].status).toBe("approved");
  });

  it("takes the padded day locks FIRST, before any read, in one transaction", async () => {
    await approve();
    const before = db.log.length;
    await undo();
    const mine = db.log.slice(before).filter((s) => /^t\d+:/.test(s));
    const firstNonLock = mine.findIndex((s) => !s.includes(":lock:"));
    expect(firstNonLock).toBeGreaterThan(0);
    expect(mine.slice(0, firstNonLock).every((s) => s.includes(":lock:"))).toBe(true);
    expect(mine.slice(0, firstNonLock).some((s) => s.endsWith(`:lock:${MON}`))).toBe(true);
  });

  it("no ripple stored: a plain un-approval under the covered days' locks; nothing else written", async () => {
    db.requests[0].status = "approved";
    db.requests[0].approvalRipple = null;
    const before = db.log.length;
    const r = await unapproveUnderLocks({
      requestId: "r1", staffId: "s1", coveredDates: [MON], ripple: null, storedRipple: null, userId: "u1",
      release: async () => {},
      setStatus: (tx) => tx.scheduleRequest.update({ where: { id: "r1" }, data: { status: "pending" } }),
    });
    expect(r.ripple).toBeNull();
    const mine = db.log.slice(before).filter((s) => /^t\d+:/.test(s));
    expect(mine[0]).toMatch(new RegExp(`:lock:${MON}$`));
    expect(db.holders("orc", MON)).toEqual(["s2"]);
  });
});

// Codex #361: a batch Undo replays newest-first, in the order the changes happened; every
// inverse must meet the grid the later change left behind. In this fixture R1's approval moves
// CD off ORC onto X, and CD's own R2 asks for X on that day.
describe("card #70 — chained approvals undone newest-first", () => {
  beforeEach(() => {
    db.seedRequest({ id: "r2", staffId: "s2", startDate: MON, endDate: MON, kind: "REQUEST_SHIFT", shiftTypeIds: ["off"] });
  });

  it("R1's move satisfies CD's R2 (co-approved by sync): undo R2 then R1 → the grid as it started", async () => {
    const start = grid();
    await approve();
    expect(cell("s2")).toMatchObject({ shiftTypeId: "off", source: "auto" });
    Object.assign(reqRow("r2"), { status: "approved", autoApproved: true, approvalRipple: null }); // the cascade
    const r2 = await unapprove("r2", "s2", "off"); // newest first: the co-approval (placed nothing)
    expect(r2.ripple).toBeNull();
    const r1 = await unapprove("r1", "s1", "orc");
    expect(r1.ripple).toMatchObject({ restored: true });
    expect(grid()).toBe(start);
    expect([reqRow("r1").status, reqRow("r2").status]).toEqual(["pending", "pending"]);
  });

  it("…in the wrong order (R1 first) the verifier refuses, because CD's approved R2 would break: why the grid replays in operation order", async () => {
    await approve();
    Object.assign(reqRow("r2"), { status: "approved", autoApproved: true, approvalRipple: null });
    const r1 = await unapprove("r1", "s1", "orc");
    expect(r1.ripple?.restored).toBe(false);
    expect(r1.ripple?.reason).toMatch(/would break a rule \(.*CD.*Mon 11\/9/); // CD's day is held by their approved R2
  });

  it("R1 then R2 approved explicitly (R2 re-sources CD's cell as a request): undo R2 then R1 → the grid as it started", async () => {
    const start = grid();
    await approve();
    await approve("r2", "s2", "off");
    expect(cell("s2")).toMatchObject({ shiftTypeId: "off", source: "request" });
    const r2 = await unapprove("r2", "s2", "off");
    expect(r2.ripple).toMatchObject({ restored: true }); // CD's cell goes back to what R1 left, not deleted
    expect(cell("s2")).toMatchObject({ shiftTypeId: "off", source: "auto" });
    const r1 = await unapprove("r1", "s1", "orc");
    expect(r1.ripple).toMatchObject({ restored: true, reason: null });
    expect(grid()).toBe(start);
  });
});
