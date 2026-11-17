import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { writeGate } from "@/lib/write-gate";
import { DEFAULT_AUTO, autoHealth, planPrune, type AutoSettings, type AutoSettingsInput, type AutoStatus } from "./auto";
import { startAutoBackup, type AutoState, type JobDeps } from "./auto-job";
import { BackupFileError, MIN_PASSPHRASE, createBackupKey, decodeBackup, encodeAutoBackup, readBackupHeader } from "./format";
import { cleanPartials, findKeyFiles, listBackupFolder, removeFiles, writeAtomic } from "./files";
import { backupDir, snapshotPayload } from "./service";

// Card #315: automatic daily backups, wired to the database and the backup folder.
// The private key is never stored here: the admin keeps the key file. A new key is "pending"
// until the admin proves, with the key file and its passphrase, that it opens a real backup.

const ID = "default";

export class AutoConflictError extends Error {
  constructor(msg: string) { super(msg); this.name = "AutoConflictError"; }
}

type SettingsRow = Prisma.BackupSettingsGetPayload<object>;
type StatusRow = Prisma.BackupStatusGetPayload<object>;

function toSettings(row: SettingsRow | null): AutoSettings {
  if (!row) return { ...DEFAULT_AUTO };
  return {
    autoEnabled: row.autoEnabled, autoTime: row.autoTime,
    keepDaily: row.keepDaily, keepWeekly: row.keepWeekly, keepMonthly: row.keepMonthly, keepSafety: row.keepSafety,
    publicKey: row.publicKey, keyId: row.keyId, keyCreatedAt: row.keyCreatedAt, verifiedAt: row.verifiedAt,
  };
}
function toStatus(row: StatusRow | null): AutoStatus {
  return { lastAutoSuccessAt: row?.lastAutoSuccessAt ?? null, lastAutoAttemptAt: row?.lastAutoAttemptAt ?? null, lastAutoError: row?.lastAutoError ?? null };
}

/** Settings and status from one consistent read. */
export async function readAutoState(): Promise<AutoState & { pending: SettingsRow | null }> {
  const [s, st] = await prisma.$transaction(
    async (tx) => [await tx.backupSettings.findUnique({ where: { id: ID } }), await tx.backupStatus.findUnique({ where: { id: ID } })] as const,
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return { settings: toSettings(s), status: toStatus(st), pending: s };
}

async function setStatus(data: Partial<Pick<StatusRow, "lastAutoAttemptAt" | "lastAutoSuccessAt" | "lastAutoError" | "lastBackupAt">>): Promise<void> {
  await prisma.backupStatus.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data });
}

/** The real dependencies of the job (src/lib/backup/auto-job.ts). */
export function jobDeps(): JobDeps {
  const dir = backupDir();
  return {
    now: () => new Date(),
    exclusive: (fn) => writeGate.exclusive(fn),
    readState: async () => { const { settings, status } = await readAutoState(); return { settings, status }; },
    recordAttempt: (at) => setStatus({ lastAutoAttemptAt: at }),
    buildPayload: () => snapshotPayload(),
    encode: (payload, key) => encodeAutoBackup(payload, key),
    write: async (name, bytes) => { await writeAtomic(dir, name, bytes); },
    recordSuccess: (at) => setStatus({ lastAutoSuccessAt: at, lastAutoError: null, lastBackupAt: at }),
    recordFailure: (_at, error) => setStatus({ lastAutoError: error.slice(0, 500) }),
    list: () => listBackupFolder(dir),
    remove: (names) => removeFiles(dir, names),
    cleanPartials: () => cleanPartials(dir),
    log: (msg) => console.log(msg),
  };
}

/** Start the scheduler for this process (once; src/instrumentation.ts). */
export function startAutoBackups(): boolean {
  return startAutoBackup(jobDeps);
}

export type AutoView = {
  enabled: boolean;
  autoTime: string;
  keepDaily: number; keepWeekly: number; keepMonthly: number; keepSafety: number;
  key: { keyId: string; createdAt: string | null; verifiedAt: string | null } | null;
  pendingKey: { keyId: string; createdAt: string | null } | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  health: string | null;
  folder: string;
  autoFiles: number;
  keyFilesInFolder: string[];
  folderError: string | null;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function getAutoView(now = new Date()): Promise<AutoView> {
  const { settings: s, status: st, pending } = await readAutoState();
  const folder = backupDir();
  let autoFiles = 0, keyFilesInFolder: string[] = [], folderError: string | null = null;
  try {
    const names = await listBackupFolder(folder);
    const autos = names.filter((n) => n.startsWith("YoSched auto ") && n.endsWith(".yosched-backup"));
    autoFiles = autos.length - planPrune(autos, s).length; // what the keep rule leaves after the next run
    keyFilesInFolder = await findKeyFiles(folder);
  } catch (e) {
    folderError = `The backup folder can't be read (${(e as NodeJS.ErrnoException).code ?? "error"})`;
  }
  return {
    enabled: s.autoEnabled, autoTime: s.autoTime,
    keepDaily: s.keepDaily, keepWeekly: s.keepWeekly, keepMonthly: s.keepMonthly, keepSafety: s.keepSafety,
    key: s.keyId ? { keyId: s.keyId, createdAt: iso(s.keyCreatedAt), verifiedAt: iso(s.verifiedAt) } : null,
    pendingKey: pending?.pendingKeyId ? { keyId: pending.pendingKeyId, createdAt: iso(pending.pendingKeyCreatedAt) } : null,
    lastSuccessAt: iso(st.lastAutoSuccessAt), lastAttemptAt: iso(st.lastAutoAttemptAt), lastError: st.lastAutoError,
    health: autoHealth(now, s, st),
    folder, autoFiles, keyFilesInFolder, folderError,
  };
}

export async function saveAutoSettings(v: AutoSettingsInput): Promise<void> {
  await prisma.backupSettings.upsert({ where: { id: ID }, create: { id: ID, ...v }, update: v });
}

/** Switch on (only with a key proved by its key file) or off. */
export async function setAutoEnabled(on: boolean): Promise<void> {
  if (!on) {
    await prisma.backupSettings.upsert({ where: { id: ID }, create: { id: ID, autoEnabled: false }, update: { autoEnabled: false } });
    return;
  }
  const n = await prisma.backupSettings.updateMany({ where: { id: ID, publicKey: { not: null }, keyId: { not: null }, verifiedAt: { not: null } }, data: { autoEnabled: true } });
  if (n.count === 0) throw new AutoConflictError("Make a key and check it with its key file before switching automatic backups on");
}

const p2 = (n: number) => String(n).padStart(2, "0");
export function keyFileName(createdAt: Date, keyId: string): string {
  return `YoSched key ${createdAt.getUTCFullYear()}-${p2(createdAt.getUTCMonth() + 1)}-${p2(createdAt.getUTCDate())} ${keyId}.yosched-key`;
}

/** Make a new key. It waits as "pending" (the current key keeps working) until checked. */
export async function createPendingKey(passphrase: string): Promise<{ keyFile: Buffer; fileName: string; keyId: string }> {
  if (passphrase.length < MIN_PASSPHRASE) throw new BackupFileError(`The passphrase must be at least ${MIN_PASSPHRASE} characters`);
  const k = await createBackupKey(passphrase);
  const data = { pendingPublicKey: k.publicKey, pendingKeyId: k.keyId, pendingKeyCreatedAt: new Date(k.createdAt) };
  await prisma.backupSettings.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data });
  return { keyFile: k.keyFile, fileName: keyFileName(new Date(k.createdAt), k.keyId), keyId: k.keyId };
}

/** Prove the pending key with its key file and passphrase: a real automatic backup is made to it
 *  in memory and opened again. Only then does it become the key, and automatic backups switch on. */
export async function verifyPendingKey(keyFile: Buffer, passphrase: string, now = new Date()): Promise<{ keyId: string }> {
  const { pending } = await readAutoState();
  if (!pending?.pendingPublicKey || !pending.pendingKeyId) throw new AutoConflictError("There is no new key waiting to be checked. Reload the page.");
  const key = { publicKey: pending.pendingPublicKey, keyId: pending.pendingKeyId, keyCreatedAt: (pending.pendingKeyCreatedAt ?? now).toISOString() };
  const nonce = randomBytes(16).toString("hex");
  const sealed = await encodeAutoBackup({ challenge: nonce }, key);
  const head = readBackupHeader(sealed);
  if (head.format !== 2 || head.keyId !== key.keyId) throw new Error("internal: challenge header mismatch");
  const opened = (await decodeBackup(sealed, passphrase, { keyFile })) as { challenge?: string };
  if (opened?.challenge !== nonce) throw new BackupFileError("This key file doesn't fit the new key");
  const n = await prisma.backupSettings.updateMany({
    where: { id: ID, pendingKeyId: key.keyId, pendingPublicKey: key.publicKey },
    data: {
      publicKey: key.publicKey, keyId: key.keyId, keyCreatedAt: pending.pendingKeyCreatedAt ?? now, verifiedAt: now,
      pendingPublicKey: null, pendingKeyId: null, pendingKeyCreatedAt: null, autoEnabled: true,
    },
  });
  if (n.count === 0) throw new AutoConflictError("The new key changed while it was being checked. Reload the page.");
  return { keyId: key.keyId };
}

/** The amber note's sentence for the header, or null. */
export async function currentAutoHealth(now = new Date()): Promise<string | null> {
  const { settings, status } = await readAutoState();
  return autoHealth(now, settings, status);
}
