import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Equity factors are linked to the shift's ID. In-memory stand-in for the tables these routes
// touch; $transaction runs the callback against the same store and restores a snapshot if it
// throws. The stand-in mimics the Phase A bridge: a created row's shiftCode is the shift's code.
type Row = { id: string; factorType: string; shiftTypeId: string | null; shiftCode: string | null; weight: number; enabled: boolean; sortOrder: number };
type Shift = { id: string; code: string; name: string };
const db = vi.hoisted(() => ({ rows: [] as Row[], shifts: [] as Shift[], staffingRows: 0, assignments: 0, seq: 0 }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } } }) }));
vi.mock("@/lib/prisma", () => {
  const codeOf = (id: string | null) => (id ? db.shifts.find((s) => s.id === id)?.code ?? null : null);
  const equityFactor = {
    findMany: async () => [...db.rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => ({ ...r })),
    count: async (a: { where: { shiftTypeId: string } }) => db.rows.filter((r) => r.shiftTypeId === a.where.shiftTypeId).length,
    deleteMany: async () => { db.rows = []; },
    createMany: async (a: { data: Omit<Row, "id" | "shiftCode">[] }) => {
      for (const d of a.data) db.rows.push({ id: `f${++db.seq}`, shiftCode: codeOf(d.shiftTypeId), ...d });
    },
  };
  const shiftType = {
    findMany: async () => db.shifts.map((s) => ({ ...s })),
    findUnique: async (a: { where: { id: string } }) => { const s = db.shifts.find((x) => x.id === a.where.id); return s ? { ...s } : null; },
    update: async (a: { where: { id: string }; data: Partial<Shift> }) => {
      const s = db.shifts.find((x) => x.id === a.where.id)!;
      Object.assign(s, a.data);
      for (const r of db.rows) if (r.shiftTypeId === s.id) r.shiftCode = s.code; // bridge B
      return { ...s };
    },
    delete: async (a: { where: { id: string } }) => { db.shifts = db.shifts.filter((x) => x.id !== a.where.id); },
  };
  const staffingRequirement = { count: async () => db.staffingRows };
  const assignment = { count: async () => db.assignments };
  const countColumn = { count: async () => 0 }; // no count columns in these scenarios (slice 3 has its own test)
  const printColumnRule = { findMany: async () => [] }; const printAggregateColumn = { findMany: async () => [] };
  const client = { equityFactor, shiftType, staffingRequirement, assignment, countColumn, printColumnRule, printAggregateColumn };
  return {
    prisma: {
      ...client,
      $transaction: async (fn: (tx: typeof client) => Promise<unknown>) => {
        const snap = { rows: structuredClone(db.rows), shifts: structuredClone(db.shifts) };
        try { return await fn(client); } catch (e) { db.rows = snap.rows; db.shifts = snap.shifts; throw e; }
      },
    },
  };
});

import { PUT as putById } from "../equity-factors/by-shift-id/route";
import { GET as getFactors } from "../equity-factors/route";
import { PUT as putShiftType, DELETE as deleteShiftType } from "../shift-types/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const ORC = "st-orc", CALL = "st-call", PAIN = "st-pain";
const shiftFactor = (shiftTypeId: string, weight = 1, enabled = true) => ({ factorType: "shift", shiftTypeId, weight, enabled });
const builtin = (factorType: string) => ({ factorType, shiftTypeId: null, weight: 1, enabled: true });

beforeEach(() => {
  db.shifts = [
    { id: ORC, code: "ORC", name: "OR Call" },
    { id: CALL, code: "CALL", name: "Call" },
    { id: PAIN, code: "PAIN", name: "Pain" },
  ];
  db.rows = [
    { id: "f-d", factorType: "desirability", shiftTypeId: null, shiftCode: null, weight: 1, enabled: true, sortOrder: 0 },
    { id: "f-orc", factorType: "shift", shiftTypeId: ORC, shiftCode: "ORC", weight: 1, enabled: true, sortOrder: 1 },
  ];
  db.staffingRows = 0;
  db.assignments = 0;
  db.seq = 0;
});

describe("GET /api/settings/equity-factors", () => {
  it("returns rows with shiftTypeId and the shift's CURRENT code", async () => {
    db.shifts[0].code = "ORCX"; // renamed; stored compat column still says ORC
    const res = await getFactors();
    const body = await res.json();
    expect(body.map((f: Row) => [f.factorType, f.shiftTypeId, f.shiftCode])).toEqual([
      ["desirability", null, null],
      ["shift", ORC, "ORCX"],
    ]);
  });
});

describe("PUT /api/settings/equity-factors/by-shift-id", () => {
  it("replaces the list by id and answers with ids + live codes", async () => {
    const res = await putById(req({ factors: [builtin("holiday"), shiftFactor(CALL, 2), shiftFactor(ORC, 1, false)] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((f: Row) => [f.factorType, f.shiftTypeId, f.shiftCode, f.weight, f.enabled, f.sortOrder])).toEqual([
      ["holiday", null, null, 1, true, 0],
      ["shift", CALL, "CALL", 2, true, 1],
      ["shift", ORC, "ORC", 1, false, 2],
    ]);
    expect(db.rows).toHaveLength(3);
  });

  it("a code where an id belongs (pre-id-link tab) → 409 stale-client, nothing written", async () => {
    const before = structuredClone(db.rows);
    const res = await putById(req({ factors: [shiftFactor("ORC")] }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("stale-client");
    expect(db.rows).toEqual(before);
  });

  it("any shiftCode key in the body → 400, nothing written", async () => {
    const before = structuredClone(db.rows);
    const res = await putById(req({ factors: [{ factorType: "shift", shiftTypeId: ORC, shiftCode: "ORC", weight: 1, enabled: true }] }));
    expect(res.status).toBe(400);
    expect(db.rows).toEqual(before);
  });

  it("unknown id → 400 unknown-shift; built-in with an id → 400; duplicate → 400; nothing written", async () => {
    const before = structuredClone(db.rows);
    expect((await putById(req({ factors: [shiftFactor("st-nope")] }))).status).toBe(400);
    expect((await (await putById(req({ factors: [shiftFactor("st-nope")] }))).json()).reason).toBe("unknown-shift");
    expect((await putById(req({ factors: [{ ...builtin("holiday"), shiftTypeId: ORC }] }))).status).toBe(400);
    expect((await putById(req({ factors: [shiftFactor(ORC), shiftFactor(ORC)] }))).status).toBe(400);
    expect((await putById(req({ factors: [builtin("holiday"), builtin("holiday")] }))).status).toBe(400);
    expect(db.rows).toEqual(before);
  });

  it("rename ORC→ORCX, create a NEW shift as ORC: a save naming the old shift's id keeps its factor on it, never on the new ORC", async () => {
    expect((await putShiftType(req({ id: ORC, code: "ORCX", name: "OR Call" }))).status).toBe(200);
    db.shifts.push({ id: "st-new", code: "ORC", name: "New" });
    const res = await putById(req({ factors: [builtin("desirability"), shiftFactor(ORC)] }));
    expect(res.status).toBe(200);
    const shiftRows = db.rows.filter((r) => r.factorType === "shift");
    expect(shiftRows).toHaveLength(1);
    expect(shiftRows[0].shiftTypeId).toBe(ORC);
    expect(shiftRows[0].shiftCode).toBe("ORCX");
    expect(db.rows.some((r) => r.shiftTypeId === "st-new")).toBe(false);
  });
});


describe("DELETE /api/settings/shift-types with an equity factor", () => {
  it("409 equity-factor-linked while a factor references the shift; 200 after it is removed", async () => {
    const res = await deleteShiftType(req({ id: ORC }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Cannot delete: Equity Factors has a row for ORC. Remove it there first.", reason: "equity-factor-linked" });
    expect(db.shifts.some((s) => s.id === ORC)).toBe(true);

    expect((await putById(req({ factors: [builtin("desirability")] }))).status).toBe(200);
    expect((await deleteShiftType(req({ id: ORC }))).status).toBe(200);
    expect(db.shifts.some((s) => s.id === ORC)).toBe(false);
  });
});
