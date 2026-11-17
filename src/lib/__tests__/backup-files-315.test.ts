import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeAtomic, listBackupFolder, removeFiles, cleanPartials, findKeyFiles } from "@/lib/backup/files";
import { createBackupKey } from "@/lib/backup/format";

// Card #315: the backup folder. A file appears whole or not at all, only YoSched's own files
// are ever removed, and a key file left in the folder is noticed.
let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "yosched-files-315-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("backup folder (card #315)", () => {
  it("writes a file whole, readable only by its owner, in a folder it creates", async () => {
    const sub = path.join(dir, "nested", "backups");
    await writeAtomic(sub, "YoSched auto 2026-11-17 0100 UTC.yosched-backup", Buffer.from("hello"));
    expect(await readFile(path.join(sub, "YoSched auto 2026-11-17 0100 UTC.yosched-backup"), "utf8")).toBe("hello");
    expect((await stat(path.join(sub, "YoSched auto 2026-11-17 0100 UTC.yosched-backup"))).mode & 0o777).toBe(0o600);
    expect((await stat(sub)).mode & 0o777).toBe(0o700);
    expect((await readdir(sub)).filter((n) => n.endsWith(".partial"))).toEqual([]);
  });

  it("a failed write leaves no file and no partial behind", async () => {
    await writeFile(path.join(dir, "blocker"), "x");
    await expect(writeAtomic(path.join(dir, "blocker"), "a.yosched-backup", Buffer.from("x"))).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["blocker"]);
  });

  it("refuses a name with a folder in it", async () => {
    await expect(writeAtomic(dir, "../x.yosched-backup", Buffer.from("x"))).rejects.toThrow();
  });

  it("lists names only (a missing folder is empty)", async () => {
    expect(await listBackupFolder(path.join(dir, "none"))).toEqual([]);
    await writeFile(path.join(dir, "a.yosched-backup"), "x");
    expect(await listBackupFolder(dir)).toEqual(["a.yosched-backup"]);
  });

  it("removes only plain names inside the folder", async () => {
    await writeFile(path.join(dir, "a.yosched-backup"), "x");
    await writeFile(path.join(dir, "b.yosched-backup"), "x");
    await removeFiles(dir, ["a.yosched-backup", "missing.yosched-backup"]);
    expect(await readdir(dir)).toEqual(["b.yosched-backup"]);
    await expect(removeFiles(dir, ["../b.yosched-backup"])).rejects.toThrow();
  });

  it("cleans up only its own leftover partial files", async () => {
    await writeFile(path.join(dir, "YoSched auto 2026-11-17 0100 UTC.yosched-backup.partial"), "x");
    await writeFile(path.join(dir, "someone else.partial"), "x");
    await cleanPartials(dir);
    expect(await readdir(dir)).toEqual(["someone else.partial"]);
  });

  it("finds a key file left in the folder, by its contents or its name", async () => {
    const k = await createBackupKey("correct horse battery", { N: 1024 });
    await writeFile(path.join(dir, "renamed.bin"), k.keyFile);
    await writeFile(path.join(dir, "other.yosched-key"), "x");
    await writeFile(path.join(dir, "YoSched auto 2026-11-17 0100 UTC.yosched-backup"), Buffer.alloc(50_000));
    expect((await findKeyFiles(dir)).sort()).toEqual(["other.yosched-key", "renamed.bin"]);
    expect(await findKeyFiles(path.join(dir, "none"))).toEqual([]);
  });
});

