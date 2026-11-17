import { mkdir, open, readdir, rename, unlink, chmod } from "node:fs/promises";
import path from "node:path";
import { isKeyFile, MAX_KEY_FILE_BYTES } from "./format";

// Card #315: the backup folder (YOSCHED_BACKUP_DIR). A file appears whole or not at all
// (partial file → fsync → rename), only YoSched's own file names are ever removed, and a key
// file left in the folder is found so Settings can warn about it.

const PARTIAL = ".partial";
const CANT_SYNC_DIR = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP"]);
const OURS_PARTIAL = /^(YoSched auto |pre-restore-).*\.yosched-backup\.partial$/;

function plain(name: string): string {
  if (!name || name !== path.basename(name) || name === "." || name === "..") throw new Error(`Not a plain file name: ${name}`);
  return name;
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

/** Write `bytes` as dir/name, mode 0600: all of it, or nothing. */
export async function writeAtomic(dir: string, name: string, bytes: Buffer): Promise<string> {
  plain(name);
  await ensureDir(dir);
  const final = path.join(dir, name);
  const tmp = final + PARTIAL;
  try {
    const fh = await open(tmp, "w", 0o600);
    try { await fh.writeFile(bytes); await fh.sync(); } finally { await fh.close(); }
    await chmod(tmp, 0o600); // an existing partial may have had other bits
    await rename(tmp, final);
  } catch (e) {
    await unlink(tmp).catch(() => {}); // already failing; the partial may not exist
    throw e;
  }
  const dfh = await open(dir, "r");
  try {
    await dfh.sync();
  } catch (e) {
    // Only "this file system can't sync a folder" is tolerated; any other failure means the
    // new name may not survive a crash, so the write fails (and nothing is pruned). (r1)
    if (!CANT_SYNC_DIR.has((e as NodeJS.ErrnoException).code ?? "")) throw e;
  } finally { await dfh.close(); }
  return final;
}

/** The names in the folder; a folder that doesn't exist yet is empty. */
export async function listBackupFolder(dir: string): Promise<string[]> {
  try { return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name).sort(); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

export async function removeFiles(dir: string, names: string[]): Promise<void> {
  for (const n of names) plain(n);
  for (const n of names) {
    await unlink(path.join(dir, n)).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
  }
}

/** Partial files a crash left behind (only YoSched's own names). */
export async function cleanPartials(dir: string): Promise<void> {
  await removeFiles(dir, (await listBackupFolder(dir)).filter((n) => OURS_PARTIAL.test(n)));
}

/** Key files in the folder: named *.yosched-key, or a small file that starts like one. */
export async function findKeyFiles(dir: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const found: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name.endsWith(".yosched-key")) { found.push(e.name); continue; }
    try {
      const fh = await open(path.join(dir, e.name), "r");
      try {
        if ((await fh.stat()).size > MAX_KEY_FILE_BYTES) continue;
        const head = Buffer.alloc(16);
        const { bytesRead } = await fh.read(head, 0, 16, 0);
        if (isKeyFile(head.subarray(0, bytesRead))) found.push(e.name);
      } finally { await fh.close(); }
    } catch { /* unreadable: not ours to judge */ }
  }
  return found.sort();
}
