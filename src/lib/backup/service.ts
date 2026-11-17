import os from "node:os";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { writeGate } from "@/lib/write-gate";
import { decodeBackup, encodeBackup, BackupFileError, MAX_FILE_BYTES } from "./format";
import { planSafetyPrune } from "./auto";
import { listBackupFolder, removeFiles, writeAtomic } from "./files";
import { validatePayload, type BackupPayload } from "./tables";
import { appliedMigrations, buildPayload, readCatalog, replaceAll, type Db, type SecretCodec } from "./engine";

// Card #314: backup and restore, wired to the database. Both hold the write gate EXCLUSIVELY:
// every in-flight request has finished before the first read, and no request runs until the
// restore has committed (src/lib/write-gate.ts).

const TX = { timeout: 120_000, maxWait: 30_000 };
/** The largest file a restore accepts — and so the largest any backup may be (card #315). */
export const MAX_UPLOAD_BYTES = MAX_FILE_BYTES;

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

export async function markBackedUp(db: Db, at: Date): Promise<void> {
  await db.exec(
    `INSERT INTO "backup_status" ("id", "lastBackupAt", "updatedAt") VALUES ('default', $1, now())
     ON CONFLICT ("id") DO UPDATE SET "lastBackupAt" = EXCLUDED."lastBackupAt", "updatedAt" = now()`, at);
}

export const asDbOf = asDb;

async function snapshot(tx: Tx): Promise<BackupPayload> {
  const db = asDb(tx);
  const catalog = await readCatalog(db);
  return buildPayload(db, catalog, await appliedMigrations(db), secrets, meta());
}

/** Everything, from one consistent snapshot, checked as a restore would check it. Hold the gate exclusively. */
export function snapshotPayload(): Promise<BackupPayload> {
  return prisma.$transaction((tx) => snapshot(tx), { ...TX, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

/** A backup file of everything, from one consistent snapshot. */
export async function createBackup(passphrase: string): Promise<{ bytes: Buffer; createdAt: Date }> {
  return writeGate.exclusive(async () => {
    const payload = await snapshotPayload();
    const bytes = await encodeBackup(payload, passphrase);
    const createdAt = new Date(payload.createdAt);
    await prisma.$transaction((tx) => markBackedUp(asDb(tx), createdAt));
    return { bytes, createdAt };
  });
}

export type BackupSummary = { createdAt: string; appVersion: string; counts: Record<string, number> };

/** Decode and check a file against this database, changing nothing. */
export async function checkBackup(bytes: Buffer, passphrase: string, keyFile: Buffer | null = null): Promise<BackupSummary> {
  const payload = (await decodeBackup(bytes, passphrase, { keyFile })) as BackupPayload;
  const counts = await prisma.$transaction(async (tx) => {
    const db = asDb(tx);
    return validatePayload(payload, await readCatalog(db), await appliedMigrations(db));
  });
  return { createdAt: String(payload.createdAt), appVersion: String(payload.appVersion ?? ""), counts };
}

export class NotEmptyError extends Error {
  constructor() { super("YoSched already has data, so a first-run restore isn't allowed. Sign in and use Settings › Backup and Restore."); this.name = "NotEmptyError"; }
}

/** Written whole and synced, folder included, before the restore replaces anything (r1). */
async function writeSafetyFile(bytes: Buffer): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return writeAtomic(backupDir(), `pre-restore-${stamp}.yosched-backup`, bytes);
}

/** Replace everything with the file's contents. "initial" only on an empty install;
 *  "replace" first saves what is there now (encrypted with the same passphrase). */
export async function restoreBackup(bytes: Buffer, passphrase: string, mode: "initial" | "replace", keyFile: Buffer | null = null): Promise<{ counts: Record<string, number>; safetyFile: string | null }> {
  const payload = (await decodeBackup(bytes, passphrase, { keyFile })) as BackupPayload; // CPU work, outside the gate
  const result = await writeGate.exclusive(() => prisma.$transaction(async (tx) => {
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
  if (result.safetyFile) await pruneSafetyFiles(path.basename(result.safetyFile));
  return result;
}

/** Card #315: keep only the newest N safety copies (N from the restored settings). Never fails a restore. */
async function pruneSafetyFiles(made: string): Promise<void> {
  try {
    const row = await prisma.backupSettings.findUnique({ where: { id: "default" }, select: { keepSafety: true } });
    const dir = backupDir();
    await removeFiles(dir, planSafetyPrune(await listBackupFolder(dir), row?.keepSafety ?? 10, made));
  } catch (e) {
    console.error(`[backup] old safety copies couldn't be removed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function lastBackupAt(): Promise<Date | null> {
  const row = await prisma.backupStatus.findUnique({ where: { id: "default" } });
  return row?.lastBackupAt ?? null;
}

export { BackupFileError };
