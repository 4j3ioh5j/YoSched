// Card #323: a backup made before the paper and margin settings existed still restores; the
// two columns then take their defaults (the restore inserts only the columns a row carries).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validatePayload, type Catalog, type BackupPayload } from "@/lib/backup/tables";

const catalog: Catalog = [
  { name: "groups", columns: [{ name: "id", nullable: false, hasDefault: false }, { name: "permissions", nullable: false, hasDefault: true }], fks: [], uniques: [] },
  { name: "users", columns: [{ name: "id", nullable: false, hasDefault: false }, { name: "groupId", nullable: false, hasDefault: false }, { name: "isActive", nullable: false, hasDefault: true }], fks: [{ columns: ["groupId"], refTable: "groups", refColumns: ["id"] }], uniques: [] },
  { name: "scheduling_preferences", columns: [
    { name: "id", nullable: false, hasDefault: true },
    { name: "printFontSize", nullable: false, hasDefault: true },
    { name: "printPaperSize", nullable: false, hasDefault: true },
    { name: "printMarginHundredthsIn", nullable: false, hasDefault: true },
  ], fks: [], uniques: [] },
];
const old = (): BackupPayload => ({
  format: 1, appVersion: "0.607.1", createdAt: "2026-11-17T00:00:00Z", migrations: ["m1"],
  counts: { groups: 1, users: 1, scheduling_preferences: 1 },
  tables: {
    groups: [{ id: "g1", permissions: ["users:edit", "groups:edit", "data:backup"] }],
    users: [{ id: "u1", groupId: "g1", isActive: true }],
    scheduling_preferences: [{ id: "default", printFontSize: 9 }],
  },
});

describe("old backup without paper/margin (card #323)", () => {
  it("passes the restore check", () => {
    expect(validatePayload(old(), catalog, ["m1", "20261207000000_print_paper"])).toMatchObject({ scheduling_preferences: 1 });
  });
  it("the migration gives both columns NOT NULL defaults, so the missing values become letter / 25", () => {
    const sql = readFileSync(path.join(__dirname, "../../../prisma/migrations/20261207000000_print_paper/migration.sql"), "utf8");
    expect(sql).toMatch(/ADD COLUMN "printPaperSize" TEXT NOT NULL DEFAULT 'letter'/);
    expect(sql).toMatch(/ADD COLUMN "printMarginHundredthsIn" INTEGER NOT NULL DEFAULT 25/);
  });
  it("the restore inserts only the columns each row carries", () => {
    const engine = readFileSync(path.join(__dirname, "../backup/engine.ts"), "utf8");
    expect(engine).toMatch(/const cols = Object\.keys\(chunk\[0\]\)\.map\(q\)\.join\(", "\);/);
  });
});
