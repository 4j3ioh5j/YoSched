import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #210: holiday rules API — strict validation, replace-all with a version check (409 when
// someone saved since), ids kept across renames, nothing written on a refused save.

type Day = { offset: number; shiftTypeId: string };
type Rule = { id: string; name: string; holidayTypeId: string; sortOrder: number; days: Day[] };
const db = vi.hoisted(() => ({ rules: [] as Rule[], types: ["tg"], shifts: ["call", "orc"], writes: 0, seq: 0, locks: 0 }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } }, userId: "u", permissions: ["settings:edit", "settings:view"], staffId: null }) }));
vi.mock("@/lib/prisma", () => {
  const clone = (r: Rule): Rule => ({ ...r, days: r.days.map((d) => ({ ...d })) });
  const holidayRule = {
    findMany: async () => [...db.rules].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => ({ ...clone(r), days: [...r.days].sort((a, b) => a.offset - b.offset) })),
    deleteMany: async (a: { where: { id: { notIn: string[] } } }) => { db.writes++; db.rules = db.rules.filter((r) => a.where.id.notIn.includes(r.id)); return { count: 0 }; },
    update: async (a: { where: { id: string }; data: Partial<Rule> & { days?: { create: Day[] } } }) => {
      db.writes++;
      const r = db.rules.find((x) => x.id === a.where.id)!;
      const { days, ...rest } = a.data;
      Object.assign(r, rest);
      if (days) r.days = days.create.map((d) => ({ ...d }));
      return clone(r);
    },
    create: async (a: { data: Omit<Rule, "id" | "days"> & { days: { create: Day[] } } }) => {
      db.writes++;
      const r: Rule = { id: `new${++db.seq}`, name: a.data.name, holidayTypeId: a.data.holidayTypeId, sortOrder: a.data.sortOrder, days: a.data.days.create.map((d) => ({ ...d })) };
      db.rules.push(r);
      return clone(r);
    },
  };
  const holidayRuleDay = { deleteMany: async (a: { where: { ruleId: string } }) => { db.writes++; const r = db.rules.find((x) => x.id === a.where.ruleId); if (r) r.days = []; return { count: 0 }; } };
  const holidayType = { findMany: async () => db.types.map((id) => ({ id })) };
  const shiftType = { findMany: async () => db.shifts.map((id) => ({ id })) };
  const tx = { holidayRule, holidayRuleDay, holidayType, shiftType, $executeRaw: async () => { db.locks++; return 0; } };
  const prisma = { ...tx, $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
    const snapshot = JSON.stringify(db.rules);
    try { return await fn(tx); } catch (e) { db.rules = JSON.parse(snapshot); throw e; }
  } };
  return { prisma };
});

import { GET, PUT } from "../holiday-rules/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const TG1 = { name: "Thanksgiving 1", holidayTypeId: "tg", days: [{ offset: 0, shiftTypeId: "call" }, { offset: 2, shiftTypeId: "call" }] };
const TG2 = { name: "Thanksgiving 2", holidayTypeId: "tg", days: [{ offset: 1, shiftTypeId: "orc" }, { offset: 3, shiftTypeId: "call" }] };

async function version(): Promise<string> {
  return ((await (await GET()).json()) as { version: string }).version;
}

beforeEach(() => {
  db.rules = [];
  db.types = ["tg"];
  db.shifts = ["call", "orc"];
  db.writes = 0;
  db.seq = 0;
  db.locks = 0;
});

describe("PUT /api/settings/holiday-rules", () => {
  it("creates the two Thanksgiving rules under the lock and returns the new version", async () => {
    const res = await PUT(req({ baseVersion: await version(), rules: [TG1, TG2] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; rules: Rule[] };
    expect(body.rules.map((r) => r.name)).toEqual(["Thanksgiving 1", "Thanksgiving 2"]);
    expect(body.rules[1].days).toEqual([{ offset: 1, shiftTypeId: "orc" }, { offset: 3, shiftTypeId: "call" }]);
    expect(body.version).toBe(await version());
    expect(db.locks).toBe(1);
  });

  it("a rename keeps the rule's id; a rule left out is deleted", async () => {
    await PUT(req({ baseVersion: await version(), rules: [TG1, TG2] }));
    const [r1] = db.rules;
    const res = await PUT(req({ baseVersion: await version(), rules: [{ ...TG1, id: r1.id, name: "Thanksgiving A" }] }));
    expect(res.status).toBe(200);
    expect(db.rules.map((r) => [r.id, r.name])).toEqual([[r1.id, "Thanksgiving A"]]);
  });

  it("two kept rules can swap names", async () => {
    await PUT(req({ baseVersion: await version(), rules: [TG1, TG2] }));
    const [a, b] = db.rules;
    const res = await PUT(req({ baseVersion: await version(), rules: [{ ...TG1, id: a.id, name: TG2.name }, { ...TG2, id: b.id, name: TG1.name }] }));
    expect(res.status).toBe(200);
    expect(db.rules.find((r) => r.id === a.id)?.name).toBe("Thanksgiving 2");
  });

  it("someone saved since: 409 and nothing written", async () => {
    const stale = await version();
    await PUT(req({ baseVersion: stale, rules: [TG1] }));
    db.writes = 0;
    const res = await PUT(req({ baseVersion: stale, rules: [TG2] }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("stale");
    expect(db.writes).toBe(0);
    expect(db.rules.map((r) => r.name)).toEqual(["Thanksgiving 1"]);
  });

  it.each([
    ["no baseVersion", { rules: [TG1] }],
    ["rules not a list", { baseVersion: "x", rules: {} }],
    ["bad id type", { baseVersion: "x", rules: [{ ...TG1, id: 5 }] }],
  ])("400 for %s", async (_l, body) => {
    expect((await PUT(req(body))).status).toBe(400);
    expect(db.writes).toBe(0);
  });

  it("invalid rules: 400 with a plain reason and nothing written", async () => {
    await PUT(req({ baseVersion: await version(), rules: [TG1] }));
    db.writes = 0;
    const res = await PUT(req({ baseVersion: await version(), rules: [{ ...TG1, days: [{ offset: 0, shiftTypeId: "call" }] }] }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("at least two days");
    expect(db.writes).toBe(0);
    expect(db.rules).toHaveLength(1);
  });

  it("a deleted shift or type is refused", async () => {
    db.shifts = ["call"];
    expect((await PUT(req({ baseVersion: await version(), rules: [TG2] }))).status).toBe(400);
    db.types = [];
    expect((await PUT(req({ baseVersion: await version(), rules: [TG1] }))).status).toBe(400);
  });
});
