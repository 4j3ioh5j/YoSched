import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #177 — the soft "avoid" follow-rule endpoint: replace-per-source, strict on write.

const state = vi.hoisted(() => ({
  shifts: [] as { id: string; code: string }[],
  rows: [] as { id: string; sourceShiftId: string; avoidShiftId: string; createdAt: Date }[],
  perm: "settings:edit" as string | null,
  seq: 0,
}));

vi.mock("@/lib/auth-guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    getSession: async (need: string) => {
      const ok = state.perm === "settings:edit" || (need === "settings:view" && state.perm === "settings:view");
      return ok ? { error: null } : { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    },
  };
});

vi.mock("@/lib/prisma", () => {
  const withCodes = (r: (typeof state.rows)[number]) => ({
    ...r,
    sourceShift: { code: state.shifts.find((s) => s.id === r.sourceShiftId)?.code },
    avoidShift: { code: state.shifts.find((s) => s.id === r.avoidShiftId)?.code },
  });
  const shiftFollowAvoid = {
    findMany: async ({ where }: { where?: { sourceShiftId?: string } } = {}) =>
      state.rows.filter((r) => !where?.sourceShiftId || r.sourceShiftId === where.sourceShiftId).map(withCodes),
    deleteMany: async ({ where }: { where: { sourceShiftId: string } }) => {
      state.rows = state.rows.filter((r) => r.sourceShiftId !== where.sourceShiftId);
    },
    createMany: async ({ data }: { data: { sourceShiftId: string; avoidShiftId: string }[] }) => {
      for (const d of data) state.rows.push({ id: `a${++state.seq}`, ...d, createdAt: new Date(state.seq) });
    },
  };
  const prisma = {
    shiftType: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => state.shifts.filter((s) => where.id.in.includes(s.id)) },
    shiftFollowAvoid,
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => fn({ shiftFollowAvoid }),
  };
  return { prisma };
});

import { GET, PUT } from "../shift-follow-avoids/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const pairs = () => state.rows.map((r) => `${r.sourceShiftId}>${r.avoidShiftId}`).sort();

beforeEach(() => {
  state.shifts = [{ id: "orl", code: "ORL" }, { id: "orc", code: "ORC" }, { id: "or", code: "OR" }, { id: "x", code: "X" }];
  state.rows = [];
  state.perm = "settings:edit";
  state.seq = 0;
});

describe("PUT /api/settings/shift-follow-avoids", () => {
  it("replaces the avoid list of that source only, deduped", async () => {
    state.rows.push({ id: "old1", sourceShiftId: "orl", avoidShiftId: "or", createdAt: new Date(0) });
    state.rows.push({ id: "old2", sourceShiftId: "orc", avoidShiftId: "or", createdAt: new Date(0) });
    const res = await PUT(req({ sourceShiftId: "orl", avoidShiftIds: ["orc", "x", "orc"] }));
    expect(res.status).toBe(200);
    expect(pairs()).toEqual(["orc>or", "orl>orc", "orl>x"]);
    expect((await res.json()).map((r: { avoidShift: { code: string } }) => r.avoidShift.code)).toEqual(["ORC", "X"]);
  });

  it("an empty list clears that source's avoids", async () => {
    state.rows.push({ id: "old1", sourceShiftId: "orl", avoidShiftId: "orc", createdAt: new Date(0) });
    expect((await PUT(req({ sourceShiftId: "orl", avoidShiftIds: [] }))).status).toBe(200);
    expect(pairs()).toEqual([]);
  });

  it("refuses an unknown shift id with 400 and writes nothing", async () => {
    state.rows.push({ id: "old1", sourceShiftId: "orl", avoidShiftId: "orc", createdAt: new Date(0) });
    const res = await PUT(req({ sourceShiftId: "orl", avoidShiftIds: ["orc", "nope"] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown shift type: nope");
    expect(pairs()).toEqual(["orl>orc"]);
    expect((await PUT(req({ sourceShiftId: "ghost", avoidShiftIds: [] }))).status).toBe(400);
  });

  it("refuses a malformed body", async () => {
    expect((await PUT(req({ sourceShiftId: "orl" }))).status).toBe(400);
    expect((await PUT(req({ sourceShiftId: "orl", avoidShiftIds: [3] }))).status).toBe(400);
    expect((await PUT(req({ avoidShiftIds: [] }))).status).toBe(400);
    expect((await PUT(req(null))).status).toBe(400);
  });

  it("needs settings:edit to write, settings:view to read", async () => {
    state.perm = "settings:view";
    expect((await PUT(req({ sourceShiftId: "orl", avoidShiftIds: ["orc"] }))).status).toBe(403);
    expect(pairs()).toEqual([]);
    expect((await GET()).status).toBe(200);
    state.perm = null;
    expect((await GET()).status).toBe(403);
  });
});
