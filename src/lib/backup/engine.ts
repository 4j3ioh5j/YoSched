// Card #314: read every included table into a payload, and write a payload back. Pure over
// an injected Db so the order of steps is testable; src/lib/backup/service.ts wires it to a
// Prisma transaction held under the write gate.

import { BackupFileError } from "./format";
import { EXCLUDED_TABLES, topoOrder, validatePayload, type BackupPayload, type Catalog, type TableInfo } from "./tables";

export type Db = {
  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  exec(sql: string, ...params: unknown[]): Promise<number>;
};

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const INSERT_CHUNK = 1000;

/** The live catalog of the tables a backup holds (every base table minus EXCLUDED_TABLES). */
export async function readCatalog(db: Db): Promise<Catalog> {
  const tables = await db.query<{ t: string }>(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY 1`);
  const cols = await db.query<{ t: string; c: string; nullable: boolean; has_default: boolean }>(
    `SELECT table_name AS t, column_name AS c, is_nullable = 'YES' AS nullable,
            (column_default IS NOT NULL OR is_identity = 'YES' OR is_generated <> 'NEVER') AS has_default
       FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position`);
  const fks = await db.query<{ t: string; ref: string; cols: string[]; refcols: string[] }>(
    `SELECT c.conrelid::regclass::text AS t, c.confrelid::regclass::text AS ref,
            ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n, o) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.o) AS cols,
            ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n, o) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.o) AS refcols
       FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = current_schema()::regnamespace`);
  const uniques = await db.query<{ t: string; cols: string[] }>(
    `SELECT i.indrelid::regclass::text AS t,
            ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(n, o) JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.n ORDER BY k.o) AS cols
       FROM pg_index i JOIN pg_class r ON r.oid = i.indrelid
      WHERE i.indisunique AND i.indpred IS NULL AND 0 <> ALL (i.indkey) AND r.relnamespace = current_schema()::regnamespace`);
  const trig = await db.query<{ t: string; on_update: boolean }>(
    `SELECT c.relname AS t, bool_or((t.tgtype & 16) <> 0) AS on_update
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.relnamespace = current_schema()::regnamespace GROUP BY 1`);
  const pks = await db.query<{ t: string; cols: string[] }>(
    `SELECT i.indrelid::regclass::text AS t,
            ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(n, o) JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.n ORDER BY k.o) AS cols
       FROM pg_index i JOIN pg_class r ON r.oid = i.indrelid WHERE i.indisprimary AND r.relnamespace = current_schema()::regnamespace`);
  const excluded = new Set<string>(EXCLUDED_TABLES);
  const unq = (s: string) => s.replace(/^"|"$/g, "");
  return tables.map(({ t }) => t).filter((t) => !excluded.has(t)).map((t): TableInfo => ({
    name: t,
    columns: cols.filter((c) => c.t === t).map((c) => ({ name: c.c, nullable: c.nullable, hasDefault: c.has_default })),
    fks: fks.filter((f) => unq(f.t) === t && !excluded.has(unq(f.ref))).map((f) => ({ columns: f.cols, refTable: unq(f.ref), refColumns: f.refcols })),
    uniques: uniques.filter((u) => unq(u.t) === t).map((u) => u.cols),
    triggers: (() => {
      const tr = trig.find((x) => x.t === t);
      return tr ? { any: true, onUpdate: tr.on_update, pk: pks.find((k) => unq(k.t) === t)?.cols ?? [] } : undefined;
    })(),
  }));
}

export async function appliedMigrations(db: Db): Promise<string[]> {
  const rows = await db.query<{ m: string }>(
    `SELECT migration_name AS m FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1`);
  return rows.map((r) => r.m);
}

export type SecretCodec = { reveal(stored: string): string; protect(plain: string): string };

/** Every included table, as Postgres renders it to JSON (exact for every column type we use).
 *  users.totpSecret leaves encrypted with this install's key and is stored plain INSIDE the
 *  encrypted file, so a new install with a new key can still use it. */
export async function buildPayload(db: Db, catalog: Catalog, migrations: string[], secrets: SecretCodec, meta: { appVersion: string; createdAt: string }): Promise<BackupPayload> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of catalog) {
    const [row] = await db.query<{ rows: Record<string, unknown>[] }>(`SELECT coalesce(json_agg(x), '[]'::json) AS rows FROM ${q(t.name)} x`);
    tables[t.name] = row.rows;
  }
  for (const u of tables.users ?? []) {
    if (typeof u.totpSecret === "string" && u.totpSecret) {
      try { u.totpSecret = secrets.reveal(u.totpSecret); } catch {
        throw new BackupFileError("A login's two-factor key can't be read with this server's key, so a backup would lose it. Nothing was saved.");
      }
    }
  }
  const payload: BackupPayload = { format: 1, appVersion: meta.appVersion, createdAt: meta.createdAt, migrations, counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), tables };
  // Every backup (the download and the safety copy a restore takes before deleting anything)
  // passes the exact check a restore applies, so a file that is handed out can be restored.
  try { validatePayload(payload, catalog, migrations); } catch (e) {
    if (e instanceof BackupFileError) throw new BackupFileError(`This backup couldn't be restored, so it wasn't made and nothing was changed: ${e.message.replace(/^The backup /, "the data ")}`);
    throw e;
  }
  return payload;
}

/** Replace every included table with the payload's rows. The caller has validated the payload
 *  against this catalog, holds the write gate exclusively and runs this in one transaction.
 *  `beforeDelete` runs after the locks and before the first delete (the safety backup). */
export async function replaceAll(db: Db, catalog: Catalog, payload: BackupPayload, secrets: SecretCodec, beforeDelete: () => Promise<void>): Promise<void> {
  const order = topoOrder(catalog);
  await db.exec(`LOCK TABLE ${order.map(q).join(", ")} IN ACCESS EXCLUSIVE MODE`);
  await beforeDelete();
  // The tables' own triggers check references FKs can't express (shift ids inside lists) and
  // would refuse rows written before the table they point to. Pause them for the rewrite (this
  // transaction only: a rollback restores them), then re-run every row through them below.
  const triggered = catalog.filter((t) => t.triggers?.any);
  for (const t of triggered) await db.exec(`ALTER TABLE ${q(t.name)} DISABLE TRIGGER USER`);
  for (const t of [...order].reverse()) await db.exec(`DELETE FROM ${q(t)}`);
  for (const t of order) {
    const rows = (payload.tables[t] ?? []).map((r) => (t === "users" && typeof r.totpSecret === "string" && r.totpSecret ? { ...r, totpSecret: secrets.protect(r.totpSecret) } : r));
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const cols = Object.keys(chunk[0]).map(q).join(", ");
      await db.exec(`INSERT INTO ${q(t)} (${cols}) SELECT ${cols} FROM json_populate_recordset(NULL::${q(t)}, $1::json)`, JSON.stringify(chunk));
    }
  }
  for (const t of triggered) await db.exec(`ALTER TABLE ${q(t.name)} ENABLE TRIGGER USER`);
  for (const t of triggered) {
    if (!t.triggers!.onUpdate) continue;
    if (!t.triggers!.pk.length) throw new Error(`Can't re-check ${t.name}: it has no primary key`);
    const pk = q(t.triggers!.pk[0]);
    await db.exec(`UPDATE ${q(t.name)} SET ${pk} = ${pk}`); // fires the row checks on every restored row
  }
  for (const t of order) {
    const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${q(t)}`);
    const want = (payload.tables[t] ?? []).length;
    if (n !== want) throw new Error(`Restore check failed for ${t}: ${n} rows, expected ${want}`);
  }
}
