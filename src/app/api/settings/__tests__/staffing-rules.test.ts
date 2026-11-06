import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Staffing Rules are linked to the shift's ID. In-memory stand-in for the tables these
// routes touch; $transaction runs the callback against the same store and restores a
// snapshot if it throws.
type Row = { id: string; shiftTypeId: string; dayKey: string; minCount: number; preferredCount: number; maxCount: number | null };
type Shift = { id: string; code: string; name: string };
const db = vi.hoisted(() => ({ rows: [] as Row[], shifts: [] as Shift[], assignments: 0, seq: 0 }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } } }) }));
vi.mock("@/lib/prisma", () => {
  type Where = { shiftTypeId?: string | { in: string[] }; maxCount?: unknown };
  const match = (r: Row, w?: Where) => {
    if (!w?.shiftTypeId) return true;
    return typeof w.shiftTypeId === "string" ? r.shiftTypeId === w.shiftTypeId : w.shiftTypeId.in.includes(r.shiftTypeId);
  };
  const staffingRequirement = {
    findMany: async (a?: { where?: Where }) => db.rows.filter((r) => match(r, a?.where)).map((r) => ({ ...r })),
    count: async (a: { where: Where }) => db.rows.filter((r) => match(r, a.where)).length,
    deleteMany: async (a: { where: Where }) => { db.rows = db.rows.filter((r) => !match(r, a.where)); },
    upsert: async (a: { where: { shiftTypeId_dayKey: { shiftTypeId: string; dayKey: string } }; update: Partial<Row>; create: Omit<Row, "id"> }) => {
      const k = a.where.shiftTypeId_dayKey;
      const r = db.rows.find((x) => x.shiftTypeId === k.shiftTypeId && x.dayKey === k.dayKey);
      if (r) Object.assign(r, a.update);
      else db.rows.push({ id: `r${++db.seq}`, ...a.create });
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
  const assignment = { count: async () => db.assignments };
  const client = { staffingRequirement, shiftType, assignment };
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
import { PUT as putShiftType, DELETE as deleteShiftType } from "../shift-types/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const row = (shiftTypeId: string, dayKey: string, minCount: number, preferredCount = 0, maxCount: number | null = null): Row =>
  ({ id: `${shiftTypeId}-${dayKey}`, shiftTypeId, dayKey, minCount, preferredCount, maxCount });
const get = (shiftTypeId: string, dayKey: string) => db.rows.find((r) => r.shiftTypeId === shiftTypeId && r.dayKey === dayKey);
const ORC = "st-orc", CARD = "st-card", PAIN = "st-pain", ICU = "st-icu";

beforeEach(() => {
  db.rows = [row(ORC, "1", 1, 1, 1), row(CARD, "1", 0, 0, 1), row(PAIN, "1", 0, 0, 1)];
  db.shifts = [
    { id: ORC, code: "ORC", name: "OR Call" },
    { id: CARD, code: "CARD", name: "Cardiac" },
    { id: PAIN, code: "PAIN", name: "Pain" },
    { id: ICU, code: "ICU", name: "ICU" },
  ];
  db.assignments = 0;
});

describe("Staffing Rules save (PUT /api/settings/staffing) — stale and unknown references write nothing", () => {
  it("a pre-ID tab (requirements keyed by shiftCode) gets 409 stale-client and changes nothing", async () => {
    const before = structuredClone(db.rows);
    const res = await putStaffing(req({ requirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 3 }], columns: ["ORC"] }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("stale-client");
    expect(db.rows).toEqual(before);
  });

  describe("after ICU was renamed ICUX and a new shift took the code ICU", () => {
    const ICU2 = "st-icu2";
    beforeEach(() => {
      db.shifts.find((s) => s.id === ICU)!.code = "ICUX";
      db.shifts.push({ id: ICU2, code: "ICU", name: "ICU (new)" });
      db.rows.push(row(ICU, "1", 1, 0, 1), row(ICU2, "1", 2, 0, 2));
    });

    it("a legacy removal of 'ICU' is refused; neither column is touched", async () => {
      const before = structuredClone(db.rows);
      const res = await putStaffing(req({ requirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 1 }], columns: ["ORC"], removedColumns: ["ICU"] }));
      expect(res.status).toBe(409);
      expect((await res.json()).reason).toBe("stale-client");
      expect(db.rows).toEqual(before);
    });

    it("a legacy update of 'ICU' values is refused; neither column is touched", async () => {
      const before = structuredClone(db.rows);
      const res = await putStaffing(req({ requirements: [{ shiftCode: "ICU", dayKey: "1", minCount: 0, maxCount: 9 }], columns: ["ICU"] }));
      expect(res.status).toBe(409);
      expect(db.rows).toEqual(before);
    });

    it("an id-keyed body with one CODE among removedColumns is refused before any write", async () => {
      const before = structuredClone(db.rows);
      const res = await putStaffing(req({ requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 1 }], columns: [ORC], removedColumns: ["ICU"] }));
      expect(res.status).toBe(409);
      expect((await res.json()).reason).toBe("stale-client");
      expect(db.rows).toEqual(before);
    });

    it("the renamed shift's rows keep their id and report the new code", async () => {
      const res = await putStaffing(req({ requirements: [{ shiftTypeId: ICU, dayKey: "1", minCount: 1 }], columns: [ICU] }));
      expect(res.status).toBe(200);
      const body = await res.json() as Array<{ shiftTypeId: string; shiftCode: string }>;
      expect(body.find((r) => r.shiftTypeId === ICU)?.shiftCode).toBe("ICUX");
      expect(body.find((r) => r.shiftTypeId === ICU2)?.shiftCode).toBe("ICU");
      expect(get(ICU2, "1")?.minCount).toBe(2);
    });
  });

  it("an unknown shift id in requirements, columns or removedColumns → 400 unknown-shift, nothing written", async () => {
    const before = structuredClone(db.rows);
    for (const body of [
      { requirements: [{ shiftTypeId: "st-ghost", dayKey: "1", minCount: 0 }], columns: ["st-ghost"] },
      { requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 1 }], columns: [ORC, "st-ghost"] },
      { requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 1 }], columns: [ORC], removedColumns: ["st-ghost"] },
    ]) {
      const res = await putStaffing(req(body));
      expect(res.status).toBe(400);
      expect((await res.json()).reason).toBe("unknown-shift");
    }
    expect(db.rows).toEqual(before);
  });

  it("a requirement without shiftTypeId or shiftCode is a plain 400", async () => {
    expect((await putStaffing(req({ requirements: [{ dayKey: "1", minCount: 0 }], columns: [] }))).status).toBe(400);
  });
});

describe("Staffing Rules save — behaviour by id", () => {
  it("a tab whose body lacks CARD and PAIN does not delete them", async () => {
    const res = await putStaffing(req({ requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 1 }], columns: [ORC] }));
    expect(res.status).toBe(200);
    expect(get(CARD, "1")?.maxCount).toBe(1);
    expect(get(PAIN, "1")?.maxCount).toBe(1);
  });

  it("an omitted maxCount keeps the stored Max; null clears it", async () => {
    await putStaffing(req({ requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 1 }], columns: [ORC] }));
    expect(get(ORC, "1")?.maxCount).toBe(1);
    await putStaffing(req({ requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 1, maxCount: null }], columns: [ORC] }));
    expect(get(ORC, "1")?.maxCount).toBeNull();
  });

  it("deletes only the columns named in removedColumns", async () => {
    await putStaffing(req({ requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 1 }], columns: [ORC], removedColumns: [CARD] }));
    expect(get(CARD, "1")).toBeUndefined();
    expect(get(PAIN, "1")).toBeDefined();
  });

  it("a column swap (CARD out, ICU in) removes one and adds the other with its Max", async () => {
    await putStaffing(req({
      requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 1 }, { shiftTypeId: ICU, dayKey: "1", minCount: 0, maxCount: 2 }],
      columns: [ORC, ICU, PAIN], removedColumns: [CARD],
    }));
    expect(get(CARD, "1")).toBeUndefined();
    expect(get(ICU, "1")?.maxCount).toBe(2);
  });

  it("undo (re-sending the earlier rows, removing the added column) restores them", async () => {
    await putStaffing(req({ requirements: [{ shiftTypeId: ICU, dayKey: "1", minCount: 0, maxCount: 2 }], columns: [ICU], removedColumns: [CARD] }));
    await putStaffing(req({
      requirements: [{ shiftTypeId: CARD, dayKey: "1", minCount: 0, preferredCount: 0, maxCount: 1 }],
      columns: [ORC, CARD, PAIN], removedColumns: [ICU],
    }));
    expect(get(ICU, "1")).toBeUndefined();
    expect(get(CARD, "1")?.maxCount).toBe(1);
  });

  it("a column named in removedColumns that is also sent is kept, not deleted", async () => {
    await putStaffing(req({ requirements: [{ shiftTypeId: CARD, dayKey: "1", minCount: 0 }], columns: [CARD], removedColumns: [CARD] }));
    expect(get(CARD, "1")).toBeDefined();
  });

  it("refuses Min above Max and Preferred above Max, naming the shift, and writes nothing", async () => {
    const before = structuredClone(db.rows);
    const a = await putStaffing(req({ requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 2, maxCount: 1 }], columns: [ORC], removedColumns: [CARD] }));
    expect(a.status).toBe(400);
    expect(await a.json()).toMatchObject({ reason: "above-max", shiftTypeId: ORC, shiftCode: "ORC", dayKey: "1" });
    const b = await putStaffing(req({ requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 0, preferredCount: 3, maxCount: 2 }], columns: [ORC] }));
    expect(b.status).toBe(400);
    expect(db.rows).toEqual(before);
  });

  it("checks Min against the STORED Max when the body omits Max", async () => {
    const res = await putStaffing(req({ requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 2 }], columns: [ORC] }));
    expect(res.status).toBe(400);
    expect(get(ORC, "1")?.minCount).toBe(1);
  });

  it("rejects a negative or fractional Max, and a malformed removedColumns", async () => {
    expect((await putStaffing(req({ requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 0, maxCount: -1 }], columns: [] }))).status).toBe(400);
    expect((await putStaffing(req({ requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 0, maxCount: 1.5 }], columns: [] }))).status).toBe(400);
    expect((await putStaffing(req({ requirements: [], columns: [], removedColumns: CARD }))).status).toBe(400);
    expect(get(CARD, "1")).toBeDefined();
  });

  it("allows Max 0 (none that day) with Min 0, and the response carries id and current code", async () => {
    const res = await putStaffing(req({ requirements: [{ shiftTypeId: ORC, dayKey: "6", minCount: 0, maxCount: 0 }], columns: [ORC] }));
    expect(res.status).toBe(200);
    expect(get(ORC, "6")?.maxCount).toBe(0);
    const body = await res.json() as Array<{ shiftTypeId: string; shiftCode: string; dayKey: string }>;
    expect(body.find((r) => r.shiftTypeId === ORC && r.dayKey === "6")?.shiftCode).toBe("ORC");
  });
});

describe("Shift Types rename (PUT /api/settings/shift-types)", () => {
  it("does not touch Staffing Rules rows: same ids, same values, and they now show the new code", async () => {
    const before = structuredClone(db.rows);
    const res = await putShiftType(req({ id: ORC, code: "ORC2" }));
    expect(res.status).toBe(200);
    expect(db.rows).toEqual(before);
    expect(db.shifts.find((s) => s.id === ORC)?.code).toBe("ORC2");
    const staffing = await putStaffing(req({ requirements: [{ shiftTypeId: ORC, dayKey: "1", minCount: 1 }], columns: [ORC] }));
    const body = await staffing.json() as Array<{ shiftTypeId: string; shiftCode: string }>;
    expect(body.find((r) => r.shiftTypeId === ORC)?.shiftCode).toBe("ORC2");
  });

  it("renaming onto a code another column once used is no longer a staffing clash", async () => {
    db.shifts = db.shifts.filter((s) => s.id !== CARD); // CARD's shift is gone; its rows are not (legacy data)
    const res = await putShiftType(req({ id: ORC, code: "CARD" }));
    expect(res.status).toBe(200);
    expect(get(ORC, "1")?.maxCount).toBe(1);
  });

  it("ignores an old client's maxPerDay field", async () => {
    const res = await putShiftType(req({ id: ORC, maxPerDay: 3 }));
    expect(res.status).toBe(400); // no editable field left
    expect(get(ORC, "1")?.maxCount).toBe(1);
  });

  it("404 for a missing shift type", async () => {
    expect((await putShiftType(req({ id: "nope", name: "x" }))).status).toBe(404);
  });
});

describe("Shift Types delete (DELETE /api/settings/shift-types)", () => {
  it("is refused while the shift has a Staffing Rules column, and nothing is deleted", async () => {
    const res = await deleteShiftType(req({ id: ORC }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "staffing-rules-linked" });
    expect((await res.json().catch(() => null)) ?? true).toBeTruthy();
    expect(db.shifts.find((s) => s.id === ORC)).toBeDefined();
    expect(get(ORC, "1")).toBeDefined();
  });

  it("names the shift in the message", async () => {
    const res = await deleteShiftType(req({ id: ORC }));
    expect((await res.json()).error).toContain("ORC");
  });

  it("the assignment check still wins first", async () => {
    db.assignments = 4;
    const res = await deleteShiftType(req({ id: ORC }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("4 assignments");
  });

  it("succeeds once the column has been removed", async () => {
    await putStaffing(req({ requirements: [], columns: [], removedColumns: [ICU, ORC] }));
    const res = await deleteShiftType(req({ id: ORC }));
    expect(res.status).toBe(200);
    expect(db.shifts.find((s) => s.id === ORC)).toBeUndefined();
  });
});
