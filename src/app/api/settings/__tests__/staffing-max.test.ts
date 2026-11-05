import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// In-memory stand-in for the two tables these routes touch. $transaction runs the
// callback against the same store and restores a snapshot if it throws.
type Row = { id: string; shiftCode: string; dayKey: string; minCount: number; preferredCount: number; maxCount: number | null };
type Shift = { id: string; code: string; name: string };
const db = vi.hoisted(() => ({ rows: [] as Row[], shifts: [] as Shift[], seq: 0 }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } } }) }));
vi.mock("@/lib/prisma", () => {
  type Where = { shiftCode?: string | { in: string[] } };
  const match = (r: Row, w?: Where) => {
    if (!w?.shiftCode) return true;
    return typeof w.shiftCode === "string" ? r.shiftCode === w.shiftCode : w.shiftCode.in.includes(r.shiftCode);
  };
  const staffingRequirement = {
    findMany: async (a?: { where?: Where }) => db.rows.filter((r) => match(r, a?.where)).map((r) => ({ ...r })),
    count: async (a: { where: Where }) => db.rows.filter((r) => match(r, a.where)).length,
    deleteMany: async (a: { where: Where }) => { db.rows = db.rows.filter((r) => !match(r, a.where)); },
    updateMany: async (a: { where: Where; data: Partial<Row> }) => {
      for (const r of db.rows) if (match(r, a.where)) Object.assign(r, a.data);
    },
    upsert: async (a: { where: { shiftCode_dayKey: { shiftCode: string; dayKey: string } }; update: Partial<Row>; create: Omit<Row, "id"> }) => {
      const k = a.where.shiftCode_dayKey;
      const r = db.rows.find((x) => x.shiftCode === k.shiftCode && x.dayKey === k.dayKey);
      if (r) Object.assign(r, a.update);
      else db.rows.push({ id: `r${++db.seq}`, ...a.create });
    },
  };
  const shiftType = {
    findUnique: async (a: { where: { id: string } }) => { const s = db.shifts.find((x) => x.id === a.where.id); return s ? { ...s } : null; },
    update: async (a: { where: { id: string }; data: Partial<Shift> }) => {
      const s = db.shifts.find((x) => x.id === a.where.id)!;
      Object.assign(s, a.data);
      return { ...s };
    },
  };
  const client = { staffingRequirement, shiftType };
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

import { PUT as putStaffing } from "../staffing/route";
import { PUT as putShiftType } from "../shift-types/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const row = (shiftCode: string, dayKey: string, minCount: number, preferredCount = 0, maxCount: number | null = null): Row =>
  ({ id: `${shiftCode}-${dayKey}`, shiftCode, dayKey, minCount, preferredCount, maxCount });
const get = (code: string, dayKey: string) => db.rows.find((r) => r.shiftCode === code && r.dayKey === dayKey);

beforeEach(() => {
  db.rows = [row("ORC", "1", 1, 1, 1), row("CARD", "1", 0, 0, 1), row("PAIN", "1", 0, 0, 1)];
  db.shifts = [{ id: "st-orc", code: "ORC", name: "OR Call" }];
});

describe("Staffing Rules save (PUT /api/settings/staffing)", () => {
  it("an old tab whose body lacks CARD and PAIN does not delete them", async () => {
    const res = await putStaffing(req({ requirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 1 }], columns: ["ORC"] }));
    expect(res.status).toBe(200);
    expect(get("CARD", "1")?.maxCount).toBe(1);
    expect(get("PAIN", "1")?.maxCount).toBe(1);
  });

  it("an omitted maxCount keeps the stored Max; null clears it", async () => {
    await putStaffing(req({ requirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 1 }], columns: ["ORC"] }));
    expect(get("ORC", "1")?.maxCount).toBe(1);
    await putStaffing(req({ requirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 1, maxCount: null }], columns: ["ORC"] }));
    expect(get("ORC", "1")?.maxCount).toBeNull();
  });

  it("deletes only the columns named in removedColumns", async () => {
    await putStaffing(req({ requirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 1 }], columns: ["ORC"], removedColumns: ["CARD"] }));
    expect(get("CARD", "1")).toBeUndefined();
    expect(get("PAIN", "1")).toBeDefined();
  });

  it("a column swap (CARD out, ICU in) removes one and adds the other with its Max", async () => {
    await putStaffing(req({
      requirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 1 }, { shiftCode: "ICU", dayKey: "1", minCount: 0, maxCount: 2 }],
      columns: ["ORC", "ICU", "PAIN"], removedColumns: ["CARD"],
    }));
    expect(get("CARD", "1")).toBeUndefined();
    expect(get("ICU", "1")?.maxCount).toBe(2);
  });

  it("undo (re-sending the earlier rows, removing the added column) restores them", async () => {
    await putStaffing(req({ requirements: [{ shiftCode: "ICU", dayKey: "1", minCount: 0, maxCount: 2 }], columns: ["ICU"], removedColumns: ["CARD"] }));
    await putStaffing(req({
      requirements: [{ shiftCode: "CARD", dayKey: "1", minCount: 0, preferredCount: 0, maxCount: 1 }],
      columns: ["ORC", "CARD", "PAIN"], removedColumns: ["ICU"],
    }));
    expect(get("ICU", "1")).toBeUndefined();
    expect(get("CARD", "1")?.maxCount).toBe(1);
  });

  it("a column named in removedColumns that is also sent is kept, not deleted", async () => {
    await putStaffing(req({ requirements: [{ shiftCode: "CARD", dayKey: "1", minCount: 0 }], columns: ["CARD"], removedColumns: ["CARD"] }));
    expect(get("CARD", "1")).toBeDefined();
  });

  it("refuses Min above Max and Preferred above Max, and writes nothing", async () => {
    const before = structuredClone(db.rows);
    const a = await putStaffing(req({ requirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 2, maxCount: 1 }], columns: ["ORC"], removedColumns: ["CARD"] }));
    expect(a.status).toBe(400);
    expect((await a.json()).reason).toBe("above-max");
    const b = await putStaffing(req({ requirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 0, preferredCount: 3, maxCount: 2 }], columns: ["ORC"] }));
    expect(b.status).toBe(400);
    expect(db.rows).toEqual(before);
  });

  it("checks Min against the STORED Max when the body omits Max", async () => {
    const res = await putStaffing(req({ requirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 2 }], columns: ["ORC"] }));
    expect(res.status).toBe(400);
    expect(get("ORC", "1")?.minCount).toBe(1);
  });

  it("rejects a negative or fractional Max, and a malformed removedColumns", async () => {
    expect((await putStaffing(req({ requirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 0, maxCount: -1 }], columns: [] }))).status).toBe(400);
    expect((await putStaffing(req({ requirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 0, maxCount: 1.5 }], columns: [] }))).status).toBe(400);
    expect((await putStaffing(req({ requirements: [], columns: [], removedColumns: "CARD" }))).status).toBe(400);
    expect(get("CARD", "1")).toBeDefined();
  });

  it("allows Max 0 (none that day) with Min 0", async () => {
    const res = await putStaffing(req({ requirements: [{ shiftCode: "ORC", dayKey: "6", minCount: 0, maxCount: 0 }], columns: ["ORC"] }));
    expect(res.status).toBe(200);
    expect(get("ORC", "6")?.maxCount).toBe(0);
  });
});

describe("Shift Types rename (PUT /api/settings/shift-types)", () => {
  it("carries the shift's Staffing Rules rows (Min, Preferred, Max) to the new code", async () => {
    const res = await putShiftType(req({ id: "st-orc", code: "ORC2" }));
    expect(res.status).toBe(200);
    expect(get("ORC", "1")).toBeUndefined();
    expect(get("ORC2", "1")).toMatchObject({ minCount: 1, preferredCount: 1, maxCount: 1 });
    expect(db.shifts[0].code).toBe("ORC2");
  });

  it("refuses with 409 when rows for the new code already exist, changing nothing", async () => {
    const res = await putShiftType(req({ id: "st-orc", code: "CARD" }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("staffing-code-clash");
    expect(db.shifts[0].code).toBe("ORC");
    expect(get("ORC", "1")?.maxCount).toBe(1);
  });

  it("ignores an old client's maxPerDay field", async () => {
    const res = await putShiftType(req({ id: "st-orc", maxPerDay: 3 }));
    expect(res.status).toBe(400); // no editable field left
    expect(get("ORC", "1")?.maxCount).toBe(1);
  });

  it("404 for a missing shift type", async () => {
    expect((await putShiftType(req({ id: "nope", name: "x" }))).status).toBe(404);
  });
});
