import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Card #314: who may back up or restore, and what each route refuses.
const h = vi.hoisted(() => ({
  perms: ["data:backup"] as string[],
  users: 0,
  codeOk: true,
  restore: vi.fn(async () => ({ counts: { users: 1 }, safetyFile: "/srv/b/pre-restore-x.yosched-backup" })),
  create: vi.fn(async () => ({ bytes: Buffer.from("YOSCHED-BACKUP\n"), createdAt: new Date("2026-11-17T00:42:00Z") })),
  removeCode: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth-guard", () => ({
  getSession: async (need?: string) => (need && !h.perms.includes(need)
    ? { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), session: null }
    : { error: null, userId: "u1", permissions: h.perms }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { count: async () => h.users }, schedulingPreferences: { findFirst: async () => ({ backupReminderDays: 7 }) } } }));
vi.mock("@/lib/backup/service", async () => {
  const fmt = await import("@/lib/backup/format");
  return {
    MAX_UPLOAD_BYTES: 1000, NotEmptyError: class extends Error {}, BackupFileError: fmt.BackupFileError,
    backupDir: () => "/tmp/none", createBackup: h.create, restoreBackup: h.restore, checkBackup: vi.fn(), lastBackupAt: async () => null,
  };
});
vi.mock("@/lib/backup/setup-code", () => ({ ensureSetupCode: vi.fn(async () => {}), verifySetupCode: async () => h.codeOk, removeSetupCode: h.removeCode }));

import { POST as create } from "../route";
import { POST as restore } from "../restore/route";
import { GET as initialGet, POST as initialPost } from "../initial/route";
import { GET as status } from "../status/route";
import { backupDue, backupFileName } from "@/lib/backup/reminder";

function upload(extra: Record<string, string> = {}, size = 10, headers: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("file", new Blob([new Uint8Array(size)]), "b.yosched-backup");
  fd.set("passphrase", "correct horse battery");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return new Request("http://x/api/backup/restore", { method: "POST", body: fd, headers });
}

/** A chunked body with no length that never ends unless the reader stops; counts what was pulled. */
function endless(headers: Record<string, string> = {}) {
  const seen = { bytes: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(c) { if (seen.bytes > 500_000) { c.close(); return; } seen.bytes += 100; c.enqueue(new Uint8Array(100)); },
    cancel() { seen.cancelled = true; },
  });
  const req = new Request("http://x/api/backup/restore", { method: "POST", body, headers: { "content-type": "multipart/form-data; boundary=x", ...headers }, duplex: "half" } as RequestInit);
  return { req, seen };
}

describe("backup routes (card #314)", () => {
  beforeEach(() => { h.perms = ["data:backup"]; h.users = 0; h.codeOk = true; h.restore.mockClear(); h.create.mockClear(); h.removeCode.mockClear(); });

  it("download needs data:backup and a 12+ character passphrase; names the file in 24-hour UTC", async () => {
    h.perms = ["settings:edit"];
    expect((await create(new Request("http://x", { method: "POST", body: JSON.stringify({ passphrase: "correct horse battery" }) }))).status).toBe(403);
    h.perms = ["data:backup"];
    expect((await create(new Request("http://x", { method: "POST", body: JSON.stringify({ passphrase: "short" }) }))).status).toBe(400);
    const res = await create(new Request("http://x", { method: "POST", body: JSON.stringify({ passphrase: "correct horse battery" }) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("YoSched backup 2026-11-17 0042 UTC.yosched-backup");
    expect(h.create).toHaveBeenCalledWith("correct horse battery");
  });

  it("restore needs data:backup and the word REPLACE", async () => {
    h.perms = ["settings:edit"];
    expect((await restore(upload({ confirm: "REPLACE" }))).status).toBe(403);
    h.perms = ["data:backup"];
    expect((await restore(upload({ confirm: "replace" }))).status).toBe(400);
    expect(h.restore).not.toHaveBeenCalled();
    const ok = await restore(upload({ confirm: "REPLACE" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ safetyFile: "pre-restore-x.yosched-backup" }); // the name, never the server path
    expect(h.restore).toHaveBeenCalledWith(expect.any(Buffer), "correct horse battery", "replace");
  });

  it("an oversized upload is refused before anything is read", async () => {
    expect((await restore(upload({ confirm: "REPLACE" }, 5000))).status).toBe(413);
    expect(h.restore).not.toHaveBeenCalled();
  });

  it("a chunked upload with no length is cut off at the limit, not read to the end (round 1)", async () => {
    const { req, seen } = endless();
    expect((await restore(req)).status).toBe(413);
    expect(seen.bytes).toBeLessThan(1000 + 64 * 1024 + 200); // the cap plus the form's own overhead
    expect(seen.cancelled).toBe(true);
    expect(h.restore).not.toHaveBeenCalled();
  });

  it("first-run restore checks the setup code before reading any of the upload (round 1)", async () => {
    h.codeOk = false;
    const { req, seen } = endless({ "x-setup-code": "wrong" });
    expect((await initialPost(req)).status).toBe(403);
    expect(seen.bytes).toBeLessThanOrEqual(100);
    const none = endless();
    expect((await initialPost(none.req)).status).toBe(403);
    expect(none.seen.bytes).toBeLessThanOrEqual(100);
    expect(h.restore).not.toHaveBeenCalled();
  });

  it("first-run restore: 404 once a login exists; needs the setup code; removes it after success", async () => {
    h.users = 1;
    expect((await initialGet()).status).toBe(404);
    expect((await initialPost(upload({}, 10, { "x-setup-code": "x" }))).status).toBe(404);
    h.users = 0;
    expect(await (await initialGet()).json()).toEqual({ available: true });
    h.codeOk = false;
    expect((await initialPost(upload({}, 10, { "x-setup-code": "wrong" }))).status).toBe(403);
    expect(h.restore).not.toHaveBeenCalled();
    h.codeOk = true;
    expect((await initialPost(upload({}, 10, { "x-setup-code": "right" }))).status).toBe(200);
    expect(h.restore).toHaveBeenCalledWith(expect.any(Buffer), "correct horse battery", "initial");
    expect(h.removeCode).toHaveBeenCalled();
  });

  it("status: only data:backup holders see it; no backup yet means due", async () => {
    h.perms = ["settings:view"];
    expect(await (await status()).json()).toEqual({ allowed: false });
    h.perms = ["data:backup"];
    expect(await (await status()).json()).toEqual({ allowed: true, lastBackupAt: null, reminderDays: 7, due: true });
  });
});

describe("backupDue / backupFileName (card #314)", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  it("due at exactly N days, not before; 0 = never; no backup = due", () => {
    expect(backupDue(null, 7, now)).toBe(true);
    expect(backupDue(new Date("2026-11-10T12:00:00Z"), 7, now)).toBe(true);
    expect(backupDue(new Date("2026-11-10T12:00:01Z"), 7, now)).toBe(false);
    expect(backupDue(null, 0, now)).toBe(false);
  });
  it("file name pads hours and minutes", () => {
    expect(backupFileName(new Date("2026-01-05T03:07:00Z"))).toBe("YoSched backup 2026-01-05 0307 UTC.yosched-backup");
  });
});
