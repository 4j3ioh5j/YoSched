// Card #314: what a backup holds and how a file is checked, driven by the LIVE database
// catalog (information_schema + pg_constraint), so a new table is included without code
// changes and an older file's missing columns take their database defaults.

import { BackupFileError } from "./format";
import { ADMIN_PERMISSION } from "@/lib/user-admin-safety";

/** Never backed up: sign-in history, who's online, the backup bookkeeping itself, Prisma's
 *  migration ledger (the file records migration names separately) and the install's auth
 *  epoch (card #319: a restore rotates it instead). A file that holds one of these anyway
 *  (an older exporter) has that table ignored. */
export const EXCLUDED_TABLES = ["login_logs", "user_activity", "backup_status", "_prisma_migrations", "auth_state"] as const;
const IGNORED = new Set<string>(EXCLUDED_TABLES);

export type Column = { name: string; nullable: boolean; hasDefault: boolean };
export type ForeignKey = { columns: string[]; refTable: string; refColumns: string[] };
export type TableInfo = {
  name: string; columns: Column[]; fks: ForeignKey[]; uniques: string[][];
  /** Has its own (non-FK) triggers: they're paused while rows are replaced, then re-run. */
  triggers?: { any: boolean; onUpdate: boolean; pk: string[] };
};
export type Catalog = TableInfo[];

export type BackupPayload = {
  format: 1;
  appVersion: string;
  createdAt: string;
  migrations: string[];
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
};

/** Parents before children (FK order). Self-references are ignored; a cycle is an error. */
export function topoOrder(catalog: Catalog): string[] {
  const names = new Set(catalog.map((t) => t.name));
  const deps = new Map(catalog.map((t) => [t.name, new Set(t.fks.map((f) => f.refTable).filter((r) => r !== t.name && names.has(r)))]));
  const out: string[] = [];
  const left = new Set(names);
  while (left.size) {
    const ready = [...left].filter((n) => [...deps.get(n)!].every((d) => !left.has(d))).sort();
    if (!ready.length) throw new Error(`Foreign keys form a cycle among: ${[...left].join(", ")}`);
    for (const n of ready) { out.push(n); left.delete(n); }
  }
  return out;
}

// What YoSched itself guarantees of every database (src/lib/user-admin-safety.ts): an active
// login whose group can manage users. Asking more would refuse backups of allowed setups.
const REQUIRED_ADMIN = [ADMIN_PERMISSION];
const fail = (m: string): never => { throw new BackupFileError(m); };
const tupleKey = (row: Record<string, unknown>, cols: string[]) => {
  const vals = cols.map((c) => row[c]);
  return vals.some((v) => v === null || v === undefined) ? null : JSON.stringify(vals);
};

/** Check a decoded file against this database BEFORE anything is touched. Throws a
 *  BackupFileError naming the first problem; returns the per-table row counts. */
export function validatePayload(raw: unknown, catalog: Catalog, appliedMigrations: string[]): Record<string, number> {
  const p = raw as BackupPayload;
  if (!p || typeof p !== "object" || p.format !== 1 || typeof p.tables !== "object" || !p.tables || !Array.isArray(p.migrations) || typeof p.counts !== "object" || !p.counts) {
    fail("The backup file's contents are not in the expected shape");
  }
  const applied = new Set(appliedMigrations);
  const unknownMig = p.migrations.filter((m) => !applied.has(m));
  if (unknownMig.length) fail("This backup was made by a newer YoSched (its database has changes this one doesn't). Update YoSched first, then restore it.");

  const byName = new Map(catalog.map((t) => [t.name, t]));
  for (const name of Object.keys(p.tables)) {
    if (IGNORED.has(name) && !byName.has(name)) continue; // card #319: never restored, never refused
    if (!byName.has(name)) fail(`The backup holds a table this YoSched doesn't have: ${name}`);
    if (!Array.isArray(p.tables[name])) fail(`The backup's ${name} table is damaged`);
    if (p.counts[name] !== p.tables[name].length) fail(`The backup's ${name} table is incomplete`);
  }
  if (Object.keys(p.counts).some((n) => !(n in p.tables) && !IGNORED.has(n))) fail("The backup is incomplete: a table listed in it is missing");

  const rows = (t: string) => p.tables[t] ?? [];
  for (const t of catalog) {
    const cols = new Map(t.columns.map((c) => [c.name, c]));
    const required = t.columns.filter((c) => !c.nullable && !c.hasDefault).map((c) => c.name);
    let shape: string | null = null;
    for (const row of rows(t.name)) {
      if (!row || typeof row !== "object" || Array.isArray(row)) fail(`The backup's ${t.name} table is damaged`);
      // Every row carries the same columns (a missing one would be inserted as NULL, not its default).
      const keys = Object.keys(row).sort().join(",");
      if (shape === null) shape = keys; else if (keys !== shape) fail(`The backup's ${t.name} table is damaged (rows differ in their columns)`);
      for (const k of Object.keys(row)) if (!cols.has(k)) fail(`The backup's ${t.name} table has a column this YoSched doesn't know: ${k}. Nothing was changed.`);
      for (const k of required) if (row[k] === null || row[k] === undefined) fail(`A row in the backup's ${t.name} table is missing ${k}`);
      for (const [k, v] of Object.entries(row)) if (v === null && cols.get(k) && !cols.get(k)!.nullable) fail(`A row in the backup's ${t.name} table has no ${k}`);
    }
    for (const u of t.uniques) {
      const seen = new Set<string>();
      for (const row of rows(t.name)) {
        const k = tupleKey(row, u);
        if (k === null) continue;
        if (seen.has(k)) fail(`The backup's ${t.name} table repeats ${u.join(", ")} = ${k}`);
        seen.add(k);
      }
    }
    for (const fk of t.fks) {
      const targets = new Set(rows(fk.refTable).map((r) => tupleKey(r, fk.refColumns)).filter((k): k is string => k !== null));
      for (const row of rows(t.name)) {
        const k = tupleKey(row, fk.columns);
        if (k !== null && !targets.has(k)) fail(`A row in the backup's ${t.name} table points to a missing ${fk.refTable} row`);
      }
    }
  }

  if (!rows("users").length) fail("The backup has no logins, so nobody could sign in after restoring it");
  const adminGroups = new Set(rows("groups")
    .filter((g) => Array.isArray(g.permissions) && REQUIRED_ADMIN.every((x) => (g.permissions as unknown[]).includes(x)))
    .map((g) => g.id));
  if (!rows("users").some((u) => u.isActive === true && adminGroups.has(u.groupId))) {
    fail("The backup has no active login that can manage users, so nobody could administer YoSched after restoring it");
  }
  return Object.fromEntries(catalog.map((t) => [t.name, rows(t.name).length]));
}
