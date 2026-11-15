import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #260: "Minimum days between two" on a shift type. Strict on write; a save that
// doesn't mention it leaves it alone; a new shift starts with it off and Prefer.

type Shift = Record<string, unknown> & { id: string };
const db = vi.hoisted(() => ({ shifts: [] as Shift[], created: null as Record<string, unknown> | null }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } }, userId: "u", permissions: ["settings:edit"], staffId: null }) }));
vi.mock("@/lib/prisma", () => {
  const shiftType = {
    findUnique: async (a: { where: { id: string } }) => { const s = db.shifts.find((x) => x.id === a.where.id); return s ? { ...s } : null; },
    findFirst: async () => null,
    update: async (a: { where: { id: string }; data: Record<string, unknown> }) => { const s = db.shifts.find((x) => x.id === a.where.id)!; Object.assign(s, a.data); return { ...s }; },
    aggregate: async () => ({ _max: { sortOrder: 3 } }),
    create: async (a: { data: Record<string, unknown> }) => { db.created = a.data; return { id: "new", ...a.data }; },
  };
  const client = { shiftType };
  return { prisma: { ...client, $transaction: async (fn: (tx: typeof client) => Promise<unknown>) => fn(client) } };
});

import { PUT, POST } from "../shift-types/route";
import { SHIFT_TYPE_EDITABLE_FIELDS, minGapError } from "@/lib/shift-type-fields";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  db.shifts = [{ id: "st-orl", code: "ORL", name: "ORL", minGapDays: 5, minGapStrength: "rule" }];
  db.created = null;
});

describe("Minimum days between two (shift type, card #260)", () => {
  it("both fields are editable (PUT and the activation save share the list)", () => {
    expect(SHIFT_TYPE_EDITABLE_FIELDS).toContain("minGapDays");
    expect(SHIFT_TYPE_EDITABLE_FIELDS).toContain("minGapStrength");
  });

  it("saves a number and a strength; null turns it off", async () => {
    expect((await PUT(req({ id: "st-orl", minGapDays: 7, minGapStrength: "preference" }))).status).toBe(200);
    expect(db.shifts[0]).toMatchObject({ minGapDays: 7, minGapStrength: "preference" });
    expect((await PUT(req({ id: "st-orl", minGapDays: null }))).status).toBe(200);
    expect(db.shifts[0].minGapDays).toBeNull();
  });

  it.each([1, 0, 61, 2.5, "5", "x", true])("rejects minGapDays %j with 400 and writes nothing", async (bad) => {
    const res = await PUT(req({ id: "st-orl", minGapDays: bad }));
    expect(res.status).toBe(400);
    expect(db.shifts[0].minGapDays).toBe(5);
  });

  it.each(["hard", "", null, 1])("rejects minGapStrength %j with 400", async (bad) => {
    expect((await PUT(req({ id: "st-orl", minGapStrength: bad }))).status).toBe(400);
    expect(db.shifts[0].minGapStrength).toBe("rule");
  });

  it("a save that doesn't mention them (an older page) keeps them", async () => {
    expect((await PUT(req({ id: "st-orl", name: "ORL long" }))).status).toBe(200);
    expect(db.shifts[0]).toMatchObject({ name: "ORL long", minGapDays: 5, minGapStrength: "rule" });
  });

  it("a new shift starts off, Prefer; a bad value is refused on create too", async () => {
    expect((await POST(req({ code: "NEW", name: "New" }))).status).toBe(200);
    expect(db.created).toMatchObject({ minGapDays: null, minGapStrength: "preference" });
    db.created = null;
    expect((await POST(req({ code: "NEW", name: "New", minGapDays: 1 }))).status).toBe(400);
    expect(db.created).toBeNull();
  });

  it("the shared validator is what the activation save uses", () => {
    expect(minGapError({ minGapDays: 5, minGapStrength: "rule" })).toBeNull();
    expect(minGapError({})).toBeNull();
    expect(minGapError({ minGapDays: 1 })).toMatch(/2 and 60/);
  });
});
