import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

// Card #314: the one-time setup code a first-run restore needs. YoSched is reachable on the
// web, so an empty install must not be claimable by whoever finds it first. The code lives in
// a file only someone with access to the server can read; the agent doing the reinstall
// passes it on. It is removed after a successful restore.

const FILE = "setup-code";

export async function ensureSetupCode(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    const fh = await open(path.join(dir, FILE), "wx", 0o600);
    try { await fh.writeFile(randomBytes(18).toString("base64url") + "\n"); await fh.sync(); } finally { await fh.close(); }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}

const digest = (s: string) => createHash("sha256").update(s.trim()).digest();

export async function verifySetupCode(dir: string, given: string): Promise<boolean> {
  let stored: string;
  try { stored = await readFile(path.join(dir, FILE), "utf8"); } catch { return false; }
  if (!stored.trim() || !given.trim()) return false;
  return timingSafeEqual(digest(stored), digest(given));
}

export async function removeSetupCode(dir: string): Promise<void> {
  await rm(path.join(dir, FILE), { force: true });
}
