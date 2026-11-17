import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { topoOrder, validatePayload, EXCLUDED_TABLES, type Catalog, type BackupPayload } from "@/lib/backup/tables";

// Card #314: a file is checked completely before anything is touched.
const catalog: Catalog = [
  { name: "users", columns: [{ name: "id", nullable: false, hasDefault: false }, { name: "groupId", nullable: false, hasDefault: false }, { name: "isActive", nullable: false, hasDefault: true }, { name: "email", nullable: true, hasDefault: false }], fks: [{ columns: ["groupId"], refTable: "groups", refColumns: ["id"] }], uniques: [["email"]] },
  { name: "groups", columns: [{ name: "id", nullable: false, hasDefault: false }, { name: "permissions", nullable: false, hasDefault: true }], fks: [], uniques: [] },
  { name: "staff", columns: [{ name: "id", nullable: false, hasDefault: false }, { name: "name", nullable: false, hasDefault: false }], fks: [], uniques: [] },
];
const MIG = ["m1", "m2"];
function good(): BackupPayload {
  return {
    format: 1, appVersion: "0.603.0", createdAt: "2026-11-17T00:00:00Z", migrations: ["m1"],
    counts: { groups: 1, users: 1, staff: 1 },
    tables: { groups: [{ id: "g1", permissions: ["users:edit", "groups:edit", "data:backup"] }], users: [{ id: "u1", groupId: "g1", isActive: true, email: "a@x" }], staff: [{ id: "s1", name: "Ann" }] },
  };
}
const check = (p: unknown) => () => validatePayload(p, catalog, MIG);

describe("topoOrder (card #314)", () => {
  it("parents come before children; a cycle is refused", () => {
    const order = topoOrder(catalog);
    expect(order.indexOf("groups")).toBeLessThan(order.indexOf("users"));
    expect(() => topoOrder([{ name: "a", columns: [], fks: [{ columns: ["b"], refTable: "b", refColumns: ["id"] }], uniques: [] }, { name: "b", columns: [], fks: [{ columns: ["a"], refTable: "a", refColumns: ["id"] }], uniques: [] }])).toThrow(/cycle/);
  });
});

describe("validatePayload (card #314)", () => {
  it("accepts a good file (an older one: fewer migrations) and returns the counts", () => {
    expect(validatePayload(good(), catalog, MIG)).toEqual({ users: 1, groups: 1, staff: 1 });
  });
  it("refuses a file from a newer YoSched", () => {
    const p = good(); p.migrations.push("m9");
    expect(check(p)).toThrow(/newer YoSched/);
  });
  it("refuses an unknown table or column instead of dropping it", () => {
    const p = good(); p.tables.mystery = []; p.counts.mystery = 0;
    expect(check(p)).toThrow(/table this YoSched doesn't have: mystery/);
    const q = good(); q.tables.staff[0].nickname = "A";
    expect(check(q)).toThrow(/column this YoSched doesn't know: nickname/);
  });
  it("refuses a missing required value, and a null in a NOT NULL column", () => {
    const p = good(); delete p.tables.staff[0].name;
    expect(check(p)).toThrow(/missing name/);
    const q = good(); q.tables.users[0].isActive = null;
    expect(check(q)).toThrow(/has no isActive/);
  });
  it("refuses counts that don't match (truncated table) and a listed table that's absent", () => {
    const p = good(); p.counts.staff = 2;
    expect(check(p)).toThrow(/incomplete/);
    const q = good(); delete (q.tables as Record<string, unknown>).staff;
    expect(check(q)).toThrow(/incomplete/);
  });
  it("refuses a dangling reference and a repeated unique value", () => {
    const p = good(); p.tables.users[0].groupId = "nope";
    expect(check(p)).toThrow(/points to a missing groups row/);
    const q = good(); q.tables.users.push({ id: "u2", groupId: "g1", isActive: true, email: "a@x" }); q.counts.users = 2;
    expect(check(q)).toThrow(/repeats email/);
  });
  it("asks only what YoSched itself guarantees: an active login that can manage users (round 1)", () => {
    // YoSched never lets the last active users:edit login go, so every live database passes this,
    // and a backup it makes is always restorable. Asking more (groups:edit, data:backup) refused
    // backups of allowed setups.
    const p = good(); p.tables.groups[0].permissions = ["users:edit"];
    expect(validatePayload(p, catalog, MIG).users).toBe(1);
  });
  it("refuses a file that would leave nobody able to administer YoSched", () => {
    const p = good(); p.tables.groups[0].permissions = ["groups:edit", "data:backup"];
    expect(check(p)).toThrow(/no active login that can manage users/);
    const q = good(); q.tables.users[0].isActive = false;
    expect(check(q)).toThrow(/no active login/);
    const r = good(); r.tables.users = []; r.counts.users = 0;
    expect(check(r)).toThrow(/no logins/);
  });
  it("refuses rows that differ in their columns", () => {
    const p = good(); p.tables.staff.push({ id: "s2", name: "Bo", }); p.counts.staff = 2;
    expect(validatePayload(p, catalog, MIG).staff).toBe(2);
    const q = good(); q.tables.users.push({ id: "u2", groupId: "g1", isActive: true }); q.counts.users = 2;
    expect(check(q)).toThrow(/rows differ/);
  });
  it("refuses a malformed payload", () => {
    expect(check(null)).toThrow(/expected shape/);
    expect(check({ format: 2 })).toThrow(/expected shape/);
  });
});

describe("EXCLUDED_TABLES names real tables (card #314)", () => {
  it("each is a model's table or Prisma's ledger", () => {
    const schema = readFileSync(path.resolve(__dirname, "../../../prisma/schema.prisma"), "utf8");
    const tables = new Set([...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1]));
    for (const t of EXCLUDED_TABLES) if (t !== "_prisma_migrations") expect(tables.has(t), t).toBe(true);
  });
});
