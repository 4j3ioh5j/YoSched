import { open, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { writeGate } from "@/lib/write-gate";
import { decodeBackup, encodeBackup, BackupFileError } from "./format";
import { validatePayload, type BackupPayload } from "./tables";
import { appliedMigrations, buildPayload, readCatalog, replaceAll, type Db, type SecretCodec } from "./engine";

// Card #314: backup and restore, wired to the database. Both hold the write gate EXCLUSIVELY:
// every in-flight request has finished before the first read, and no request runs until the
// restore has committed (src/lib/write-gate.ts).

const TX = { timeout: 120_000, maxWait: 30_000 };
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export function backupDir(): string {
  return process.env.YOSCHED_BACKUP_DIR || path.join(os.homedir(), "yosched-backups");
}

const secrets: SecretCodec = { reveal: decrypt, protect: encrypt };
type Tx = Prisma.TransactionClient;
const asDb = (tx: Tx): Db => ({
  query: <T>(sql: string, ...params: unknown[]) => tx.$queryRawUnsafe<T[]>(sql, ...params),
  exec: (sql: string, ...params: unknown[]) => tx.$executeRawUnsafe(sql, ...params),
});
const meta = () => ({ appVersion: process.env.YOSCHED_VERSION ?? "", createdAt: new Date().toISOString() });

async function markBackedUp(db: Db, at: Date): Promise<void> {
  await db.exec(
    `INSERT INTO "backup_status" ("id", "lastBackupAt", "updatedAt") VALUES ('default', $1, now())
     ON CONFLICT ("id") DO UPDATE SET "lastBackupAt" = EXCLUDED."lastBackupAt", "updatedAt" = now()`, at);
}

async function snapshot(tx: Tx): Promise<BackupPayload> {
  const db = asDb(tx);
  const catalog = await readCatalog(db);
  return buildPayload(db, catalog, await appliedMigrations(db), secrets, meta());
}

/** A backup file of everything, from one consistent snapshot. */
export async function createBackup(passphrase: string): Promise<{ bytes: Buffer; createdAt: Date }> {
  return writeGate.exclusive(async () => {
    const payload = await prisma.$transaction((tx) => snapshot(tx), { ...TX, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const bytes = await encodeBackup(payload, passphrase);
    const createdAt = new Date(payload.createdAt);
    await prisma.$transaction((tx) => markBackedUp(asDb(tx), createdAt));
    return { bytes, createdAt };
  });
}

export type BackupSummary = { createdAt: string; appVersion: string; counts: Record<string, number> };

/** Decode and check a file against this database, changing nothing. */
export async function checkBackup(bytes: Buffer, passphrase: string): Promise<BackupSummary> {
  const payload = (await decodeBackup(bytes, passphrase)) as BackupPayload;
  const counts = await prisma.$transaction(async (tx) => {
    const db = asDb(tx);
    return validatePayload(payload, await readCatalog(db), await appliedMigrations(db));
  });
  return { createdAt: String(payload.createdAt), appVersion: String(payload.appVersion ?? ""), counts };
}

export class NotEmptyError extends Error {
  constructor() { super("YoSched already has data, so a first-run restore isn't allowed. Sign in and use Settings › Backup and Restore."); this.name = "NotEmptyError"; }
}

async function writeSafetyFile(bytes: Buffer): Promise<string> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `pre-restore-${stamp}.yosched-backup`);
  const fh = await open(file, "wx", 0o600);
  try { await fh.writeFile(bytes); await fh.sync(); } finally { await fh.close(); }
  return file;
}

/** Replace everything with the file's contents. "initial" only on an empty install;
 *  "replace" first saves what is there now (encrypted with the same passphrase). */
export async function restoreBackup(bytes: Buffer, passphrase: string, mode: "initial" | "replace"): Promise<{ counts: Record<string, number>; safetyFile: string | null }> {
  const payload = (await decodeBackup(bytes, passphrase)) as BackupPayload; // CPU work, outside the gate
  return writeGate.exclusive(() => prisma.$transaction(async (tx) => {
    const db = asDb(tx);
    const catalog = await readCatalog(db);
    const counts = validatePayload(payload, catalog, await appliedMigrations(db));
    let safetyFile: string | null = null;
    await replaceAll(db, catalog, payload, secrets, async () => {
      if (mode === "initial") {
        const [row] = await db.query<{ n: number }>(`SELECT ((SELECT count(*) FROM "users") + (SELECT count(*) FROM "staff") + (SELECT count(*) FROM "assignments"))::int AS n`);
        if (row.n > 0) throw new NotEmptyError();
      } else {
        const current = await buildPayload(db, catalog, await appliedMigrations(db), secrets, meta());
        safetyFile = await writeSafetyFile(await encodeBackup(current, passphrase));
      }
    });
    await markBackedUp(db, new Date());
    return { counts, safetyFile };
  }, TX));
}

export async function lastBackupAt(): Promise<Date | null> {
  const row = await prisma.backupStatus.findUnique({ where: { id: "default" } });
  return row?.lastBackupAt ?? null;
}

export { BackupFileError };
