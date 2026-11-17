import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { writeGate } from "@/lib/write-gate";

// Card #319: the install's auth epoch (table auth_state, never backed up). Every session token
// and trusted-device cookie names it; every restore replaces it, so a restore that rolls a
// login's sessionVersion back can't revive anything issued before the restore.

type Exec = { exec(sql: string, ...params: unknown[]): Promise<number> };

const fresh = () => randomBytes(24).toString("base64url");

/** The current epoch. The migration creates it; if the row is ever missing it is created here,
 *  under the write gate (shared and re-entrant, so this works from pages and gated routes). */
export async function getEpoch(): Promise<string> {
  const row = await prisma.authState.findUnique({ where: { id: "default" }, select: { epoch: true } });
  if (row) return row.epoch;
  // Awaited INSIDE the callback: a Prisma query only runs when awaited, so returning it bare
  // would run it after the gate's context has ended (refused as an ungated write).
  await writeGate.shared(async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "auth_state" ("id", "epoch", "updatedAt") VALUES ('default', $1, now()) ON CONFLICT ("id") DO NOTHING`, fresh());
  });
  const made = await prisma.authState.findUniqueOrThrow({ where: { id: "default" }, select: { epoch: true } });
  return made.epoch;
}

/** Replace the epoch inside the caller's transaction (every restore, replace and first-run). */
export async function rotateEpoch(db: Exec): Promise<void> {
  await db.exec(
    `INSERT INTO "auth_state" ("id", "epoch", "updatedAt") VALUES ('default', $1, now())
     ON CONFLICT ("id") DO UPDATE SET "epoch" = EXCLUDED."epoch", "updatedAt" = now()`, fresh());
}
