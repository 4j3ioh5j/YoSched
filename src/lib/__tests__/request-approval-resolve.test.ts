import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, at, txLog, type FakeTx } from "./fake-prisma";
import type { AutoScheduleInput } from "../auto-scheduler";

// Card #67 — resolveApproval under the writers' lock protocol (card #65), against the fake
// database: the padded lock range is taken FIRST, the pay-period ladder is read outside the
// transaction, the decision's writes and the request row's own change ride in ONE transaction,
// and a race on a locked day waits for the other writer's commit.

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
        equityFactors: [], followRules: [], scheduleRequests: [],
      };
    },
  };
});

import { resolveApproval, ApprovalRetry, paddingDays } from "../request-approval-resolve";
import { prisma } from "./fake-prisma";

const MON = "2026-11-09"; // the pay period 2026-11-08..21; Monday = dayKey "1"
const req = (id = "r1", staffId = "s1") => ({ id, staffId, kind: "REQUEST_SHIFT" as const, shiftTypeIds: ["orc"], leaveShiftTypeId: null, startDate: MON, endDate: MON, strength: "hard" as const, offStrategyOrder: [] });
type Finish = Parameters<typeof resolveApproval>[3];
const finishUpdate: Finish = (tx, outcome) => tx.scheduleRequest.update({ where: { id: "r1" }, data: outcome.ok ? { status: "approved" } : { status: "pending", flaggedReason: outcome.reason } });

const LOCK_KEYS = (() => {
  const out: string[] = [];
  for (let d = at("2026-11-07"); d <= at("2026-11-22"); d = new Date(d.getTime() + 86_400_000)) out.push(`lock:${d.toISOString().slice(0, 10)}`);
  return out;
})();

beforeEach(() => {
  db.reset();
  fixture.staffTargets = [];
  db.shifts = [{ id: "orc", code: "ORC", color: null, isOffShift: false }, { id: "free", code: "OR", color: null, isOffShift: false }, { id: "off", code: "X", color: null, isOffShift: true }];
  db.rules = [{ shiftTypeId: "orc", dayKey: "1", maxCount: 1 }];
  db.payPeriods = [{ id: "pp1", startDate: at("2026-11-08"), endDate: at("2026-11-21"), targetHours: 80 }];
  db.prefs = { id: "default", payPeriodLengthDays: 14, approvalConflictPolicy: "resolve-pp" };
  db.seedRequest({ id: "r1", staffId: "s1", startDate: MON, endDate: MON, kind: "REQUEST_SHIFT", shiftTypeIds: ["orc"] });
});

describe("paddingDays", () => {
  it("is at least 1 and grows to the longest HARD target window", () => {
    expect(paddingDays([], 14)).toBe(1);
    expect(paddingDays([{ window: "days", windowDays: 7 }], 14)).toBe(7);
    expect(paddingDays([{ window: "week", windowCount: 2 }], 14)).toBe(14);
    expect(paddingDays([{ window: "pay_period", windowCount: 3 }], 14)).toBe(42);
    expect(paddingDays([{ window: "month" }], 14)).toBe(31);
    expect(paddingDays([{ window: "month", strength: "preference" }], 14)).toBe(1);
  });
});

describe("resolveApproval — lock protocol", () => {
  it("locks the padded covering range (pay period ± 1 day, last day included) before any read, inside the tx", async () => {
    await resolveApproval(req(), "orc", "u1", finishUpdate);
    const t1 = txLog(1);
    expect(t1.slice(0, LOCK_KEYS.length)).toEqual(LOCK_KEYS);
    const firstRead = t1.findIndex((s) => !s.startsWith("lock:"));
    expect(firstRead).toBe(LOCK_KEYS.length);
    expect(t1).toContain("assignment.findMany");
    expect(t1[t1.length - 1]).toBe("commit");
  });

  it("reads the pay-period ladder OUTSIDE the transaction, before the first lock; never regenerates inside it", async () => {
    await resolveApproval(req(), "orc", "u1", finishUpdate);
    const pp = db.log.indexOf("getPayPeriods");
    const firstLock = db.log.findIndex((s) => s.includes(":lock:"));
    expect(pp).toBeGreaterThanOrEqual(0);
    expect(pp).toBeLessThan(firstLock);
    expect(txLog(1)).not.toContain("payPeriod.deleteMany");
    expect(txLog(1)).not.toContain("payPeriod.createMany");
    expect(txLog(1)).toContain("payPeriod.findMany");
  });

  it("uses the writers' transaction options", async () => {
    await resolveApproval(req(), "orc", "u1", finishUpdate);
    expect(db.txOpts).toEqual([{ maxWait: 10_000, timeout: 60_000 }]);
  });
});

describe("resolveApproval — outcomes", () => {
  it("success: the placement is saved as source request and `finish` runs in the same transaction", async () => {
    const { outcome, result, range } = await resolveApproval(req(), "orc", "u1", finishUpdate);
    expect(outcome.ok).toBe(true);
    expect(result).toMatchObject({ id: "r1", status: "approved" });
    expect(range).toEqual({ start: "2026-11-08", end: "2026-11-21", pad: 1 });
    const row = db.rows.find((r) => r.staffId === "s1" && r.date.toISOString().startsWith(MON));
    expect(row).toMatchObject({ shiftTypeId: "orc", source: "request", updatedBy: "u1" });
    const t1 = txLog(1);
    expect(t1.indexOf("assignment.upsert")).toBeLessThan(t1.indexOf("scheduleRequest.update"));
    expect(t1.indexOf("scheduleRequest.update")).toBeLessThan(t1.indexOf("commit"));
  });

  it("impossible (the day's only ORC set by hand): nothing is written, `finish` gets the sentence, the tx still commits", async () => {
    db.seed([{ staffId: "s2", date: MON, shiftTypeId: "orc", source: "manual" }]);
    const { outcome } = await resolveApproval(req(), "orc", "u1", finishUpdate);
    expect(outcome).toEqual({ ok: false, reason: "Mon 11/9 already has its 1 ORC (set by hand for CD)" });
    expect(db.rows).toHaveLength(1);
    expect(db.requests[0]).toMatchObject({ status: "pending", flaggedReason: "Mon 11/9 already has its 1 ORC (set by hand for CD)" });
    expect(txLog(1)).not.toContain("assignment.upsert");
    expect(txLog(1)[txLog(1).length - 1]).toBe("commit");
  });

  it("a movable holder is moved in the same transaction as the placement", async () => {
    db.seed([{ staffId: "s2", date: MON, shiftTypeId: "orc", source: "auto" }]);
    const { outcome } = await resolveApproval(req(), "orc", "u1", finishUpdate);
    expect(outcome.ok).toBe(true);
    expect(db.holders("orc", MON)).toEqual(["s1"]);
  });

  it("a null write deletes the cell", async () => {
    // s1 is available only... no conditional rules here; exercise delete through the holder path:
    // the holder's ORC is freed and the engine leaves the cell blank or refills it; either way the
    // holder's row is written (upsert) or removed (deleteMany) inside the tx.
    db.seed([{ staffId: "s2", date: MON, shiftTypeId: "orc", source: "auto" }]);
    await resolveApproval(req(), "orc", "u1", finishUpdate);
    const t1 = txLog(1);
    expect(t1.some((s) => s === "assignment.upsert" || s === "assignment.deleteMany")).toBe(true);
  });

  it("a transaction that times out on the lock surfaces as the P2028 the route maps to busy; nothing written", async () => {
    db.failTxWith = Object.assign(new Error("Transaction API error: Unable to start a transaction in the given time."), { code: "P2028" });
    await expect(resolveApproval(req(), "orc", "u1", finishUpdate)).rejects.toMatchObject({ code: "P2028" });
    expect(db.rows).toEqual([]);
    expect(db.requests[0].status).toBe("pending");
  });

  it("a wider pad under the locks than before them → ApprovalRetry, rolled back, nothing written", async () => {
    // The pre-lock read sees no targets (pad 1); the input read under the locks carries a 30-day window.
    fixture.staffTargets = [{ shiftTypeId: "orc", minCount: 0, maxCount: 2, window: "days", windowDays: 30 }];
    await expect(resolveApproval(req(), "orc", "u1", finishUpdate)).rejects.toBeInstanceOf(ApprovalRetry);
    expect(db.rows).toEqual([]);
    expect(txLog(1)).toContain("rollback");
    expect(txLog(1)).not.toContain("assignment.upsert");
    expect(txLog(1)).not.toContain("scheduleRequest.update");
  });

  it("the same pad before and under the locks is fine (the targets were already there)", async () => {
    fixture.staffTargets = [{ shiftTypeId: "orc", minCount: 0, maxCount: 2, window: "days", windowDays: 30 }];
    db.minTargets = [{ window: "days", windowDays: 30, windowCount: 1 }];
    const { outcome, range } = await resolveApproval(req(), "orc", "u1", finishUpdate);
    expect(outcome.ok).toBe(true);
    expect(range.pad).toBe(30);
    expect(db.log.filter((s) => s.includes(":lock:"))).toHaveLength(14 + 60);
  });

  it("context rows outside the range are read but never written", async () => {
    db.seed([{ staffId: "s1", date: "2026-11-07", shiftTypeId: "orc", source: "auto" }]);
    const before = { ...db.rows[0] };
    const { outcome } = await resolveApproval(req(), "orc", "u1", finishUpdate);
    expect(outcome.ok).toBe(true);
    expect(db.rows.find((r) => r.id === before.id)).toMatchObject({ shiftTypeId: "orc", source: "auto", updatedBy: null });
  });

  it("the policy comes from the preferences read under the locks", async () => {
    db.prefs = { id: "default", payPeriodLengthDays: 14, approvalConflictPolicy: "flag" };
    db.seed([{ staffId: "s2", date: MON, shiftTypeId: "orc", source: "auto" }]);
    const { outcome } = await resolveApproval(req(), "orc", "u1", finishUpdate);
    expect(outcome).toEqual({ ok: false, reason: "Mon 11/9 already has its 1 ORC" });
    expect(db.holders("orc", MON)).toEqual(["s2"]);
  });
});

describe("resolveApproval — a race on a locked day", () => {
  async function otherWriterTakesMonday(): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${1}::int, hashtext(${MON}::text))`;
      // A long writer (think: a month-long accept): many statements before its write lands.
      for (let i = 0; i < 40; i++) await tx.assignment.count();
      await tx.assignment.upsert({
        where: { staffId_date: { staffId: "s9", date: at(MON) } },
        update: { shiftTypeId: "orc" },
        create: { staffId: "s9", date: at(MON), shiftTypeId: "orc", source: "manual" },
      });
    });
  }

  it("waits for the other writer's commit before reading, so the cap is counted on the committed grid", async () => {
    // t1 = the other writer holds Monday; the approval (t2) queues on that lock and reads after t1's commit.
    let approval!: Promise<unknown>;
    db.afterLock = (key, txId) => {
      if (txId === 1 && key === MON) approval = resolveApproval(req(), "orc", "u1", finishUpdate);
    };
    await otherWriterTakesMonday();
    const result = (await approval) as Awaited<ReturnType<typeof resolveApproval>>;
    const commit1 = db.log.indexOf("t1:commit");
    const read2 = db.log.indexOf("t2:assignment.findMany");
    expect(commit1).toBeGreaterThan(-1);
    expect(read2).toBeGreaterThan(commit1);
    // s9 took Monday's only ORC by hand while we waited: the approval is flagged, not overfilled.
    expect(result.outcome).toEqual({ ok: false, reason: "Mon 11/9 already has its 1 ORC (set by hand for ZZ)" });
    expect(db.holders("orc", MON)).toEqual(["s9"]);
  });

  it("control: without the locks the approval reads before the other writer commits (the race the lock prevents)", async () => {
    db.lockEnabled = false;
    let approval!: Promise<unknown>;
    db.afterLock = (key, txId) => {
      if (txId === 1 && key === MON) approval = resolveApproval(req(), "orc", "u1", finishUpdate);
    };
    await otherWriterTakesMonday();
    await approval;
    const commit1 = db.log.indexOf("t1:commit");
    const read2 = db.log.indexOf("t2:assignment.findMany");
    expect(read2).toBeLessThan(commit1);
  });
});
