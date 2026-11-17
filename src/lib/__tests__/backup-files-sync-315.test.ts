import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Card #315 r1: a failed folder sync is a failed write (the job then records a failure and
// prunes nothing). Only "this file system can't sync a folder" is tolerated.
const h = vi.hoisted(() => ({ dir: "", code: "EIO" }));
vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  return {
    ...real,
    open: async (p: string, ...rest: unknown[]) => {
      const fh = await (real.open as (...a: unknown[]) => Promise<import("node:fs/promises").FileHandle>)(p, ...rest);
      if (p === h.dir) fh.sync = async () => { throw Object.assign(new Error(h.code), { code: h.code }); };
      return fh;
    },
  };
});
import { writeAtomic } from "@/lib/backup/files";

beforeEach(async () => { h.dir = await mkdtemp(path.join(os.tmpdir(), "yosched-sync-315-")); });
afterEach(async () => { await rm(h.dir, { recursive: true, force: true }); });

describe("folder sync (card #315 r1)", () => {
  it("EIO on the folder sync fails the write", async () => {
    h.code = "EIO";
    await expect(writeAtomic(h.dir, "a.yosched-backup", Buffer.from("x"))).rejects.toMatchObject({ code: "EIO" });
  });
  it("a file system that can't sync folders (EINVAL) is tolerated", async () => {
    h.code = "EINVAL";
    await expect(writeAtomic(h.dir, "a.yosched-backup", Buffer.from("x"))).resolves.toContain("a.yosched-backup");
  });
});
