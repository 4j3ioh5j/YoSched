import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Printed-schedule column rules and aggregate columns name shifts by ID inside their
// conditions. In-memory stand-in for the tables these routes touch; $transaction runs the
// callback against the same store and restores a snapshot if it throws. Rows hold conditions
// with ids only (the DB bridge's compat code keys are not modelled; codes are derived on read).
type Cond = { quantifier: string; categories: string[]; shiftTypeIds: string[]; exceptIds: string[] };
type Rule = { id: string; label: string; sortOrder: number; enabled: boolean; mode: string; employmentTypeIds: string[]; minFtePercentage: number | null; maxFtePercentage: number | null; conditions: Cond[] };
type Agg = { id: string; label: string; sortOrder: number; enabled: boolean; suppressMembers: boolean; isOther: boolean; employmentTypeIds: string[]; minFtePercentage: number | null; maxFtePercentage: number | null; conditions: Cond[]; conditionScope: string };
type Shift = { id: string; code: string; name: string };
const db = vi.hoisted(() => ({ rules: [] as Rule[], aggs: [] as Agg[], shifts: [] as Shift[], seq: 0 }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } } }) }));
vi.mock("@/lib/prisma", () => {
  const clone = <T,>(x: T): T => structuredClone(x);
  const printColumnRule = {
    findMany: async () => clone([...db.rules].sort((a, b) => a.sortOrder - b.sortOrder)),
    deleteMany: async () => { db.rules = []; },
    createMany: async (a: { data: Omit<Rule, "id">[] }) => { for (const d of a.data) db.rules.push({ id: `r${++db.seq}`, ...clone(d) }); },
  };
  const printAggregateColumn = {
    findMany: async () => clone([...db.aggs].sort((a, b) => a.sortOrder - b.sortOrder)),
    deleteMany: async () => { db.aggs = []; },
    createMany: async (a: { data: Omit<Agg, "id">[] }) => { for (const d of a.data) db.aggs.push({ id: `g${++db.seq}`, ...clone(d) }); },
  };
  const shiftType = {
    findMany: async () => db.shifts.map((s) => ({ ...s })),
    findUnique: async (a: { where: { id: string } }) => { const s = db.shifts.find((x) => x.id === a.where.id); return s ? { ...s } : null; },
    update: async (a: { where: { id: string }; data: Partial<Shift> }) => { const s = db.shifts.find((x) => x.id === a.where.id)!; Object.assign(s, a.data); return { ...s }; },
    delete: async (a: { where: { id: string } }) => { db.shifts = db.shifts.filter((x) => x.id !== a.where.id); },
  };
  const zero = { count: async () => 0 };
  const client = { printColumnRule, printAggregateColumn, shiftType, staffingRequirement: zero, equityFactor: zero, countColumn: zero, assignment: zero };
  return {
    prisma: {
      ...client,
      $transaction: async (fn: (tx: typeof client) => Promise<unknown>) => {
        const snap = { rules: clone(db.rules), aggs: clone(db.aggs), shifts: clone(db.shifts) };
        try { return await fn(client); } catch (e) { db.rules = snap.rules; db.aggs = snap.aggs; db.shifts = snap.shifts; throw e; }
      },
    },
  };
});

import { PUT as putRulesById } from "../print-column-rules/by-shift-id/route";
import { GET as getRules } from "../print-column-rules/route";
import { PUT as putAggById } from "../print-aggregate-columns/by-shift-id/route";
import { GET as getAggs } from "../print-aggregate-columns/route";
import { PUT as putShiftType, DELETE as deleteShiftType } from "../shift-types/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const OR = "st-or", ICU = "st-icu", CARD = "st-card", AL = "st-al";
const cond = (shiftTypeIds: string[], exceptIds: string[] = [], over: Partial<Cond> = {}): Cond => ({ quantifier: "has_any", categories: [], shiftTypeIds, exceptIds, ...over });
const rule = (label: string, conditions: Cond[], over: Partial<Rule> = {}) => ({ label, enabled: true, mode: "include", employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions, ...over });
const agg = (label: string, conditions: Cond[], over: Partial<Agg> = {}) => ({ label, enabled: true, suppressMembers: true, isOther: false, employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions, conditionScope: "month", ...over });

beforeEach(() => {
  db.shifts = [
    { id: OR, code: "OR", name: "OR" },
    { id: ICU, code: "ICU", name: "ICU" },
    { id: CARD, code: "CARD", name: "Cardiac" },
    { id: AL, code: "AL", name: "Annual leave" },
  ];
  db.rules = [{ id: "r-icu", ...rule("ICU team", [cond([], [ICU, CARD], { quantifier: "has_none", categories: ["work"] })]), sortOrder: 0 }];
  db.aggs = [
    { id: "g-or", ...agg("OR day", [cond([OR], [], {})], { conditionScope: "day", suppressMembers: false }), sortOrder: 0 },
    { id: "g-other", ...agg("Other", [], { isOther: true, suppressMembers: false }), sortOrder: 1 },
  ];
  db.seq = 0;
});

describe("GET (both tables)", () => {
  it("serves conditions with ids and the shifts' CURRENT codes derived alongside", async () => {
    db.shifts[1].code = "ICUX"; // renamed
    const rules = await (await getRules()).json();
    expect(rules[0].conditions).toEqual([{ quantifier: "has_none", categories: ["work"], shiftTypeIds: [], exceptIds: [ICU, CARD], codes: [], except: ["ICUX", "CARD"] }]);
    const aggs = await (await getAggs()).json();
    expect(aggs[0].conditions).toEqual([{ quantifier: "has_any", categories: [], shiftTypeIds: [OR], exceptIds: [], codes: ["OR"], except: [] }]);
    expect(aggs[1].conditions).toEqual([]);
  });
});

describe("PUT /api/settings/print-column-rules/by-shift-id", () => {
  it("replaces the list by id, keeps the non-shift fields, answers with ids + live codes", async () => {
    const res = await putRulesById(req({ rules: [
      rule("FB out", [], { mode: "exclude", employmentTypeIds: ["et-fb"] }),
      rule("OR or ICU", [cond([OR, ICU]), cond([], [AL], { quantifier: "has_none", categories: ["leave"] })], { minFtePercentage: 0.5 }),
    ] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((r: Rule) => [r.label, r.sortOrder, r.mode, r.employmentTypeIds, r.minFtePercentage])).toEqual([["FB out", 0, "exclude", ["et-fb"], null], ["OR or ICU", 1, "include", [], 0.5]]);
    expect(body[1].conditions).toEqual([
      { quantifier: "has_any", categories: [], shiftTypeIds: [OR, ICU], exceptIds: [], codes: ["OR", "ICU"], except: [] },
      { quantifier: "has_none", categories: ["leave"], shiftTypeIds: [], exceptIds: [AL], codes: [], except: ["AL"] },
    ]);
    expect(db.rules).toHaveLength(2);
    expect(db.rules[1].conditions[0].shiftTypeIds).toEqual([OR, ICU]);
  });

  it("drops selector-less conditions; an empty list clears every rule", async () => {
    expect((await putRulesById(req({ rules: [rule("x", [cond([], [], { quantifier: "has_none" })])] }))).status).toBe(200);
    expect(db.rules[0].conditions).toEqual([]);
    expect((await putRulesById(req({ rules: [] }))).status).toBe(200);
    expect(db.rules).toEqual([]);
  });

  it("a code where an id belongs (pre-id-link tab) → 409 stale-client, nothing written", async () => {
    const before = structuredClone(db.rules);
    const res = await putRulesById(req({ rules: [rule("x", [cond(["OR"])])] }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("stale-client");
    expect(db.rules).toEqual(before);
  });

  it("a codes/except key, a legacy shiftCodes/shiftMatch key, an unknown id, a duplicate, bad shapes → 400, nothing written", async () => {
    const before = structuredClone(db.rules);
    expect((await putRulesById(req({ rules: [rule("x", [{ quantifier: "has_any", categories: [], codes: ["OR"], except: [] } as unknown as Cond])] }))).status).toBe(400);
    expect((await putRulesById(req({ rules: [{ ...rule("x", []), shiftCodes: ["OR"], shiftMatch: "any" }] }))).status).toBe(400);
    const unknown = await putRulesById(req({ rules: [rule("x", [cond(["st-nope"])])] }));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).reason).toBe("unknown-shift");
    expect((await putRulesById(req({ rules: [rule("x", [cond([OR, OR])])] }))).status).toBe(400);
    expect((await putRulesById(req({ rules: [rule("x", "nope" as unknown as Cond[])] }))).status).toBe(400);
    expect((await putRulesById(req({ rules: ["nope"] }))).status).toBe(400);
    expect((await putRulesById(req({}))).status).toBe(400);
    expect(db.rules).toEqual(before);
  });

  it("rename ICU→ICUX, create a NEW shift as ICU: a save naming the old shift's id keeps the rule on it, never on the new ICU", async () => {
    expect((await putShiftType(req({ id: ICU, code: "ICUX", name: "ICU" }))).status).toBe(200);
    db.shifts.push({ id: "st-new", code: "ICU", name: "New" });
    const res = await putRulesById(req({ rules: [rule("ICU team", [cond([], [ICU, CARD], { quantifier: "has_none", categories: ["work"] })])] }));
    expect(res.status).toBe(200);
    expect(db.rules[0].conditions[0].exceptIds).toEqual([ICU, CARD]);
    expect((await res.json())[0].conditions[0].except).toEqual(["ICUX", "CARD"]);
    expect(JSON.stringify(db.rules)).not.toContain("st-new");
  });
});

describe("PUT /api/settings/print-aggregate-columns/by-shift-id", () => {
  it("replaces the list by id; catch-all columns are sanitised (no rule, no suppression, month scope)", async () => {
    const res = await putAggById(req({ columns: [
      agg("ICU", [cond([ICU])], { conditionScope: "day" }),
      null,
      agg("Rest", [cond([OR])], { isOther: true, suppressMembers: true, employmentTypeIds: ["et"], minFtePercentage: 0.5, conditionScope: "day" }),
    ] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((c: Agg) => [c.label, c.sortOrder, c.isOther, c.suppressMembers, c.conditionScope, c.employmentTypeIds, c.minFtePercentage])).toEqual([
      ["ICU", 0, false, true, "day", [], null],
      ["Rest", 1, true, false, "month", [], null],
    ]);
    expect(body[0].conditions).toEqual([{ quantifier: "has_any", categories: [], shiftTypeIds: [ICU], exceptIds: [], codes: ["ICU"], except: [] }]);
    expect(body[1].conditions).toEqual([]);
  });

  it("code-as-id → 409 even on a catch-all column (stale tab); codes key → 400; unknown id → 400; nothing written", async () => {
    const before = structuredClone(db.aggs);
    expect((await putAggById(req({ columns: [agg("x", [cond(["OR"])], { isOther: true })] }))).status).toBe(409);
    expect((await putAggById(req({ columns: [agg("x", [{ quantifier: "has_any", categories: [], codes: ["OR"], except: [] } as unknown as Cond])] }))).status).toBe(400);
    expect((await putAggById(req({ columns: [agg("x", [cond(["st-nope"])])] }))).status).toBe(400);
    expect((await putAggById(req({ columns: "nope" }))).status).toBe(400);
    expect(db.aggs).toEqual(before);
  });
});


describe("DELETE /api/settings/shift-types", () => {
  it("409 print-column-linked while a rule (even via exceptIds) or an aggregate column names the shift; 200 after removal", async () => {
    const r1 = await deleteShiftType(req({ id: CARD })); // named only in the rule's exceptIds
    expect(r1.status).toBe(409);
    expect(await r1.json()).toEqual({ error: "Cannot delete: Printed Schedule Columns has a rule using CARD. Remove it there first.", reason: "print-column-linked" });
    const r2 = await deleteShiftType(req({ id: OR })); // named by the aggregate column
    expect(r2.status).toBe(409);
    expect((await r2.json()).reason).toBe("print-column-linked");
    expect(db.shifts).toHaveLength(4);

    expect((await putAggById(req({ columns: [agg("Other", [], { isOther: true })] }))).status).toBe(200);
    expect((await deleteShiftType(req({ id: OR }))).status).toBe(200);
    expect((await deleteShiftType(req({ id: AL }))).status).toBe(200); // never referenced
    expect((await deleteShiftType(req({ id: CARD }))).status).toBe(409); // still in the rule
  });
});
