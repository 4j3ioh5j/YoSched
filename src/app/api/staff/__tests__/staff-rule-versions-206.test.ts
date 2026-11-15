import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #206: PUT /api/staff refuses (409, nothing written) a rule list sent from a copy older than
// what is stored, so a staff card saved from an old page can no longer erase newer rules.

type Row = Record<string, unknown>;
const TABLES = vi.hoisted(() => ({ availabilityRule: "availabilityRules", shiftEligibilityRule: "shiftEligibilityRules", shiftMinimumTarget: "shiftMinimumTargets", standingCommitment: "standingCommitments", staffShiftOverride: "shiftOverrides" } as const));
const db = vi.hoisted(() => ({ staff: { id: "s1", name: "Ann", employmentTypeId: "ft" } as Row, lists: {} as Record<string, Row[]>, writes: 0, locks: [] as string[] }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } }, userId: "u", permissions: ["staff:edit"], staffId: null }) }));
vi.mock("@/lib/user-lifecycle", () => ({ detachLoginForStaff: async () => undefined }));
vi.mock("@/lib/fte", () => ({ staffHoursWrite: () => ({ ok: true, ftePercentage: 100, fixedHoursPerPp: null }) }));
vi.mock("@/lib/prisma", () => {
  const pick = (r: Row, select?: Record<string, true>) => select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : { ...r };
  const table = (name: string) => ({
    findMany: async (a: { where: { staffId: string }; select?: Record<string, true> }) => (db.lists[name] ?? []).filter((r) => r.staffId === a.where.staffId).map((r) => pick(r, a.select)),
    deleteMany: async (a: { where: { staffId: string } }) => { db.writes++; db.lists[name] = (db.lists[name] ?? []).filter((r) => r.staffId !== a.where.staffId); return { count: 0 }; },
    createMany: async (a: { data: Row[] }) => { db.writes++; db.lists[name] = [...(db.lists[name] ?? []), ...a.data.map((r, i) => ({ id: `${name}${i}${db.writes}`, ...r }))]; return { count: a.data.length }; },
  });
  const tx: Record<string, unknown> = {
    staff: {
      findUnique: async (a: { where: { id: string }; include?: unknown }) => a.where.id !== db.staff.id ? null
        : a.include ? { ...db.staff, employmentType: { id: "ft" }, eligibleShifts: [], ...Object.fromEntries(Object.values(TABLES).map((k) => [k, (db.lists[k] ?? []).map((r) => ({ ...r }))])) }
        : { employmentTypeId: db.staff.employmentTypeId },
      update: async (a: { data: Row }) => { db.writes++; for (const [k, v] of Object.entries(a.data)) if (v !== undefined) db.staff[k] = v; return db.staff; },
    },
    employmentType: { findUnique: async () => ({ id: "ft" }) },
    $executeRaw: async (strings: TemplateStringsArray, ...vals: unknown[]) => { db.locks.push(`${strings.join("?")}|${vals.join(",")}`); return 0; },
  };
  for (const [t, k] of Object.entries(TABLES)) tx[t] = table(k);
  const prisma = { ...tx, $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
    const snap = JSON.stringify(db);
    try { return await fn(tx); } catch (e) { const s = JSON.parse(snap); db.staff = s.staff; db.lists = s.lists; throw e; }
  } };
  return { prisma };
});

import { PUT } from "../route";
import { ruleListVersion } from "@/lib/staff-rule-versions";
import { rulesPatch, undoRulesPatch, afterRulesSave, type RuleHolder, type RuleVersions } from "@/lib/staff-rule-patch";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const when = { whenKind: "every", whenPpWeek: null, whenOrds: [], whenCycleUnit: null, whenCycleN: null, whenCycleOffset: null };
const AV = (d: number) => ({ type: "unavailable", strength: "rule", conditionStaffId: null, conditionType: null, ...when, whenDays: [d] });
const OV = { shiftTypeId: "call", durationHrs: 12, durationHrsWeekday: null, durationHrsWeekend: null, durationHrsHoliday: null };
const stored = (k: string) => (db.lists[k] ?? []).map((r) => { const o = { ...r }; delete o.id; delete o.staffId; return o; });

/** The page's copy of the person, as staff/page.tsx would load it now. */
function load(): RuleHolder & { id: string; name: string } {
  const lists = { availabilityRules: stored("availabilityRules"), shiftEligibilityRules: stored("shiftEligibilityRules"), shiftMinimumTargets: stored("shiftMinimumTargets"), standingCommitments: stored("standingCommitments"), shiftOverrides: stored("shiftOverrides") };
  const ruleVersions: RuleVersions = {};
  for (const [k, v] of Object.entries(lists)) ruleVersions[k as keyof RuleVersions] = ruleListVersion(k as keyof RuleVersions, v);
  return { id: "s1", name: String(db.staff.name), ...lists, ruleVersions };
}

/** What staff-page.tsx's save does: send the patch, then hold the row afterRulesSave gives. */
async function save(edited: ReturnType<typeof load>, held: ReturnType<typeof load>) {
  const p = rulesPatch(edited, held);
  const res = await PUT(req({ id: edited.id, name: edited.name, ...p.lists, ruleBases: p.ruleBases }));
  const body = await res.json();
  return { res, sent: p.sent, row: res.ok ? afterRulesSave(edited, held, p.sent, body.ruleVersions) : held };
}

beforeEach(() => {
  db.staff = { id: "s1", name: "Ann", employmentTypeId: "ft" };
  db.lists = { availabilityRules: [{ id: "a0", staffId: "s1", ...AV(1) }], shiftOverrides: [{ id: "o0", staffId: "s1", ...OV }] };
  db.writes = 0;
  db.locks = [];
});

describe("PUT /api/staff rule versions", () => {
  it("returns each list's version, computed under the per-person lock", async () => {
    const page = load();
    const r = await save({ ...page, availabilityRules: [AV(1), AV(2)] }, page);
    expect(r.res.status).toBe(200);
    expect(stored("availabilityRules")).toEqual([AV(1), AV(2)]);
    expect(r.row.ruleVersions).toEqual(load().ruleVersions);
    expect(db.locks.some((l) => l.includes("hashtext") && l.endsWith("s1"))).toBe(true);
  });

  it("a: another tab adds a rule → a name-only save here → an availability edit here is refused; the other rule stays", async () => {
    const page = load();
    const other = load();
    expect((await save({ ...other, availabilityRules: [AV(1), AV(3)] }, other)).res.status).toBe(200);
    const s1 = await save({ ...page, name: "Anne" }, page);
    expect(s1.res.status).toBe(200);
    expect(db.staff.name).toBe("Anne");
    expect(stored("availabilityRules")).toEqual([AV(1), AV(3)]);
    const writes = db.writes;
    const p = rulesPatch({ ...s1.row, availabilityRules: [] }, s1.row);
    const res = await PUT(req({ id: "s1", name: s1.row.name, ...p.lists, ruleBases: p.ruleBases }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("stale");
    expect(db.writes).toBe(writes);
    expect(stored("availabilityRules")).toEqual([AV(1), AV(3)]);
  });

  it("b: same start → name-only save → Undo reverts only the name; the other tab's rule stays", async () => {
    const page = load();
    const other = load();
    await save({ ...other, availabilityRules: [AV(1), AV(3)] }, other);
    const s1 = await save({ ...page, name: "Anne" }, page);
    const u = undoRulesPatch(page, s1.row, s1.sent);
    const res = await PUT(req({ id: "s1", name: page.name, ...u.lists, ruleBases: u.ruleBases }));
    expect(res.status).toBe(200);
    expect(db.staff.name).toBe("Ann");
    expect(stored("availabilityRules")).toEqual([AV(1), AV(3)]);
  });

  it("c: a rule save → another tab edits the same list → Undo is refused, nothing changes", async () => {
    const page = load();
    const s1 = await save({ ...page, availabilityRules: [AV(1), AV(2)] }, page);
    const other = load();
    await save({ ...other, availabilityRules: [AV(1), AV(2), AV(4)] }, other);
    const u = undoRulesPatch(page, s1.row, s1.sent);
    const writes = db.writes;
    const res = await PUT(req({ id: "s1", name: page.name, ...u.lists, ruleBases: u.ruleBases }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("stale");
    expect(db.writes).toBe(writes);
    expect(stored("availabilityRules")).toEqual([AV(1), AV(2), AV(4)]);
  });

  it("d: a rule save → Undo puts that list back and touches no other list", async () => {
    const page = load();
    const s1 = await save({ ...page, availabilityRules: [AV(2)] }, page);
    const other = load();
    await save({ ...other, shiftOverrides: [{ ...OV, durationHrs: 10 }] }, other);
    const u = undoRulesPatch(page, s1.row, s1.sent);
    expect(Object.keys(u.lists)).toEqual(["availabilityRules"]);
    const res = await PUT(req({ id: "s1", name: page.name, ...u.lists, ruleBases: u.ruleBases }));
    expect(res.status).toBe(200);
    expect(stored("availabilityRules")).toEqual([AV(1)]);
    expect(stored("shiftOverrides")).toEqual([{ ...OV, durationHrs: 10 }]);
  });

  it("e: an old page sending every list with no bases: the stored lists → OK; any list that differs → 409, nothing written", async () => {
    const all = { availabilityRules: [AV(1)], shiftEligibilityRules: [], shiftMinimumTargets: [], standingCommitments: [], shiftOverrides: [OV] };
    expect((await PUT(req({ id: "s1", name: "Anne", ...all }))).status).toBe(200);
    expect(db.staff.name).toBe("Anne");
    const writes = db.writes;
    const res = await PUT(req({ id: "s1", name: "Bea", ...all, availabilityRules: [] }));
    expect(res.status).toBe(409);
    expect(db.writes).toBe(writes);
    expect(db.staff.name).toBe("Anne");
    expect(stored("availabilityRules")).toEqual([AV(1)]);
  });

  it("e2: an old page's rule as it sends it (no strength, undefined fields) still equals the stored row", async () => {
    const res = await PUT(req({ id: "s1", availabilityRules: [{ type: "unavailable", whenKind: "every", whenDays: [1] }], shiftOverrides: [{ shiftTypeId: "call", durationHrs: 12 }] }));
    expect(res.status).toBe(200);
  });

  it("f: one stale base and one fresh base → 409, neither list written", async () => {
    const page = load();
    const other = load();
    await save({ ...other, availabilityRules: [AV(5)] }, other);
    const writes = db.writes;
    const r = await save({ ...page, availabilityRules: [AV(6)], shiftOverrides: [] }, page);
    expect(r.res.status).toBe(409);
    expect(db.writes).toBe(writes);
    expect(stored("availabilityRules")).toEqual([AV(5)]);
    expect(stored("shiftOverrides")).toEqual([OV]);
  });

  it("a malformed base is refused like a stale one", async () => {
    const res = await PUT(req({ id: "s1", availabilityRules: [], ruleBases: { availabilityRules: 7 } }));
    expect(res.status).toBe(409);
    expect(stored("availabilityRules")).toEqual([AV(1)]);
  });
});
