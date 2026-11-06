import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Count columns are linked to the shifts' IDs. In-memory stand-in for the tables these routes
// touch; $transaction runs the callback against the same store and restores a snapshot if it
// throws. Rows hold only the ids (Phase B dropped the compat code column); codes are derived at read time.
type Row = { id: string; label: string; sortOrder: number; shiftTypeIds: string[] };
type Shift = { id: string; code: string; name: string };
const db = vi.hoisted(() => ({ rows: [] as Row[], shifts: [] as Shift[], seq: 0 }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } } }) }));
vi.mock("@/lib/prisma", () => {
  const countColumn = {
    findMany: async () => [...db.rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => ({ ...r, shiftTypeIds: [...r.shiftTypeIds] })),
    count: async (a: { where: { shiftTypeIds: { has: string } } }) => db.rows.filter((r) => r.shiftTypeIds.includes(a.where.shiftTypeIds.has)).length,
    deleteMany: async () => { db.rows = []; },
    createMany: async (a: { data: Omit<Row, "id">[] }) => {
      for (const d of a.data) db.rows.push({ id: `c${++db.seq}`, ...d });
    },
  };
  const shiftType = {
    findMany: async () => db.shifts.map((s) => ({ ...s })),
    findUnique: async (a: { where: { id: string } }) => { const s = db.shifts.find((x) => x.id === a.where.id); return s ? { ...s } : null; },
    update: async (a: { where: { id: string }; data: Partial<Shift> }) => {
      const s = db.shifts.find((x) => x.id === a.where.id)!;
      Object.assign(s, a.data);
      return { ...s };
    },
    delete: async (a: { where: { id: string } }) => { db.shifts = db.shifts.filter((x) => x.id !== a.where.id); },
  };
  const staffingRequirement = { count: async () => 0 };
  const equityFactor = { count: async () => 0 };
  const assignment = { count: async () => 0 };
  const printColumnRule = { findMany: async () => [] }; const printAggregateColumn = { findMany: async () => [] };
  const client = { countColumn, shiftType, staffingRequirement, equityFactor, assignment, printColumnRule, printAggregateColumn };
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

import { PUT as putById } from "../count-columns/by-shift-id/route";
import { GET as getColumns, PUT as putLegacy } from "../count-columns/route";
import { PUT as putShiftType, DELETE as deleteShiftType } from "../shift-types/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const OR = "st-or", ORC = "st-orc", ORL = "st-orl", PAIN = "st-pain";
const col = (label: string, shiftTypeIds: string[]) => ({ label, shiftTypeIds });

beforeEach(() => {
  db.shifts = [
    { id: OR, code: "OR", name: "OR" },
    { id: ORC, code: "ORC", name: "OR Call" },
    { id: ORL, code: "ORL", name: "OR Late" },
    { id: PAIN, code: "PAIN", name: "Pain" },
  ];
  db.rows = [{ id: "c-or", label: "OR", sortOrder: 0, shiftTypeIds: [OR, ORC, ORL] }];
  db.seq = 0;
});

describe("GET /api/settings/count-columns", () => {
  it("returns rows with shiftTypeIds and the shifts' CURRENT codes, in order", async () => {
    db.shifts[1].code = "ORCX"; // renamed
    const body = await (await getColumns()).json();
    expect(body).toEqual([{ id: "c-or", label: "OR", sortOrder: 0, shiftTypeIds: [OR, ORC, ORL], shiftCodes: ["OR", "ORCX", "ORL"] }]);
  });
});

describe("PUT /api/settings/count-columns/by-shift-id", () => {
  it("replaces the list by id, keeps the shift order, answers with ids + live codes", async () => {
    const res = await putById(req({ columns: [col("Call", [ORC]), col("OR", [ORL, OR])] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((c: Row & { shiftCodes: string[] }) => [c.label, c.sortOrder, c.shiftTypeIds, c.shiftCodes])).toEqual([
      ["Call", 0, [ORC], ["ORC"]],
      ["OR", 1, [ORL, OR], ["ORL", "OR"]],
    ]);
    expect(db.rows).toHaveLength(2);
  });

  it("an empty list clears every column", async () => {
    expect((await putById(req({ columns: [] }))).status).toBe(200);
    expect(db.rows).toEqual([]);
  });

  it("a code where an id belongs (pre-id-link tab) → 409 stale-client, nothing written", async () => {
    const before = structuredClone(db.rows);
    const res = await putById(req({ columns: [col("OR", ["OR", "ORC"])] }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("stale-client");
    expect(db.rows).toEqual(before);
  });

  it("any shiftCodes key in a column → 400, nothing written", async () => {
    const before = structuredClone(db.rows);
    const res = await putById(req({ columns: [{ label: "OR", shiftTypeIds: [OR], shiftCodes: ["OR"] }] }));
    expect(res.status).toBe(400);
    expect(db.rows).toEqual(before);
  });

  it("unknown id → 400 unknown-shift; duplicate id → 400; empty label → 400; bad shapes → 400; nothing written", async () => {
    const before = structuredClone(db.rows);
    const unknown = await putById(req({ columns: [col("OR", ["st-nope"])] }));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).reason).toBe("unknown-shift");
    expect((await putById(req({ columns: [col("OR", [OR, OR])] }))).status).toBe(400);
    expect((await putById(req({ columns: [col("  ", [OR])] }))).status).toBe(400);
    expect((await putById(req({ columns: [{ label: "OR", shiftTypeIds: "OR" }] }))).status).toBe(400);
    expect((await putById(req({ columns: [{ label: "OR", shiftTypeIds: [1] }] }))).status).toBe(400);
    expect((await putById(req({ columns: "nope" }))).status).toBe(400);
    expect((await putById(req({}))).status).toBe(400);
    expect(db.rows).toEqual(before);
  });

  it("rename ORC→ORCX, create a NEW shift as ORC: a save naming the old shift's id keeps the column on it, never on the new ORC", async () => {
    expect((await putShiftType(req({ id: ORC, code: "ORCX", name: "OR Call" }))).status).toBe(200);
    db.shifts.push({ id: "st-new", code: "ORC", name: "New" });
    const res = await putById(req({ columns: [col("OR", [OR, ORC, ORL])] }));
    expect(res.status).toBe(200);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].shiftTypeIds).toEqual([OR, ORC, ORL]);
    expect((await res.json())[0].shiftCodes).toEqual(["OR", "ORCX", "ORL"]);
    expect(db.rows[0].shiftTypeIds).not.toContain("st-new");
  });
});

describe("PUT /api/settings/count-columns (legacy path)", () => {
  it("is a refusal stub: 409 stale-client whatever the body (it never reads one), store untouched", async () => {
    const before = structuredClone(db.rows);
    const res = await putLegacy();
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("stale-client");
    expect(db.rows).toEqual(before);
  });
});

describe("DELETE /api/settings/shift-types", () => {
  it("409 count-column-linked while a column names the shift; 200 after the column drops it", async () => {
    const res = await deleteShiftType(req({ id: ORL }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Cannot delete: Count Columns has a column using ORL. Remove it there first.", reason: "count-column-linked" });
    expect(db.shifts.some((s) => s.id === ORL)).toBe(true);

    expect((await putById(req({ columns: [col("OR", [OR, ORC])] }))).status).toBe(200);
    expect((await deleteShiftType(req({ id: ORL }))).status).toBe(200);
    expect(db.shifts.some((s) => s.id === ORL)).toBe(false);
  });

  it("a shift no column names deletes normally", async () => {
    expect((await deleteShiftType(req({ id: PAIN }))).status).toBe(200);
  });
});
