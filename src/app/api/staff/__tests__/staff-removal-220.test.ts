import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #220: a hard staff remove keeps a snapshot of everything it deletes, taken under locks
// that hold off every other writer of the person's rows; Undo restores the same person.

type Row = Record<string, unknown>;
const T = vi.hoisted(() => ({
  // table → Prisma delegate name, for the cascaded child tables
  staff_eligible_shifts: "staffEligibleShift",
  availability_rules: "availabilityRule",
  shift_eligibility_rules: "shiftEligibilityRule",
  shift_minimum_targets: "shiftMinimumTarget",
  standing_commitments: "standingCommitment",
  staff_shift_overrides: "staffShiftOverride",
  staff_day_preferences: "staffDayPreference",
  schedule_requests: "scheduleRequest",
} as Record<string, string>));
const db = vi.hoisted(() => ({
  t: {} as Record<string, Row[]>,
  log: [] as string[],
  failCreate: null as string | null,
  seq: 0,
}));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } }, userId: "u", permissions: ["staff:edit"], staffId: null }) }));
vi.mock("@/lib/user-lifecycle", () => ({
  detachLoginForStaff: async (staffId: string) => {
    db.log.push("detach");
    const u = db.t.users.find((x) => x.staffId === staffId);
    if (!u) return "none";
    if (u.shell) { db.t.users = db.t.users.filter((x) => x !== u); return "deleted"; }
    u.staffId = null;
    return "unlinked";
  },
}));
vi.mock("@/lib/prisma", () => {
  const tbl = (n: string) => (db.t[n] ??= []);
  const matches = (r: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "in" in (v as Row)) return ((v as { in: unknown[] }).in).includes(r[k]);
    return (r[k] ?? null) === v;
  });
  const fk = (name: string, row: Row) => {
    if (db.failCreate === name) { const e = new Error("fk") as Error & { code: string }; e.code = "P2003"; throw e; }
    void row;
  };
  const delegate = (name: string) => ({
    findMany: async (a: { where?: Row } = {}) => tbl(name).filter((r) => matches(r, a.where)).map((r) => ({ ...r })),
    createMany: async (a: { data: Row[] }) => { for (const r of a.data) { fk(name, r); tbl(name).push({ id: `${name}-${++db.seq}`, ...r }); } return { count: a.data.length }; },
    updateMany: async (a: { where: Row; data: Row }) => { let n = 0; for (const r of tbl(name)) if (matches(r, a.where)) { Object.assign(r, a.data); n++; } return { count: n }; },
    deleteMany: async (a: { where: Row }) => { db.t[name] = tbl(name).filter((r) => !matches(r, a.where)); return { count: 0 }; },
  });
  const tx: Record<string, unknown> = {
    staff: {
      findUnique: async (a: { where: Row; include?: unknown }) => {
        const s = tbl("staff").find((r) => matches(r, a.where));
        if (!s) return null;
        if (!a.include) return { ...s };
        const kids = (t: string) => tbl(t).filter((r) => r.staffId === s.id).map((r) => ({ ...r }));
        return {
          ...s, employmentType: tbl("types").find((t) => t.id === s.employmentTypeId) ?? { id: s.employmentTypeId, name: "T", defaultFtePercentage: 1 },
          eligibleShifts: kids("staff_eligible_shifts"), availabilityRules: kids("availability_rules"), shiftEligibilityRules: kids("shift_eligibility_rules"),
          shiftMinimumTargets: kids("shift_minimum_targets"), standingCommitments: kids("standing_commitments"), shiftOverrides: kids("staff_shift_overrides"),
          loginUser: tbl("users").find((u) => u.staffId === s.id) ?? null,
        };
      },
      create: async (a: { data: Row }) => {
        fk("staff", a.data);
        if (tbl("staff").some((r) => r.initials === a.data.initials)) { const e = new Error("unique") as Error & { code: string }; e.code = "P2002"; throw e; }
        tbl("staff").push({ ...a.data }); return { ...a.data };
      },
      update: async (a: { where: Row; data: Row }) => { const s = tbl("staff").find((r) => matches(r, a.where))!; Object.assign(s, a.data); db.log.push("update"); return { ...s }; },
      delete: async (a: { where: { id: string } }) => {
        db.log.push("delete");
        const id = a.where.id;
        db.t.staff = tbl("staff").filter((r) => r.id !== id);
        for (const t of Object.keys(T)) db.t[t] = tbl(t).filter((r) => r.staffId !== id);
        db.t.assignments = tbl("assignments").filter((r) => r.staffId !== id);
        for (const r of tbl("availability_rules")) if (r.conditionStaffId === id) r.conditionStaffId = null;
        return {};
      },
    },
    assignment: { count: async (a: { where: Row }) => { db.log.push("count"); return tbl("assignments").filter((r) => matches(r, a.where)).length; } },
    user: {
      findUnique: async (a: { where: Row; select?: unknown }) => { const u = tbl("users").find((r) => matches(r, a.where)); return u ? { ...u } : null; },
      updateMany: async (a: { where: Row; data: Row }) => { let n = 0; for (const r of tbl("users")) if (matches(r, a.where)) { Object.assign(r, a.data); n++; } return { count: n }; },
    },
    staffRemoval: {
      create: async (a: { data: Row }) => { db.log.push("snapshot"); const r = { id: `rm${++db.seq}`, restoredAt: null, ...a.data }; tbl("staff_removals").push(r); return { ...r }; },
      update: async (a: { where: { id: string }; data: Row }) => { const r = tbl("staff_removals").find((x) => x.id === a.where.id)!; Object.assign(r, a.data); return { ...r }; },
      findUnique: async (a: { where: { id: string } }) => { const r = tbl("staff_removals").find((x) => x.id === a.where.id); return r ? { ...r } : null; },
    },
    $executeRaw: async (s: TemplateStringsArray | { sql: string; values: unknown[] }, ...vals: unknown[]) => {
      const text = Array.isArray(s) ? (s as TemplateStringsArray).join("?") : (s as { sql: string }).sql;
      db.log.push(text.includes("hashtext") ? `rules-lock:${(Array.isArray(s) ? vals : (s as { values: unknown[] }).values).at(-1)}` : "eligibility-lock");
      return 0;
    },
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      const m = /FROM "?(\w+)"?\s+WHERE "?(\w+)"? = (?:\$1|\?)( FOR UPDATE)?/.exec(q.sql);
      if (!m) throw new Error(`unexpected SQL ${q.sql}`);
      const [, table, col, forUpdate] = m;
      db.log.push(`${forUpdate ? "lock" : "read"}:${table}${col === "conditionStaffId" ? ":condition" : ""}`);
      return tbl(table).filter((r) => r[col] === q.values[0]).map((r) => ({ ...r }));
    },
  };
  for (const [t, d] of Object.entries(T)) {
    const del = delegate(t);
    tx[d] = del;
  }
  const prisma = { ...tx, $transaction: async (fn: (t: typeof tx) => Promise<unknown>, opts?: Row) => {
    db.log.push(`tx${opts?.timeout ? ":timeout" : ""}`);
    const snap = JSON.stringify(db.t);
    try { return await fn(tx); } catch (e) { db.t = JSON.parse(snap); throw e; }
  } };
  return { prisma };
});

import { DELETE } from "../route";
import { POST as RESTORE } from "../restore/route";
import { ruleListVersion } from "@/lib/staff-rule-versions";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const when = { whenKind: "every", whenDays: [1], whenPpWeek: null, whenOrds: [], whenCycleUnit: null, whenCycleN: null, whenCycleOffset: null };

function seed() {
  db.seq = 0;
  db.log = [];
  db.failCreate = null;
  db.t = {
    types: [{ id: "ft", name: "Full time", defaultFtePercentage: 1 }],
    staff: [
      { id: "s1", name: "Ann", initials: "AN", employmentTypeId: "ft", ftePercentage: 0.5, fixedHoursPerPp: null, role: null, specialQualifications: ["x"], isTemporary: false, tempStartDate: null, tempEndDate: null, isActive: true, isAutoScheduled: true, offStrategyOrder: [], sortOrder: 3, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" },
      { id: "s2", name: "Bo", initials: "BO", employmentTypeId: "ft", isActive: true, sortOrder: 4 },
    ],
    assignments: [],
    staff_eligible_shifts: [{ id: "e1", staffId: "s1", shiftTypeId: "call", eligibleSince: null }],
    availability_rules: [
      { id: "a1", staffId: "s1", type: "unavailable", strength: "rule", conditionStaffId: null, conditionType: null, ...when },
      { id: "a2", staffId: "s2", type: "unavailable", strength: "rule", conditionStaffId: "s1", conditionType: "working", ...when },
    ],
    shift_eligibility_rules: [{ id: "r1", staffId: "s1", shiftTypeId: "call", type: "eligible", strength: "rule", ...when }],
    shift_minimum_targets: [{ id: "m1", staffId: "s1", shiftTypeId: "call", minCount: 1, maxCount: null, window: "pay_period", windowDays: null, windowCount: 1, strength: "preference" }],
    standing_commitments: [{ id: "c1", staffId: "s1", shiftTypeId: "call", notes: "n", ...when }],
    staff_shift_overrides: [{ id: "o1", staffId: "s1", shiftTypeId: "call", durationHrs: 10, durationHrsWeekday: null, durationHrsWeekend: null, durationHrsHoliday: null }],
    staff_day_preferences: [{ id: "d1", staffId: "s1", dayOfWeek: 2, preference: "ORC" }],
    schedule_requests: [{ id: "q1", staffId: "s1", startDate: "2026-12-01T00:00:00.000Z", endDate: "2026-12-01T00:00:00.000Z", kind: "OFF", status: "approved", approvalRipple: { a: 1 } }],
    users: [{ id: "u1", staffId: "s1", shell: false }],
    staff_removals: [],
  };
}
beforeEach(seed);
const before = () => JSON.parse(JSON.stringify(db.t)) as Record<string, Row[]>;
const removalId = () => String(db.t.staff_removals[0]?.id);

describe("DELETE /api/staff (hard remove) keeps a snapshot", () => {
  it("locks in order, checks assignments under the row lock, snapshots, then deletes — one transaction with a timeout", async () => {
    const res = await DELETE(req({ id: "s1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, deleted: true, removalId: removalId() });
    expect(db.log.filter((l) => l.startsWith("tx"))).toEqual(["tx:timeout"]);
    const order = db.log.filter((l) => l !== "tx:timeout");
    expect(order.slice(0, 4)).toEqual(["eligibility-lock", "rules-lock:s1", "lock:staff", "count"]);
    for (const t of Object.keys(T)) expect(order).toContain(`lock:${t}`);
    expect(order).toContain("lock:availability_rules:condition");
    expect(order).toContain("lock:users");
    const lastLock = Math.max(...order.map((l, i) => (l.startsWith("lock:") ? i : -1)));
    expect(lastLock).toBeLessThan(order.indexOf("snapshot"));
    expect(order.indexOf("snapshot")).toBeLessThan(order.indexOf("delete"));
    expect(db.t.staff.map((s) => s.id)).toEqual(["s2"]);
    expect(db.t.availability_rules.find((r) => r.id === "a2")?.conditionStaffId).toBeNull();
  });

  it("an assignment present under the lock → deactivate in the same transaction, no snapshot", async () => {
    db.t.assignments.push({ id: "x1", staffId: "s1" });
    const res = await DELETE(req({ id: "s1" }));
    expect(await res.json()).toEqual({ ok: true, deactivated: true });
    expect(db.t.staff_removals).toEqual([]);
    expect(db.t.staff.find((s) => s.id === "s1")?.isActive).toBe(false);
    expect(db.log).not.toContain("delete");
  });

  it("an unknown person → 404, nothing written", async () => {
    const was = before();
    expect((await DELETE(req({ id: "nope" }))).status).toBe(404);
    expect(db.t).toEqual(was);
  });

  it("a failure after the snapshot rolls everything back", async () => {
    const was = before();
    const del = (await import("@/lib/prisma")).prisma.staff as unknown as { delete: unknown };
    const real = del.delete;
    del.delete = async () => { throw new Error("boom"); };
    await expect(DELETE(req({ id: "s1" }))).rejects.toThrow("boom");
    del.delete = real;
    expect(db.t).toEqual(was);
  });
});

describe("POST /api/staff/restore", () => {
  it("brings back the same person: same id and fields, every child row with its id, links re-pointed", async () => {
    const was = before();
    await DELETE(req({ id: "s1" }));
    const res = await RESTORE(req({ removalId: removalId() }));
    expect(res.status).toBe(200);
    for (const t of ["staff", ...Object.keys(T)]) {
      const sort = (rows: Row[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      expect(sort(db.t[t])).toEqual(sort(was[t]));
    }
    expect(db.t.users).toEqual(was.users);
    expect(db.t.staff_removals[0].restoredAt).toBeTruthy();
    const row = await res.json();
    expect(row).toMatchObject({ id: "s1", initials: "AN", loginUserId: "u1" });
    expect(row.ruleVersions.availabilityRules).toBe(ruleListVersion("availabilityRules", db.t.availability_rules.filter((r) => r.staffId === "s1")));
    expect(row.ruleVersions.shiftMinimumTargets).toBe(ruleListVersion("shiftMinimumTargets", db.t.shift_minimum_targets));
  });

  it("a shell login is not brought back; a real login linked to someone else meanwhile stays theirs", async () => {
    db.t.users = [{ id: "u1", staffId: "s1", shell: true }];
    await DELETE(req({ id: "s1" }));
    expect(db.t.users).toEqual([]);
    expect((await RESTORE(req({ removalId: removalId() }))).status).toBe(200);
    expect(db.t.users).toEqual([]);
    seed();
    await DELETE(req({ id: "s1" }));
    db.t.users[0].staffId = "s2";
    expect((await RESTORE(req({ removalId: removalId() }))).status).toBe(200);
    expect(db.t.users[0].staffId).toBe("s2");
  });

  it("another person's rule re-pointed elsewhere meanwhile is left alone; a deleted one is skipped", async () => {
    db.t.availability_rules.push({ id: "a3", staffId: "s2", type: "unavailable", strength: "rule", conditionStaffId: "s1", conditionType: "working", ...when });
    await DELETE(req({ id: "s1" }));
    db.t.availability_rules.find((r) => r.id === "a2")!.conditionStaffId = "s9";
    db.t.availability_rules = db.t.availability_rules.filter((r) => r.id !== "a3");
    expect((await RESTORE(req({ removalId: removalId() }))).status).toBe(200);
    expect(db.t.availability_rules.find((r) => r.id === "a2")?.conditionStaffId).toBe("s9");
  });

  it("twice → 409 the second time, nothing written", async () => {
    await DELETE(req({ id: "s1" }));
    await RESTORE(req({ removalId: removalId() }));
    const was = before();
    const res = await RESTORE(req({ removalId: removalId() }));
    expect(res.status).toBe(409);
    expect(db.t).toEqual(was);
  });

  it("no such removal → 409", async () => {
    expect((await RESTORE(req({ removalId: "nope" }))).status).toBe(409);
    expect((await RESTORE(req({}))).status).toBe(400);
  });

  it("the initials were given to someone else meanwhile → 409, nothing written", async () => {
    await DELETE(req({ id: "s1" }));
    db.t.staff.push({ id: "s3", name: "Al", initials: "AN" });
    const was = before();
    const res = await RESTORE(req({ removalId: removalId() }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/AN/);
    expect(db.t).toEqual(was);
  });

  it("something it used is gone (a foreign key fails) → 409 and full rollback", async () => {
    await DELETE(req({ id: "s1" }));
    const was = before();
    db.failCreate = "schedule_requests";
    const res = await RESTORE(req({ removalId: removalId() }));
    expect(res.status).toBe(409);
    expect(db.t).toEqual(was);
  });

  it("takes the same locks, then the removal row", async () => {
    await DELETE(req({ id: "s1" }));
    db.log = [];
    await RESTORE(req({ removalId: removalId() }));
    const order = db.log.filter((l) => !l.startsWith("tx"));
    expect(order.slice(0, 3)).toEqual(["eligibility-lock", "rules-lock:s1", "lock:staff_removals"]);
    expect(db.log).toContain("tx:timeout");
  });
});
