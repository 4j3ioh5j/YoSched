import { describe, it, expect, beforeEach } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { applyActivation, readActivationState, ActivationStale, initialEligible, initialTypeDefault } from "@/lib/shift-activation";
import { eligibilityDiff, EligibilityStale } from "@/lib/eligibility-write";

// Card #75: turning a shift's Auto-schedule on through the activation panel. A small in-memory
// store stands in for Prisma (equality and `{ in: [...] }` filters only).

type Row = Record<string, unknown>;
const matches = (row: Row, where: Row = {}) =>
  Object.entries(where).every(([k, v]) =>
    v && typeof v === "object" && !(v instanceof Date) && "in" in (v as Row) ? ((v as { in: unknown[] }).in).includes(row[k]) : row[k] === v);

function table(rows: Row[]) {
  return {
    rows,
    findMany: async ({ where }: { where?: Row } = {}) => rows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
    findUnique: async ({ where }: { where: Row }) => { const r = rows.find((x) => matches(x, where)); return r ? { ...r } : null; },
    update: async ({ where, data }: { where: Row; data: Row }) => { const r = rows.find((x) => matches(x, where))!; Object.assign(r, data); return { ...r }; },
    createMany: async ({ data }: { data: Row[] }) => { rows.push(...data.map((d) => ({ ...d }))); return { count: data.length }; },
    deleteMany: async ({ where }: { where: Row }) => {
      const keep = rows.filter((r) => !matches(r, where));
      const n = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count: n };
    },
  };
}

let db: ReturnType<typeof makeDb>;
let locks = 0;
function makeDb() {
  const assignments = table([
    { staffId: "A", shiftTypeId: "S", date: new Date("2025-03-01") },
    { staffId: "A", shiftTypeId: "S", date: new Date("2026-01-10") },
    { staffId: "Z", shiftTypeId: "S", date: new Date("2024-05-05") }, // inactive
  ]);
  return {
    shiftType: table([{ id: "S", autoSchedulable: false, name: "Cardiac" }, { id: "T", autoSchedulable: true, name: "Other" }]),
    staff: table([
      { id: "A", initials: "AA", name: "Ann", employmentTypeId: "FT", isAutoScheduled: true, isActive: true, sortOrder: 1 },
      { id: "B", initials: "BB", name: "Bob", employmentTypeId: "PT", isAutoScheduled: true, isActive: true, sortOrder: 2 },
      { id: "C", initials: "CC", name: "Cy", employmentTypeId: "PT", isAutoScheduled: false, isActive: true, sortOrder: 3 },
      { id: "Z", initials: "ZZ", name: "Zed", employmentTypeId: "FT", isAutoScheduled: true, isActive: false, sortOrder: 4 },
    ]),
    // The old blanket grant: everyone (incl. inactive Z) eligible for S; T untouched by S's writes.
    staffEligibleShift: table([
      { staffId: "A", shiftTypeId: "S" }, { staffId: "B", shiftTypeId: "S" }, { staffId: "C", shiftTypeId: "S" }, { staffId: "Z", shiftTypeId: "S" },
      { staffId: "B", shiftTypeId: "T" },
    ]),
    employmentType: table([{ id: "FT", name: "Full time", sortOrder: 1 }, { id: "PT", name: "Part time", sortOrder: 2 }]),
    employmentTypeDefaultShift: table([{ employmentTypeId: "FT", shiftTypeId: "S" }, { employmentTypeId: "PT", shiftTypeId: "S" }, { employmentTypeId: "PT", shiftTypeId: "T" }]),
    assignment: {
      groupBy: async ({ where }: { where: Row }) => {
        const by = new Map<string, { staffId: string; _count: { _all: number }; _max: { date: Date | null } }>();
        for (const r of assignments.rows.filter((x) => matches(x, where))) {
          const g = by.get(r.staffId as string) ?? { staffId: r.staffId as string, _count: { _all: 0 }, _max: { date: null } };
          g._count._all++;
          if (!g._max.date || (r.date as Date) > g._max.date) g._max.date = r.date as Date;
          by.set(g.staffId, g);
        }
        return [...by.values()];
      },
    },
    shiftEligibilityRule: table([{ staffId: "B", shiftTypeId: "S", id: "r1" }]),
    shiftMinimumTarget: table([]),
    standingCommitment: table([{ staffId: "C", shiftTypeId: "S", id: "sc1" }]),
    staffShiftOverride: table([]),
    async $executeRaw() { locks++; return 0; },
  };
}
const tx = () => db as unknown as Prisma.TransactionClient;

beforeEach(() => { db = makeDb(); locks = 0; });

describe("readActivationState (card #75)", () => {
  it("lists active staff only, with worked counts, last worked date and rules", async () => {
    const s = (await readActivationState(tx(), "S"))!;
    expect(s.people.map((p) => p.id)).toEqual(["A", "B", "C"]);
    const a = s.people.find((p) => p.id === "A")!;
    expect([a.workedCount, a.lastWorked, a.eligibleNow]).toEqual([2, "2026-01-10", true]);
    expect(s.people.find((p) => p.id === "B")!.hasRules).toBe(true);
    expect(s.people.find((p) => p.id === "C")!.hasRules).toBe(true);
    expect(s.people.find((p) => p.id === "A")!.hasRules).toBe(false);
    expect(s.types.map((t) => [t.id, t.defaultNow])).toEqual([["FT", true], ["PT", true]]);
  });
  it("returns null for an unknown shift", async () => {
    expect(await readActivationState(tx(), "nope")).toBeNull();
  });
});

describe("the department defaults (David: worked → eligible, never → not eligible)", () => {
  it("initialEligible follows the group rule; keep = as saved", () => {
    expect(initialEligible({ workedCount: 3, eligibleNow: false }, "eligible", "not_eligible")).toBe(true);
    expect(initialEligible({ workedCount: 0, eligibleNow: true }, "eligible", "not_eligible")).toBe(false);
    expect(initialEligible({ workedCount: 0, eligibleNow: true }, "eligible", "keep")).toBe(true);
    expect(initialEligible({ workedCount: 2, eligibleNow: false }, "keep", "eligible")).toBe(false);
  });
  it("initialTypeDefault: keep / all / none / match the ticked people's types", () => {
    const t = { id: "PT", defaultNow: false };
    expect(initialTypeDefault(t, "keep", [])).toBe(false);
    expect(initialTypeDefault(t, "all", [])).toBe(true);
    expect(initialTypeDefault({ ...t, defaultNow: true }, "none", [])).toBe(false);
    expect(initialTypeDefault(t, "match", [{ employmentTypeId: "FT" }])).toBe(false);
    expect(initialTypeDefault(t, "match", [{ employmentTypeId: "PT" }])).toBe(true);
  });
});

describe("applyActivation (card #75)", () => {
  async function activate(eligibleStaffIds: string[], defaultEmploymentTypeIds: string[], version?: string) {
    const v = version ?? (await readActivationState(tx(), "S"))!.version;
    return applyActivation(tx(), { shiftTypeId: "S", version: v, autoSchedulable: true, eligibleStaffIds, defaultEmploymentTypeIds });
  }
  const eligibleFor = (shift: string) => db.staffEligibleShift.rows.filter((r) => r.shiftTypeId === shift).map((r) => r.staffId).sort();
  const typesFor = (shift: string) => db.employmentTypeDefaultShift.rows.filter((r) => r.shiftTypeId === shift).map((r) => r.employmentTypeId).sort();

  it("takes the eligibility lock and writes the flag, the chosen people and the chosen types", async () => {
    const r = (await activate(["A"], ["FT"]))!;
    expect(locks).toBeGreaterThan(0);
    expect(db.shiftType.rows.find((s) => s.id === "S")!.autoSchedulable).toBe(true);
    expect(eligibleFor("S")).toEqual(["A", "Z"]); // Z is inactive: untouched
    expect(typesFor("S")).toEqual(["FT"]);
    expect(r.state.autoSchedulable).toBe(true);
  });
  it("never touches other shifts' rows, inactive staff, or the unticked people's rules", async () => {
    await activate([], []);
    expect(eligibleFor("T")).toEqual(["B"]);
    expect(typesFor("T")).toEqual(["PT"]);
    expect(eligibleFor("S")).toEqual(["Z"]);
    expect(db.shiftEligibilityRule.rows).toHaveLength(1);
    expect(db.standingCommitment.rows).toHaveLength(1);
  });
  it("ignores ids that are not active staff or existing types", async () => {
    await activate(["A", "Z", "ghost"], ["FT", "ghostType"]);
    expect(eligibleFor("S")).toEqual(["A", "Z"]);
    expect(db.staffEligibleShift.rows.filter((r) => r.staffId === "ghost")).toHaveLength(0);
    expect(typesFor("S")).toEqual(["FT"]);
  });
  it("refuses (ActivationStale) when anything it compares changed since the panel opened, and writes nothing", async () => {
    const v = (await readActivationState(tx(), "S"))!.version;
    for (const change of [
      () => db.staffEligibleShift.rows.push({ staffId: "A", shiftTypeId: "X" }) && db.staffEligibleShift.deleteMany({ where: { staffId: "B", shiftTypeId: "S" } }),
      () => { db.staff.rows.find((p) => p.id === "Z")!.isActive = true; },
      () => db.employmentTypeDefaultShift.deleteMany({ where: { employmentTypeId: "FT", shiftTypeId: "S" } }),
      () => { db.shiftType.rows.find((s) => s.id === "S")!.autoSchedulable = true; },
      () => db.employmentType.rows.push({ id: "NEW", name: "New", sortOrder: 3 }),
    ]) {
      db = makeDb();
      await change();
      const before = JSON.stringify([db.staffEligibleShift.rows, db.employmentTypeDefaultShift.rows, db.shiftType.rows]);
      await expect(activate(["A"], ["FT"], v)).rejects.toBeInstanceOf(ActivationStale);
      expect(JSON.stringify([db.staffEligibleShift.rows, db.employmentTypeDefaultShift.rows, db.shiftType.rows])).toBe(before);
    }
  });
  it("Undo (the inverse, with the new version) puts everything back exactly", async () => {
    const snapshot = () => JSON.stringify([
      [...db.staffEligibleShift.rows].map((r) => `${r.staffId}:${r.shiftTypeId}`).sort(),
      [...db.employmentTypeDefaultShift.rows].map((r) => `${r.employmentTypeId}:${r.shiftTypeId}`).sort(),
      db.shiftType.rows.map((s) => `${s.id}:${s.autoSchedulable}`),
    ]);
    const start = snapshot();
    const r = (await activate(["A"], []))!;
    expect(snapshot()).not.toBe(start);
    await applyActivation(tx(), { shiftTypeId: "S", version: r.state.version, ...r.inverse });
    expect(snapshot()).toBe(start);
  });
  it("Undo is refused once something else changed (no silent revert of a later save)", async () => {
    const r = (await activate(["A"], []))!;
    db.staffEligibleShift.rows.push({ staffId: "B", shiftTypeId: "S" }); // a Staff-page tick afterwards
    await expect(applyActivation(tx(), { shiftTypeId: "S", version: r.state.version, ...r.inverse })).rejects.toBeInstanceOf(ActivationStale);
  });
  it("returns null for an unknown shift", async () => {
    expect(await applyActivation(tx(), { shiftTypeId: "nope", version: "x", autoSchedulable: true, eligibleStaffIds: [], defaultEmploymentTypeIds: [] })).toBeNull();
  });
});

describe("eligibilityDiff (card #75: whole-list writers apply only the user's change)", () => {
  it("with a base: adds what the user added and removes what the user removed, on top of what is stored now", () => {
    // Stored now has S (turned on in Settings after the page loaded); the user ticked T, unticked U.
    expect(eligibilityDiff(["S", "U"], ["T"], ["U"])).toEqual({ add: ["T"], remove: ["U"] });
  });
  it("with a base: a stale page that never saw S does not remove it", () => {
    expect(eligibilityDiff(["S", "U"], ["U"], ["U"])).toEqual({ add: [], remove: [] });
  });
  it("with a base: no double add / no remove of a row already gone", () => {
    expect(eligibilityDiff(["T"], ["T"], [])).toEqual({ add: [], remove: [] });
    expect(eligibilityDiff([], [], ["U"])).toEqual({ add: [], remove: [] });
  });
  it("without a base (old cached page): the same list is a no-op, a different one is refused", () => {
    expect(eligibilityDiff(["A", "B"], ["B", "A"], undefined)).toEqual({ add: [], remove: [] });
    expect(() => eligibilityDiff(["A", "B"], ["A"], undefined)).toThrow(EligibilityStale);
    expect(() => eligibilityDiff(["A"], ["A", "B"], null)).toThrow(EligibilityStale);
  });
  it("rejects malformed lists", () => {
    expect(() => eligibilityDiff([], "A", [])).toThrow(TypeError);
    expect(() => eligibilityDiff([], [1], [])).toThrow(TypeError);
    expect(() => eligibilityDiff([], [], "x")).toThrow(TypeError);
  });
});
