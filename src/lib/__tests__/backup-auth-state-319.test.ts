import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validatePayload, EXCLUDED_TABLES, type Catalog, type BackupPayload } from "@/lib/backup/tables";

// Card #319: the install's auth epoch is never carried in a backup. A file from an older
// exporter (after a code-only rollback) that holds auth_state is accepted with that table
// IGNORED — never rejected, never restored (r3 warning).
const catalog: Catalog = [
  { name: "users", columns: [{ name: "id", nullable: false, hasDefault: false }, { name: "groupId", nullable: false, hasDefault: false }, { name: "isActive", nullable: false, hasDefault: true }], fks: [{ columns: ["groupId"], refTable: "groups", refColumns: ["id"] }], uniques: [] },
  { name: "groups", columns: [{ name: "id", nullable: false, hasDefault: false }, { name: "permissions", nullable: false, hasDefault: true }], fks: [], uniques: [] },
];
const payload = (extra: Record<string, Record<string, unknown>[]>): BackupPayload => {
  const tables = { groups: [{ id: "g1", permissions: ["users:edit", "groups:edit", "data:backup"] }], users: [{ id: "u1", groupId: "g1", isActive: true }], ...extra };
  return { format: 1, appVersion: "0.604.1", createdAt: "2026-11-17T00:00:00Z", migrations: ["m1"], counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), tables };
};

describe("auth_state never travels in a backup (card #319)", () => {
  it("auth_state is an excluded table", () => {
    expect(EXCLUDED_TABLES).toContain("auth_state");
  });

  it("a file holding auth_state (or another excluded table) is accepted and the table is ignored", () => {
    const counts = validatePayload(payload({ auth_state: [{ id: "default", epoch: "OLD" }], login_logs: [{ id: "l1" }] }), catalog, ["m1"]);
    expect(counts).toEqual({ users: 1, groups: 1 });
    expect(counts).not.toHaveProperty("auth_state");
  });

  it("a truly unknown table is still refused", () => {
    expect(() => validatePayload(payload({ mystery: [] }), catalog, ["m1"])).toThrow(/doesn't have: mystery/);
  });

  it("restoreBackup rotates the epoch inside the restore transaction", () => {
    const src = readFileSync(path.resolve(__dirname, "../backup/service.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function restoreBackup"), src.indexOf("async function pruneSafetyFiles"));
    expect(fn).toMatch(/replaceAll\([\s\S]*rotateEpoch\(db\)[\s\S]*\}, TX\)/);
  });
});
