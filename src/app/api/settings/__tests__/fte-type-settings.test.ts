import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { appliedDiff, undoList } from "@/lib/eligibility-undo";

// Card #71 — staff and employment-type APIs decide FTE % / fixed hours by the type's settings,
// never its name. A small in-memory store (rolled back when a transaction throws).

type Type = { id: string; name: string; defaultIsAutoScheduled: boolean; defaultFtePercentage: number; usesFtePercentage: boolean; allowsFixedHours: boolean; includedInFairness: boolean; sortOrder: number };
type Staff = { id: string; name: string; initials: string; employmentTypeId: string; ftePercentage: number | null; fixedHoursPerPp: number | null; isActive: boolean; isAutoScheduled: boolean; sortOrder: number };

type Elig = { staffId: string; shiftTypeId: string };
type TypeDefault = { employmentTypeId: string; shiftTypeId: string };
const store = { types: [] as Type[], staff: [] as Staff[], elig: [] as Elig[], typeDefaults: [] as TypeDefault[], locks: 0, seq: 0, failNextStaffUpdateMany: false };
// Equality and `{ in: [...] }` filters, as the eligibility writers use them.
const hit = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
  Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in v ? (v as { in: unknown[] }).in.includes(row[k]) : row[k] === v));
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
    employmentTypeDefaultShift: {
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => copy(store.typeDefaults.filter((r) => hit(r, where))),
      createMany: async ({ data }: { data: TypeDefault[] }) => { store.typeDefaults.push(...copy(data)); return { count: data.length }; },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => { store.typeDefaults = store.typeDefaults.filter((r) => !hit(r, where)); return { count: 0 }; },
    },
    employmentTypeDefaultAvailability: { findMany: async () => [], createMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) },
    shiftType: { findMany: async () => [] },
    staffEligibleShift: {
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => copy(store.elig.filter((r) => hit(r, where))),
      createMany: async ({ data }: { data: Elig[] }) => { store.elig.push(...copy(data)); return { count: data.length }; },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => { store.elig = store.elig.filter((r) => !hit(r, where)); return { count: 0 }; },
    },
    async $executeRaw() { store.locks++; return 0; }, // card #75: the eligibility advisory lock
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const snap = structuredClone({ types: store.types, staff: store.staff, elig: store.elig, typeDefaults: store.typeDefaults });
      try { return await fn(this); } catch (e) { Object.assign(store, snap); throw e; }
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
  store.locks = 0;
  store.failNextStaffUpdateMany = false;
  store.elig = [];
  store.typeDefaults = [];
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

// Card #75: the Staff page and the employment-type editor send whole lists. They now send the list
// they started from too (`…Base`) and the server applies only the difference, under the
// eligibility lock, so a page loaded before a shift was turned on in Settings can't undo that.
describe("eligibility lists: apply the user's change only (card #75)", () => {
  const eligOf = (id: string) => store.elig.filter((r) => r.staffId === id).map((r) => r.shiftTypeId).sort();
  const defaultsOf = (id: string) => store.typeDefaults.filter((r) => r.employmentTypeId === id).map((r) => r.shiftTypeId).sort();

  it("Staff PUT: a stale page's save keeps a shift turned on elsewhere, and applies its own tick/untick", async () => {
    store.elig = [{ staffId: "ab", shiftTypeId: "U" }, { staffId: "ab", shiftTypeId: "S" }]; // S was added by an activation
    const res = await putStaff(req({ id: "ab", eligibleShiftTypeIds: ["T"], eligibleShiftTypeIdsBase: ["U"] }));
    expect(res.status).toBe(200);
    expect(eligOf("ab")).toEqual(["S", "T"]);
    expect(store.locks).toBeGreaterThan(0);
  });
  it("Staff PUT from an old cached page (no base): the stored list is fine, a different list is 409 and nothing changes", async () => {
    store.elig = [{ staffId: "ab", shiftTypeId: "S" }];
    expect((await putStaff(req({ id: "ab", eligibleShiftTypeIds: ["S"] }))).status).toBe(200);
    const res = await putStaff(req({ id: "ab", name: "Renamed", eligibleShiftTypeIds: [] }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("stale");
    expect(eligOf("ab")).toEqual(["S"]);
    expect(staffRow("ab").name).toBe("AB"); // the whole save rolled back
  });
  it("Staff PUT: a malformed list is 400", async () => {
    expect((await putStaff(req({ id: "ab", eligibleShiftTypeIds: [1], eligibleShiftTypeIdsBase: [] }))).status).toBe(400);
  });
  it("Staff PUT without a list doesn't touch eligibility", async () => {
    store.elig = [{ staffId: "ab", shiftTypeId: "S" }];
    expect((await putStaff(req({ id: "ab", name: "A B" }))).status).toBe(200);
    expect(eligOf("ab")).toEqual(["S"]);
  });
  it("Staff POST: a new hire gets the type's default shifts (under the lock)", async () => {
    store.typeDefaults = [{ employmentTypeId: "t-ft", shiftTypeId: "S" }, { employmentTypeId: "t-fee", shiftTypeId: "X" }];
    await postStaff(req({ name: "New", initials: "NW", employmentTypeId: "t-ft" }));
    const id = store.staff.find((p) => p.initials === "NW")!.id;
    expect(eligOf(id)).toEqual(["S"]);
    expect(store.locks).toBeGreaterThan(0);
  });
  it("employment-type PUT: the default list is diffed against its base; the flags save with it", async () => {
    store.typeDefaults = [{ employmentTypeId: "t-ft", shiftTypeId: "U" }, { employmentTypeId: "t-ft", shiftTypeId: "S" }];
    const res = await putType(req({ id: "t-ft", name: "Renamed", defaultEligibleShiftTypeIds: ["T"], defaultEligibleShiftTypeIdsBase: ["U"] }));
    expect(res.status).toBe(200);
    expect(defaultsOf("t-ft")).toEqual(["S", "T"]);
    expect(store.types.find((t) => t.id === "t-ft")!.name).toBe("Renamed");
  });
  it("employment-type PUT from an old cached page with a different list: 409, and its flag changes are not saved either", async () => {
    store.typeDefaults = [{ employmentTypeId: "t-ft", shiftTypeId: "S" }];
    const res = await putType(req({ id: "t-ft", name: "Renamed", defaultEligibleShiftTypeIds: [] }));
    expect(res.status).toBe(409);
    expect(defaultsOf("t-ft")).toEqual(["S"]);
    expect(store.types.find((t) => t.id === "t-ft")!.name).toBe("Staff Nurse");
  });
});

// Codex #385: a stale page's save keeps a shift turned on elsewhere; its Undo must then reverse
// ONLY that save's own change. These replay what each editor's Undo does (putStaff/putType →
// undoList from the reported diff).
describe("merge → save → Undo reverses only the save's own change (card #75, Codex #385)", () => {
  const eligOf = (id: string) => store.elig.filter((r) => r.staffId === id).map((r) => r.shiftTypeId).sort();
  const defaultsOf = (id: string) => store.typeDefaults.filter((r) => r.employmentTypeId === id).map((r) => r.shiftTypeId).sort();

  async function staffSaveThenUndo(pageList: string[], sent: string[], extra: Record<string, unknown> = {}) {
    const res = await putStaff(req({ id: "ab", ...extra, eligibleShiftTypeIds: sent, eligibleShiftTypeIdsBase: pageList }));
    expect(res.status).toBe(200);
    const j = await res.json();
    const after = eligOf("ab"); // = the response's eligibleShifts (the fake omits includes)
    const u = undoList(after, appliedDiff(j.eligibleShiftTypeIdsApplied, sent, pageList, after));
    const back = await putStaff(req({ id: "ab", name: "AB", eligibleShiftTypeIds: u.list, eligibleShiftTypeIdsBase: u.base }));
    expect(back.status).toBe(200);
  }

  it("Staff: name-only save on a page that never saw PRE → Undo keeps PRE", async () => {
    store.elig = [{ staffId: "ab", shiftTypeId: "U" }, { staffId: "ab", shiftTypeId: "PRE" }]; // PRE activated elsewhere
    staffRow("ab").name = "AB";
    await staffSaveThenUndo(["U"], ["U"], { name: "Renamed" });
    expect(eligOf("ab")).toEqual(["PRE", "U"]);
    expect(staffRow("ab").name).toBe("AB");
  });
  it("Staff: a shift removed by an activation is not re-granted by the Undo", async () => {
    store.elig = [{ staffId: "ab", shiftTypeId: "U" }]; // page still shows PRE, activation removed it
    await staffSaveThenUndo(["U", "PRE"], ["U", "PRE"], { name: "Renamed" });
    expect(eligOf("ab")).toEqual(["U"]);
  });
  it("Staff: the save's own tick and untick are reversed, the outside change stays", async () => {
    store.elig = [{ staffId: "ab", shiftTypeId: "U" }, { staffId: "ab", shiftTypeId: "PRE" }];
    await staffSaveThenUndo(["U"], ["T"]); // user ticked T, unticked U
    expect(eligOf("ab")).toEqual(["PRE", "U"]);
  });
  it("Staff: the server reports exactly what it applied (not the user's whole diff)", async () => {
    store.elig = [{ staffId: "ab", shiftTypeId: "PRE" }];
    const j = await (await putStaff(req({ id: "ab", eligibleShiftTypeIds: ["PRE", "T"], eligibleShiftTypeIdsBase: [] }))).json();
    expect(j.eligibleShiftTypeIdsApplied).toEqual({ add: ["T"], remove: [] }); // PRE was already there
  });

  async function typeSaveThenUndo(pageList: string[], sent: string[], extra: Record<string, unknown> = {}) {
    const res = await putType(req({ id: "t-ft", ...extra, defaultEligibleShiftTypeIds: sent, defaultEligibleShiftTypeIdsBase: pageList }));
    expect(res.status).toBe(200);
    const j = await res.json();
    const after = defaultsOf("t-ft"); // = the response's defaultEligibleShifts
    const u = undoList(after, appliedDiff(j.defaultEligibleShiftTypeIdsApplied, sent, pageList, after));
    expect((await putType(req({ id: "t-ft", name: "Staff Nurse", defaultEligibleShiftTypeIds: u.list, defaultEligibleShiftTypeIdsBase: u.base }))).status).toBe(200);
  }
  it("employment type: name-only save on a stale editor → Undo keeps the activation's default", async () => {
    store.typeDefaults = [{ employmentTypeId: "t-ft", shiftTypeId: "U" }, { employmentTypeId: "t-ft", shiftTypeId: "PRE" }];
    await typeSaveThenUndo(["U"], ["U"], { name: "Renamed" });
    expect(defaultsOf("t-ft")).toEqual(["PRE", "U"]);
    expect(store.types.find((t) => t.id === "t-ft")!.name).toBe("Staff Nurse");
  });
  it("employment type: a default removed elsewhere is not re-added; own changes reversed", async () => {
    store.typeDefaults = [{ employmentTypeId: "t-ft", shiftTypeId: "U" }];
    await typeSaveThenUndo(["U", "PRE"], ["PRE", "T"]); // user unticked U, ticked T; PRE gone elsewhere
    expect(defaultsOf("t-ft")).toEqual(["U"]);
  });
});
