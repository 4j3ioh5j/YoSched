import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #75: the activation endpoint, the three department defaults, and new shifts starting off.

const calls = { apply: [] as Record<string, unknown>[], upsert: [] as Record<string, unknown>[], created: [] as Record<string, unknown>[], staleNext: false };

const fake = {
  shiftType: {
    findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, autoSchedulable: true }),
    aggregate: async () => ({ _max: { sortOrder: 3 } }),
    create: async ({ data }: { data: Record<string, unknown> }) => { calls.created.push(data); return { id: "new", ...data }; },
    findMany: async () => [],
  },
  schedulingPreferences: {
    findFirst: async () => ({ activationWorkedDefault: "bogus", activationNeverDefault: "eligible", activationNewHireDefault: "match" }),
    upsert: async (a: Record<string, unknown>) => { calls.upsert.push(a); return {}; },
  },
  async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> { return fn(this); },
};

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u1" } }, userId: "u1", permissions: ["settings:edit", "settings:view"], staffId: null }) }));
vi.mock("@/lib/prisma", () => ({ prisma: fake }));
vi.mock("@/lib/shift-activation", async (orig) => {
  const real = await orig<typeof import("@/lib/shift-activation")>();
  return {
    ...real,
    readActivationState: async (_db: unknown, id: string) => (id === "S" ? { shiftTypeId: "S", autoSchedulable: false, people: [], types: [], version: "v1" } : null),
    applyActivation: async (_tx: unknown, w: Record<string, unknown>) => {
      calls.apply.push(w);
      if (calls.staleNext) { calls.staleNext = false; throw new real.ActivationStale(); }
      return { inverse: { autoSchedulable: false, eligibleStaffIds: [], defaultEmploymentTypeIds: [] }, state: { version: "v2" } };
    },
  };
});

const activation = await import("../shift-types/activation/route");
const prefs = await import("../scheduling-preferences/route");
const shiftTypes = await import("../shift-types/route");

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const getReq = (id: string | null) => ({ nextUrl: new URL(`http://x/a${id ? `?id=${id}` : ""}`) }) as unknown as NextRequest;
const good = { id: "S", version: "v1", autoSchedulable: true, eligibleStaffIds: ["A"], defaultEmploymentTypeIds: ["FT"] };

beforeEach(() => { calls.apply = []; calls.upsert = []; calls.created = []; calls.staleNext = false; });

describe("GET /api/settings/shift-types/activation", () => {
  it("returns the state with the department defaults (a bad stored value falls back to the default)", async () => {
    const res = await activation.GET(getReq("S"));
    expect(res.status).toBe(200);
    expect((await res.json()).defaults).toEqual({ worked: "eligible", never: "eligible", newHire: "match" });
  });
  it("400 without an id, 404 for an unknown shift", async () => {
    expect((await activation.GET(getReq(null))).status).toBe(400);
    expect((await activation.GET(getReq("nope"))).status).toBe(404);
  });
});

describe("POST /api/settings/shift-types/activation", () => {
  it("applies and returns the inverse and the new version", async () => {
    const res = await activation.POST(req(good));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.state.version).toBe("v2");
    expect(j.inverse.autoSchedulable).toBe(false);
  });
  it("409 (reason stale) when the version no longer matches", async () => {
    calls.staleNext = true;
    const res = await activation.POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("stale");
  });
  it("400 on a malformed body", async () => {
    for (const bad of [{ ...good, version: undefined }, { ...good, autoSchedulable: "yes" }, { ...good, eligibleStaffIds: [1] }, { ...good, defaultEmploymentTypeIds: "FT" }, null]) {
      expect((await activation.POST(req(bad))).status).toBe(400);
    }
    expect(calls.apply).toHaveLength(0);
  });
  it("other shift edits ride along, filtered to the editable fields; the flag only comes from the top level", async () => {
    await activation.POST(req({ ...good, shift: { name: "Cardiac", autoSchedulable: false, id: "other", printBackgroundColor: "red", bogus: 1 } }));
    expect(calls.apply[0].autoSchedulable).toBe(true);
    expect(calls.apply[0].shiftData).toEqual({ name: "Cardiac", printBackgroundColor: null });
  });
});

describe("PUT /api/settings/scheduling-preferences: the activation defaults", () => {
  it("saves valid values", async () => {
    const res = await prefs.PUT(req({ activationWorkedDefault: "keep", activationNeverDefault: "eligible", activationNewHireDefault: "all" }));
    expect(res.status).toBe(200);
    expect((calls.upsert[0].update as Record<string, unknown>)).toMatchObject({ activationWorkedDefault: "keep", activationNeverDefault: "eligible", activationNewHireDefault: "all" });
  });
  it("rejects anything else with 400 (never coerced)", async () => {
    for (const bad of [{ activationWorkedDefault: "yes" }, { activationNeverDefault: "match" }, { activationNewHireDefault: "eligible" }]) {
      expect((await prefs.PUT(req(bad))).status).toBe(400);
    }
    expect(calls.upsert).toHaveLength(0);
  });
});

describe("POST /api/settings/shift-types", () => {
  it("a new (or re-created, by a delete's Undo) shift always starts with Auto-schedule off", async () => {
    const res = await shiftTypes.POST(req({ code: "NEW", name: "New", autoSchedulable: true }));
    expect(res.status).toBeLessThan(300);
    expect(calls.created[0].autoSchedulable).toBe(false);
  });
});
