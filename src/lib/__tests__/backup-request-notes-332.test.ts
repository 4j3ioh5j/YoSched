import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validatePayload, EXCLUDED_TABLES, type Catalog, type BackupPayload } from "@/lib/backup/tables";

// Card #332: notes on archived Requests lines (request_day_notes) travel in a backup like any
// other table, and the restore check never asks whether a note's day is archived — a backup
// taken before the archive wait changed must still restore.
const col = (name: string, nullable = false, hasDefault = false) => ({ name, nullable, hasDefault });
const catalog: Catalog = [
  { name: "users", columns: [col("id"), col("groupId"), col("isActive", false, true)], fks: [{ columns: ["groupId"], refTable: "groups", refColumns: ["id"] }], uniques: [] },
  { name: "groups", columns: [col("id"), col("permissions", false, true)], fks: [], uniques: [] },
  { name: "staff", columns: [col("id"), col("initials")], fks: [], uniques: [["initials"]] },
  {
    name: "request_day_notes",
    columns: [col("id"), col("staffId"), col("date"), col("note"), col("updatedAt")],
    fks: [{ columns: ["staffId"], refTable: "staff", refColumns: ["id"] }],
    uniques: [["staffId", "date"]],
  },
];
const payload = (notes: Record<string, unknown>[]): BackupPayload => {
  const tables = {
    groups: [{ id: "g1", permissions: ["users:edit", "groups:edit", "data:backup"] }],
    users: [{ id: "u1", groupId: "g1", isActive: true }],
    staff: [{ id: "s1", initials: "BR" }],
    request_day_notes: notes,
  };
  return { format: 1, appVersion: "0.609.0", createdAt: "2027-02-10T00:00:00Z", migrations: ["m1"], counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), tables };
};
const note = (over: Record<string, unknown> = {}) => ({ id: "n1", staffId: "s1", date: "2027-01-18", note: "Had HOL", updatedAt: "2027-02-02T10:00:00Z", ...over });

describe("request_day_notes in a backup (card #332)", () => {
  it("is backed up (not an excluded table)", () => {
    expect(EXCLUDED_TABLES as readonly string[]).not.toContain("request_day_notes");
  });
  it("restores notes on any day, archived or not (the archive wait may have changed since)", () => {
    const counts = validatePayload(payload([note(), note({ id: "n2", date: "2099-12-31" })]), catalog, ["m1"]);
    expect(counts.request_day_notes).toBe(2);
  });
  it("refuses a note for a missing person, a repeated day, or no text", () => {
    expect(() => validatePayload(payload([note({ staffId: "gone" })]), catalog, ["m1"])).toThrow(/request_day_notes table points to a missing staff/);
    expect(() => validatePayload(payload([note(), note({ id: "n2" })]), catalog, ["m1"])).toThrow(/request_day_notes table repeats staffId, date/);
    expect(() => validatePayload(payload([note({ note: null })]), catalog, ["m1"])).toThrow(/request_day_notes/);
  });
  it("the migration makes the table the catalog describes: unique per person and day, removed with the person", () => {
    const sql = readFileSync(path.join(__dirname, "../../../prisma/migrations/20261208000000_request_archive/migration.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE "request_day_notes"/);
    expect(sql).toMatch(/UNIQUE INDEX "request_day_notes_staffId_date_key" ON "request_day_notes"\("staffId", "date"\)/);
    expect(sql).toMatch(/REFERENCES "staff"\("id"\) ON DELETE CASCADE/);
    expect(sql).toMatch(/"requestArchiveDays" INTEGER NOT NULL DEFAULT 0/);
    expect(sql).toMatch(/"archiveLeaveMetBy" TEXT NOT NULL DEFAULT 'any-off'/);
  });
});
