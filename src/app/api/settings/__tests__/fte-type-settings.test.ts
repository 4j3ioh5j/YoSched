import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #71 — staff and employment-type APIs decide FTE % / fixed hours by the type's settings,
// never its name. A small in-memory store (rolled back when a transaction throws).

type Type = { id: string; name: string; defaultIsAutoScheduled: boolean; defaultFtePercentage: number; usesFtePercentage: boolean; allowsFixedHours: boolean; includedInFairness: boolean; sortOrder: number };
type Staff = { id: string; name: string; initials: string; employmentTypeId: string; ftePercentage: number | null; fixedHoursPerPp: number | null; isActive: boolean; isAutoScheduled: boolean; sortOrder: number };

const store = { types: [] as Type[], staff: [] as Staff[], seq: 0, failNextStaffUpdateMany: false };
const copy = <T,>(v: T): T => (v == null ? v : structuredClone(v));
const pick = <T extends object>(data: Record<string, unknown>, row: T): T => {
  const out = { ...row } as Record<string, unknown>;
  for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = v;
  return out as T;
};

function client() {
  return {
    employmentType: {
      findUnique: async ({ where }: { where: { id: string } }) => copy(store.types.find((t) => t.id === where.id) ?? null),
      findFirst: async () => copy([...store.types].sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null),
      aggregate: async () => ({ _max: { sortOrder: Math.max(0, ...store.types.map((t) => t.sortOrder)) } }),
      create: async ({ data }: { data: Partial<Type> }) => {
        const t = { id: `et${++store.seq}`, usesFtePercentage: true, allowsFixedHours: false, includedInFairness: true, ...data } as Type;
        store.types.push(t);
        return copy(t);
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const i = store.types.findIndex((t) => t.id === where.id);
        store.types[i] = pick(data, store.types[i]);
        return copy(store.types[i]);
      },
    },
    staff: {
      findUnique: async ({ where, include }: { where: { id: string }; include?: unknown }) => {
        const s = store.staff.find((p) => p.id === where.id);
        if (!s) return null;
        return include ? { ...copy(s), employmentType: copy(store.types.find((t) => t.id === s.employmentTypeId)) } : copy(s);
      },
      aggregate: async () => ({ _max: { sortOrder: Math.max(0, ...store.staff.map((p) => p.sortOrder)) } }),
      create: async ({ data }: { data: Partial<Staff> }) => {
        const s = { id: `s${++store.seq}`, fixedHoursPerPp: null, ...data } as Staff;
        store.staff.push(s);
        return { ...copy(s), employmentType: copy(store.types.find((t) => t.id === s.employmentTypeId)) };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const i = store.staff.findIndex((p) => p.id === where.id);
        store.staff[i] = pick(data, store.staff[i]);
        return copy(store.staff[i]);
      },
      updateMany: async ({ where, data }: { where: { employmentTypeId: string }; data: Record<string, unknown> }) => {
        if (store.failNextStaffUpdateMany) { store.failNextStaffUpdateMany = false; throw new Error("boom"); }
        store.staff = store.staff.map((p) => (p.employmentTypeId === where.employmentTypeId ? pick(data, p) : p));
        return { count: 0 };
      },
    },
    employmentTypeDefaultShift: { findMany: async () => [], createMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) },
    employmentTypeDefaultAvailability: { findMany: async () => [], createMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) },
    shiftType: { findMany: async () => [] },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const snap = structuredClone({ types: store.types, staff: store.staff });
      try { return await fn(this); } catch (e) { store.types = snap.types; store.staff = snap.staff; throw e; }
    },
  };
}
const fake = client();

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u1" } }, userId: "u1", permissions: ["settings:edit", "staff:edit"], staffId: null }) }));
vi.mock("@/lib/prisma", () => ({ prisma: fake }));
vi.mock("@/lib/user-lifecycle", () => ({ detachLoginForStaff: async () => {} }));

const { PUT: putStaff, POST: postStaff } = await import("../../staff/route");
const { PUT: putType, POST: postType } = await import("../employment-types/route");

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const staffRow = (id: string) => store.staff.find((p) => p.id === id)!;

beforeEach(() => {
  store.seq = 0;
  store.failNextStaffUpdateMany = false;
  // Deliberately odd names: behaviour must follow the settings, not "FTE" / "Fee Basis".
  store.types = [
    { id: "t-ft", name: "Staff Nurse", defaultIsAutoScheduled: true, defaultFtePercentage: 0.9, usesFtePercentage: true, allowsFixedHours: false, includedInFairness: true, sortOrder: 0 },
    { id: "t-fee", name: "FTE", defaultIsAutoScheduled: false, defaultFtePercentage: 0, usesFtePercentage: false, allowsFixedHours: true, includedInFairness: false, sortOrder: 1 },
  ];
  store.staff = [
    { id: "nh", name: "NH", initials: "NH", employmentTypeId: "t-fee", ftePercentage: 1, fixedHoursPerPp: null, isActive: true, isAutoScheduled: false, sortOrder: 1 },
    { id: "ab", name: "AB", initials: "AB", employmentTypeId: "t-ft", ftePercentage: 0.5, fixedHoursPerPp: null, isActive: true, isAutoScheduled: true, sortOrder: 2 },
  ];
});

describe("PUT /api/staff", () => {
  it("a type without an FTE %: a sent FTE % is ignored (type named 'FTE' changes nothing)", async () => {
    staffRow("nh").ftePercentage = 0;
    const res = await putStaff(req({ id: "nh", ftePercentage: 1 }));
    expect(res.status).toBe(200);
    expect(staffRow("nh").ftePercentage).toBe(0);
  });
  it("invalid fixed hours → 400 and nothing written", async () => {
    const res = await putStaff(req({ id: "nh", name: "Changed", fixedHoursPerPp: 0 }));
    expect(res.status).toBe(400);
    expect(staffRow("nh")).toMatchObject({ name: "NH", fixedHoursPerPp: null, ftePercentage: 1 });
  });
  it("checked fixed hours are stored; an old client that omits them keeps them", async () => {
    expect((await putStaff(req({ id: "nh", fixedHoursPerPp: 40 }))).status).toBe(200);
    expect(staffRow("nh").fixedHoursPerPp).toBe(40);
    expect((await putStaff(req({ id: "nh", name: "N H" }))).status).toBe(200);
    expect(staffRow("nh").fixedHoursPerPp).toBe(40);
  });
  it("type change FTE-type → fee type: FTE % 0", async () => {
    await putStaff(req({ id: "ab", employmentTypeId: "t-fee", ftePercentage: 0.5 }));
    expect(staffRow("ab")).toMatchObject({ employmentTypeId: "t-fee", ftePercentage: 0, fixedHoursPerPp: null });
  });
  it("type change fee type → FTE type: the type default; fixed hours cleared", async () => {
    staffRow("nh").fixedHoursPerPp = 40;
    await putStaff(req({ id: "nh", employmentTypeId: "t-ft" }));
    expect(staffRow("nh")).toMatchObject({ employmentTypeId: "t-ft", ftePercentage: 0.9, fixedHoursPerPp: null });
  });
  it("fixed hours sent for an FTE type are not stored", async () => {
    await putStaff(req({ id: "ab", fixedHoursPerPp: 40 }));
    expect(staffRow("ab").fixedHoursPerPp).toBeNull();
  });
});

describe("POST /api/staff", () => {
  it("a new person of a fee type gets FTE % 0, never a hidden 100%", async () => {
    const res = await postStaff(req({ name: "New", initials: "NW", employmentTypeId: "t-fee" }));
    expect(res.status).toBe(200);
    expect(store.staff.find((p) => p.initials === "NW")).toMatchObject({ ftePercentage: 0, fixedHoursPerPp: null });
  });
  it("a new person of an FTE type gets the type default", async () => {
    await postStaff(req({ name: "New", initials: "NW", employmentTypeId: "t-ft" }));
    expect(store.staff.find((p) => p.initials === "NW")?.ftePercentage).toBe(0.9);
  });
  it("an unknown employment type → 400", async () => {
    expect((await postStaff(req({ name: "New", initials: "NW", employmentTypeId: "nope" }))).status).toBe(400);
  });
});

describe("PUT /api/settings/employment-types", () => {
  it("both an FTE % and fixed hours → 400, nothing written", async () => {
    const res = await putType(req({ id: "t-fee", usesFtePercentage: true }));
    expect(res.status).toBe(400);
    expect(store.types.find((t) => t.id === "t-fee")?.usesFtePercentage).toBe(false);
  });
  it("omitted flags keep the stored values (old cached client), staff untouched", async () => {
    staffRow("nh").fixedHoursPerPp = 40;
    expect((await putType(req({ id: "t-fee", name: "Casual" }))).status).toBe(200);
    expect(store.types.find((t) => t.id === "t-fee")).toMatchObject({ name: "Casual", usesFtePercentage: false, allowsFixedHours: true, includedInFairness: false });
    expect(staffRow("nh").fixedHoursPerPp).toBe(40);
  });
  // Codex #340: turning a setting off must not lose staff values — Undo (re-saving the previous
  // type) has to restore them exactly.
  it("turn the FTE % off then Undo: staff FTE % values come back unchanged (0.4 / 0.6)", async () => {
    store.staff.push({ id: "cd", name: "CD", initials: "CD", employmentTypeId: "t-ft", ftePercentage: 0.6, fixedHoursPerPp: null, isActive: true, isAutoScheduled: true, sortOrder: 3 });
    staffRow("ab").ftePercentage = 0.4;
    const before = structuredClone(store.types.find((t) => t.id === "t-ft")!);
    expect((await putType(req({ ...before, usesFtePercentage: false }))).status).toBe(200);
    expect((await putType(req(before))).status).toBe(200); // Undo re-sends the previous type
    expect([staffRow("ab").ftePercentage, staffRow("cd").ftePercentage]).toEqual([0.4, 0.6]);
  });
  it("turn fixed hours off then Undo: fixed hours come back", async () => {
    staffRow("nh").fixedHoursPerPp = 40;
    const before = structuredClone(store.types.find((t) => t.id === "t-fee")!);
    await putType(req({ ...before, allowsFixedHours: false }));
    expect(staffRow("nh").fixedHoursPerPp).toBe(40); // kept, ignored while off
    await putType(req(before));
    expect(staffRow("nh").fixedHoursPerPp).toBe(40);
  });
  it("a staff save while the type's setting is off does not wipe the kept value", async () => {
    staffRow("nh").fixedHoursPerPp = 40;
    store.types.find((t) => t.id === "t-fee")!.allowsFixedHours = false;
    expect((await putStaff(req({ id: "nh", name: "N H", fixedHoursPerPp: null }))).status).toBe(200);
    expect(staffRow("nh").fixedHoursPerPp).toBe(40);
  });
});

describe("POST /api/settings/employment-types", () => {
  it("accepts the settings; refuses both an FTE % and fixed hours", async () => {
    expect((await postType(req({ name: "Casual", usesFtePercentage: false, allowsFixedHours: true, includedInFairness: false }))).status).toBe(200);
    expect(store.types.find((t) => t.name === "Casual")).toMatchObject({ usesFtePercentage: false, allowsFixedHours: true, includedInFairness: false });
    expect((await postType(req({ name: "Bad", usesFtePercentage: true, allowsFixedHours: true }))).status).toBe(400);
  });
});
