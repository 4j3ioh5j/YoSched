import { describe, it, expect } from "vitest";
import { buildPayload, replaceAll, type Db } from "@/lib/backup/engine";
import type { Catalog, BackupPayload } from "@/lib/backup/tables";

// Card #314: the restore's order of steps, and the two-factor key hand-over.
const catalog: Catalog = [
  { name: "users", columns: [{ name: "id", nullable: false, hasDefault: false }, { name: "groupId", nullable: false, hasDefault: false }, { name: "isActive", nullable: false, hasDefault: true }, { name: "totpSecret", nullable: true, hasDefault: false }], fks: [{ columns: ["groupId"], refTable: "groups", refColumns: ["id"] }], uniques: [] },
  { name: "groups", columns: [{ name: "id", nullable: false, hasDefault: false }, { name: "permissions", nullable: false, hasDefault: true }], fks: [], uniques: [] },
];
const oldKey = { reveal: (s: string) => s.replace(/^old:/, ""), protect: (s: string) => `old:${s}` };
const newKey = { reveal: (s: string) => s.replace(/^new:/, ""), protect: (s: string) => `new:${s}` };

function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const log: string[] = [];
  const db: Db = {
    async query<T>(sql: string): Promise<T[]> {
      const sel = sql.match(/FROM "(\w+)" x/);
      if (sel) return [{ rows: structuredClone(tables[sel[1]] ?? []) }] as T[];
      const cnt = sql.match(/count\(\*\)::int AS n FROM "(\w+)"/);
      if (cnt) return [{ n: (tables[cnt[1]] ?? []).length }] as T[];
      throw new Error("unexpected " + sql);
    },
    async exec(sql: string, ...params: unknown[]) {
      const del = sql.match(/^DELETE FROM "(\w+)"/);
      const ins = sql.match(/^INSERT INTO "(\w+)"/);
      if (del) { tables[del[1]] = []; log.push(`delete ${del[1]}`); }
      else if (ins) { tables[ins[1]] = [...(tables[ins[1]] ?? []), ...JSON.parse(params[0] as string)]; log.push(`insert ${ins[1]}`); }
      else if (sql.startsWith("LOCK")) log.push("lock");
      else if (/DISABLE TRIGGER/.test(sql)) log.push(`pause ${sql.match(/"(\w+)"/)![1]}`);
      else if (/ENABLE TRIGGER/.test(sql)) log.push(`resume ${sql.match(/"(\w+)"/)![1]}`);
      else if (sql.startsWith("UPDATE")) log.push(`recheck ${sql.match(/"(\w+)"/)![1]}`);
      else log.push(sql);
      return 0;
    },
  };
  return { db, log, tables };
}

describe("backup engine (card #314)", () => {
  it("export reveals the two-factor key; restore protects it with the new install's key", async () => {
    const src = fakeDb({ groups: [{ id: "g", permissions: ["users:edit"] }], users: [{ id: "u", groupId: "g", isActive: true, totpSecret: "old:ABC" }] });
    const payload = await buildPayload(src.db, catalog, ["m1"], oldKey, { appVersion: "0.603.0", createdAt: "t" });
    expect(payload.tables.users[0].totpSecret).toBe("ABC");
    expect(payload.counts).toEqual({ users: 1, groups: 1 });
    const dst = fakeDb({ groups: [{ id: "x" }], users: [] });
    await replaceAll(dst.db, catalog, payload, newKey, async () => {});
    expect(dst.tables.users[0].totpSecret).toBe("new:ABC");
    expect(dst.tables.groups).toEqual([{ id: "g", permissions: ["users:edit"] }]);
  });

  it("a backup is checked exactly as a restore would check it, before it is handed out (round 1)", async () => {
    // Same check for the download and for the safety copy taken before a restore deletes anything.
    const src = fakeDb({ groups: [{ id: "g", permissions: [] }], users: [{ id: "u", groupId: "g", isActive: true, totpSecret: null }] });
    await expect(buildPayload(src.db, catalog, [], oldKey, { appVersion: "", createdAt: "" })).rejects.toThrow(/couldn't be restored.*no active login/);
    const dst = fakeDb({ groups: [{ id: "x", permissions: [] }], users: [{ id: "y", groupId: "x", isActive: true, totpSecret: null }] });
    const payload: BackupPayload = { format: 1, appVersion: "", createdAt: "", migrations: [], counts: { groups: 1, users: 1 }, tables: { groups: [{ id: "g", permissions: ["users:edit"] }], users: [{ id: "u", groupId: "g", isActive: true, totpSecret: null }] } };
    const safety = () => buildPayload(dst.db, catalog, [], newKey, { appVersion: "", createdAt: "" }).then(() => undefined);
    await expect(replaceAll(dst.db, catalog, payload, newKey, safety)).rejects.toThrow(/couldn't be restored/);
    expect(dst.tables.users).toEqual([{ id: "y", groupId: "x", isActive: true, totpSecret: null }]);
  });

    it("a two-factor key this server can't read stops the backup instead of losing it", async () => {
    const src = fakeDb({ groups: [], users: [{ id: "u", groupId: "g", totpSecret: "garbled" }] });
    const bad = { ...oldKey, reveal: () => { throw new Error("bad tag"); } };
    await expect(buildPayload(src.db, catalog, [], bad, { appVersion: "", createdAt: "" })).rejects.toThrow(/two-factor key/);
  });

  it("locks first, takes the safety backup before any delete, deletes children first, inserts parents first", async () => {
    const dst = fakeDb({ groups: [{ id: "x" }], users: [{ id: "y", groupId: "x" }] });
    const payload: BackupPayload = { format: 1, appVersion: "", createdAt: "", migrations: [], counts: { groups: 1, users: 1 }, tables: { groups: [{ id: "g" }], users: [{ id: "u", groupId: "g", totpSecret: null }] } };
    await replaceAll(dst.db, catalog, payload, newKey, async () => { dst.log.push("safety backup"); });
    expect(dst.log).toEqual(["lock", "safety backup", "delete users", "delete groups", "insert groups", "insert users"]);
  });

  it("tables with their own checks are paused for the rewrite, then every row is re-checked", async () => {
    const withTriggers: Catalog = [
      { ...catalog[1], triggers: { any: true, onUpdate: false, pk: ["id"] } },
      { name: "cols", columns: [{ name: "id", nullable: false, hasDefault: false }], fks: [], uniques: [], triggers: { any: true, onUpdate: true, pk: ["id"] } },
    ];
    const dst = fakeDb({ groups: [], cols: [] });
    const payload: BackupPayload = { format: 1, appVersion: "", createdAt: "", migrations: [], counts: { groups: 1, cols: 1 }, tables: { groups: [{ id: "g" }], cols: [{ id: "c" }] } };
    await replaceAll(dst.db, withTriggers, payload, newKey, async () => { dst.log.push("safety backup"); });
    expect(dst.log).toEqual(["lock", "safety backup", "pause groups", "pause cols", "delete groups", "delete cols", "insert cols", "insert groups", "resume groups", "resume cols", "recheck cols"]);
  });

  it("a failing safety backup stops the restore before anything is deleted", async () => {
    const dst = fakeDb({ groups: [{ id: "x" }], users: [] });
    const payload: BackupPayload = { format: 1, appVersion: "", createdAt: "", migrations: [], counts: { groups: 1 }, tables: { groups: [{ id: "g" }] } };
    await expect(replaceAll(dst.db, catalog, payload, newKey, async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    expect(dst.tables.groups).toEqual([{ id: "x" }]);
    expect(dst.log).toEqual(["lock"]);
  });

  it("inserts in chunks of 1000 and checks the counts afterwards", async () => {
    const dst = fakeDb({ groups: [], users: [] });
    const groups = Array.from({ length: 2500 }, (_, i) => ({ id: `g${i}` }));
    const payload: BackupPayload = { format: 1, appVersion: "", createdAt: "", migrations: [], counts: { groups: 2500 }, tables: { groups } };
    await replaceAll(dst.db, catalog, payload, newKey, async () => {});
    expect(dst.log.filter((l) => l === "insert groups")).toHaveLength(3);
    expect(dst.tables.groups).toHaveLength(2500);
  });
});
