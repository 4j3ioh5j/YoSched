import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Card #315: automatic backups wired to the database. A new key works only after its key file
// has opened a real backup made to it; switching on needs that proved key; a key changed while
// it was being checked is refused.

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({ settings: null as Row | null, status: null as Row | null, prefs: null as Row | null, dir: "", txOpts: [] as unknown[] }));

function matches(row: Row | null, where: Record<string, unknown>): boolean {
  if (!row) return false;
  return Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "not" in (v as object) ? row[k] !== null && row[k] !== undefined : row[k] === v));
}
vi.mock("@/lib/prisma", () => {
  const table = (key: "settings" | "status" | "prefs", defaults: Row) => ({
    findUnique: async () => (h[key] ? { ...h[key] } : null),
    findFirst: async () => (h[key] ? { ...h[key] } : null),
    update: async ({ data }: { data: Row }) => { if (!h[key]) throw new Error("no row"); h[key] = { ...h[key], ...data }; return h[key]; },
    upsert: async ({ create, update }: { create: Row; update: Row }) => { h[key] = h[key] ? { ...h[key], ...update } : { ...defaults, ...create }; return h[key]; },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      if (!matches(h[key], where)) return { count: 0 };
      h[key] = { ...h[key], ...data }; return { count: 1 };
    },
  });
  const p: Record<string, unknown> = {
    backupSettings: table("settings", { autoEnabled: false, autoTime: "02:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10, publicKey: null, keyId: null, keyCreatedAt: null, verifiedAt: null, pendingPublicKey: null, pendingKeyId: null, pendingKeyCreatedAt: null }),
    backupStatus: table("status", { lastBackupAt: null, lastAutoSuccessAt: null, lastAutoAttemptAt: null, lastAutoError: null }),
  };
  p.schedulingPreferences = table("prefs", { timeZone: null });
  // Card #320 (trial): rows are created through Prisma upserts, never raw INSERTs (those miss @updatedAt).
  p.$executeRaw = async () => { throw new Error("raw writes are not used here"); };
  p.$queryRaw = async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (!sql.includes("FOR UPDATE")) throw new Error("lock read without FOR UPDATE");
    return sql.includes('"autoTime"') ? [{ autoTime: h.settings!.autoTime }] : [{ timeZone: h.prefs!.timeZone }];
  };
  p.$transaction = async (fn: (tx: unknown) => unknown, opts?: unknown) => { h.txOpts.push(opts); return fn(p); };
  return { prisma: p };
});
vi.mock("@/lib/backup/service", () => ({ backupDir: () => h.dir, snapshotPayload: async () => ({ format: 1, tables: {} }) }));

import { createPendingKey, verifyPendingKey, setAutoEnabled, getAutoView, saveAutoSettings, setTimeZone, readAutoState, jobDeps, keyFileName, AutoConflictError } from "@/lib/backup/auto-service";
import { createBackupKey, decodeBackup } from "@/lib/backup/format";
import { runAutoBackup } from "@/lib/backup/auto-job";

const PASS = "correct horse battery staple";

beforeEach(async () => { h.settings = null; h.status = null; h.prefs = null; h.txOpts = []; h.dir = await mkdtemp(path.join(os.tmpdir(), "yosched-autosvc-315-")); });
afterEach(async () => { await rm(h.dir, { recursive: true, force: true }); });

describe("automatic backup settings (card #315)", () => {
  it("a new key waits until its key file is proved, then becomes the key and switches backups on", async () => {
    const { keyFile, fileName, keyId } = await createPendingKey(PASS);
    expect(fileName).toMatch(new RegExp(`^YoSched key \\d{4}-\\d{2}-\\d{2} ${keyId}\\.yosched-key$`));
    let v = await getAutoView();
    expect(v.key).toBeNull();
    expect(v.pendingKey?.keyId).toBe(keyId);
    expect(v.enabled).toBe(false);
    expect(JSON.stringify(h.settings)).not.toContain(keyFile.toString("base64")); // the key file is never stored

    await verifyPendingKey(keyFile, PASS);
    v = await getAutoView();
    expect(v).toMatchObject({ enabled: true, key: { keyId }, pendingKey: null, health: null });
  });

  it("a wrong passphrase or another key's file doesn't promote the key", async () => {
    const { keyFile } = await createPendingKey(PASS);
    await expect(verifyPendingKey(keyFile, "wrong passphrase here")).rejects.toThrow(/Wrong passphrase/);
    const other = await createBackupKey(PASS, { N: 1024 });
    await expect(verifyPendingKey(other.keyFile, PASS)).rejects.toThrow(/doesn't fit/);
    expect((await getAutoView()).key).toBeNull();
  });

  it("a key replaced while the old one was being checked is refused (reload)", async () => {
    const first = await createPendingKey(PASS);
    // A second "make a key" lands between the check and the promote.
    const p = (await import("@/lib/prisma")).prisma.backupSettings as unknown as { updateMany: (a: unknown) => Promise<unknown> };
    const orig = p.updateMany;
    p.updateMany = async (args) => { p.updateMany = orig; await createPendingKey(PASS); return orig(args); };
    await expect(verifyPendingKey(first.keyFile, PASS)).rejects.toBeInstanceOf(AutoConflictError);
    expect((await getAutoView()).key).toBeNull();
  });

  it("switching on needs a proved key; switching off always works", async () => {
    await expect(setAutoEnabled(true)).rejects.toBeInstanceOf(AutoConflictError);
    await createPendingKey(PASS);
    await expect(setAutoEnabled(true)).rejects.toBeInstanceOf(AutoConflictError); // pending isn't enough
    await setAutoEnabled(false);
    expect((await getAutoView()).enabled).toBe(false);
  });

  it("making a new key keeps the current one working until the new one is checked", async () => {
    const a = await createPendingKey(PASS);
    await verifyPendingKey(a.keyFile, PASS);
    const b = await createPendingKey(PASS);
    const v = await getAutoView();
    expect(v.key?.keyId).toBe(a.keyId);
    expect(v.pendingKey?.keyId).toBe(b.keyId);
    expect(v.enabled).toBe(true);
  });

  it("refuses a short passphrase for a new key", async () => {
    await expect(createPendingKey("short")).rejects.toThrow(/at least 12/);
    expect(h.settings).toBeNull();
  });

  it("saves the time and how many copies to keep", async () => {
    await saveAutoSettings({ autoTime: "01:00", keepDaily: 5, keepWeekly: 2, keepMonthly: 6, keepSafety: 3 }, null);
    expect(await getAutoView()).toMatchObject({ autoTime: "01:00", keepDaily: 5, keepWeekly: 2, keepMonthly: 6, keepSafety: 3, enabled: false });
  });

  it("reads settings and status in one consistent (repeatable read) transaction", async () => {
    await readAutoState();
    expect(h.txOpts).toEqual([expect.objectContaining({ isolationLevel: "RepeatableRead" })]);
  });

  it("warns about a key file left in the backup folder", async () => {
    await writeFile(path.join(h.dir, keyFileName(new Date("2026-11-17T00:00:00Z"), "abcdef0123456789")), "x");
    expect((await getAutoView()).keyFilesInFolder).toEqual(["YoSched key 2026-11-17 abcdef0123456789.yosched-key"]);
  });
});

describe("the real job dependencies (card #315)", () => {
  it("a run writes a file the key file opens, and records the success", async () => {
    const { keyFile } = await createPendingKey(PASS);
    await verifyPendingKey(keyFile, PASS);
    const deps = { ...jobDeps(), now: () => new Date("2026-11-17T03:00:00Z"), log: () => {} };
    expect(await runAutoBackup(deps)).toBe("ok");
    const files = await readdir(h.dir);
    expect(files).toEqual(["YoSched auto 2026-11-17 0300 UTC.yosched-backup"]);
    const { readFile } = await import("node:fs/promises");
    expect(await decodeBackup(await readFile(path.join(h.dir, files[0])), PASS, { keyFile })).toEqual({ format: 1, tables: {} });
    expect(h.status).toMatchObject({ lastAutoSuccessAt: new Date("2026-11-17T03:00:00Z"), lastBackupAt: new Date("2026-11-17T03:00:00Z"), lastAutoError: null });
    const v = await getAutoView(new Date("2026-11-17T03:01:00Z"));
    expect(v).toMatchObject({ autoFiles: 1, health: null, lastSuccessAt: "2026-11-17T03:00:00.000Z" });
  });

  it("a failure is recorded and shows the amber note", async () => {
    const { keyFile } = await createPendingKey(PASS);
    await verifyPendingKey(keyFile, PASS);
    const deps = { ...jobDeps(), now: () => new Date("2026-11-17T03:00:00Z"), log: () => {}, write: async () => { throw Object.assign(new Error("no"), { code: "ENOSPC" }); } };
    expect(await runAutoBackup(deps)).toBe("failed");
    expect((await getAutoView()).health).toMatch(/failed: the backup folder can't be written \(ENOSPC\)/);
  });
});

describe("time zone (card #320)", () => {
  it("changing the zone converts the backup time so the moment stays the same", async () => {
    await saveAutoSettings({ autoTime: "01:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10 }, null);
    const r = await setTimeZone("America/Los_Angeles", null, new Date("2026-11-17T05:00:00Z"));
    expect(r).toEqual({ timeZone: "America/Los_Angeles", autoTime: "17:00" });
    const v = await getAutoView();
    expect(v).toMatchObject({ autoTime: "17:00", storedZone: "America/Los_Angeles", zone: "America/Los_Angeles" });
    // And back to UTC (the rollback step).
    expect(await setTimeZone("UTC", "America/Los_Angeles", new Date("2026-11-17T05:00:00Z"))).toEqual({ timeZone: "UTC", autoTime: "01:00" });
  });
  it("a page opened before the zone changed can't save its clock time", async () => {
    await setTimeZone("America/Los_Angeles", null);
    await expect(saveAutoSettings({ autoTime: "03:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10 }, null)).rejects.toBeInstanceOf(AutoConflictError);
    await expect(saveAutoSettings({ autoTime: "03:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10 }, undefined)).rejects.toBeInstanceOf(AutoConflictError);
    await expect(setTimeZone("UTC", null)).rejects.toBeInstanceOf(AutoConflictError);
    expect(h.settings?.autoTime).not.toBe("03:00");
    await saveAutoSettings({ autoTime: "03:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10 }, "America/Los_Angeles");
    expect(h.settings?.autoTime).toBe("03:00");
  });
  it("refuses a zone that isn't real", async () => {
    await expect(setTimeZone("Mars/Olympus", null)).rejects.toThrow(/time zone/);
    expect(h.prefs?.timeZone ?? null).toBeNull();
  });
  it("the job reads the zone with the settings", async () => {
    await setTimeZone("America/Los_Angeles", null);
    expect((await readAutoState()).zone).toBe("America/Los_Angeles");
    expect((await jobDeps().readState()).zone).toBe("America/Los_Angeles");
  });
});
