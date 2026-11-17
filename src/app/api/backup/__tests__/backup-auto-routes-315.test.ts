import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Card #315: the automatic backup routes. Same permission as backing up; a key file comes with
// a restore when the backup was automatic; bodies are bounded before they are read.
const h = vi.hoisted(() => ({
  perms: ["data:backup"] as string[],
  view: { enabled: false },
  save: vi.fn(async () => {}),
  enable: vi.fn(async () => {}),
  makeKey: vi.fn(async () => ({ keyFile: Buffer.from("YOSCHED-KEY\nabc"), fileName: "YoSched key 2026-11-17 abcdef0123456789.yosched-key", keyId: "abcdef0123456789" })),
  verify: vi.fn(async () => ({ keyId: "abcdef0123456789" })),
  restore: vi.fn(async () => ({ counts: { users: 1 }, safetyFile: null })),
  check: vi.fn(async () => ({ createdAt: "x", appVersion: "y", counts: {} })),
}));
vi.mock("@/lib/auth-guard", () => ({
  getSession: async (need?: string) => (need && !h.perms.includes(need)
    ? { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), session: null }
    : { error: null, userId: "u1", permissions: h.perms }),
}));
vi.mock("@/lib/backup/auto-service", async () => {
  class AutoConflictError extends Error {}
  return { AutoConflictError, getAutoView: async () => h.view, saveAutoSettings: h.save, setAutoEnabled: h.enable, createPendingKey: h.makeKey, verifyPendingKey: h.verify };
});
vi.mock("@/lib/backup/service", async () => {
  const fmt = await import("@/lib/backup/format");
  return { MAX_UPLOAD_BYTES: 1000, NotEmptyError: class extends Error {}, BackupFileError: fmt.BackupFileError, restoreBackup: h.restore, checkBackup: h.check };
});

import { GET, PUT } from "../auto/route";
import { POST as makeKey } from "../auto/key/route";
import { POST as verify } from "../auto/verify/route";
import { POST as restore } from "../restore/route";
import { POST as check } from "../check/route";
import { AutoConflictError } from "@/lib/backup/auto-service";
import { BackupFileError } from "@/lib/backup/format";

const json = (method: string, body: unknown) => new Request("http://x", { method, body: JSON.stringify(body) });
function keyForm(size = 20, pass = "correct horse battery") {
  const fd = new FormData();
  fd.set("keyfile", new Blob([new Uint8Array(size)]), "k.yosched-key");
  fd.set("passphrase", pass);
  return new Request("http://x", { method: "POST", body: fd });
}

describe("automatic backup routes (card #315)", () => {
  beforeEach(() => { h.perms = ["data:backup"]; for (const f of [h.save, h.enable, h.makeKey, h.verify, h.restore, h.check]) f.mockClear(); });

  it("every route needs data:backup", async () => {
    h.perms = ["settings:edit"];
    expect((await GET()).status).toBe(403);
    expect((await PUT(json("PUT", { enabled: false }))).status).toBe(403);
    expect((await makeKey(json("POST", { passphrase: "correct horse battery" }))).status).toBe(403);
    expect((await verify(keyForm())).status).toBe(403);
    expect(h.enable).not.toHaveBeenCalled();
    expect(h.makeKey).not.toHaveBeenCalled();
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("switches on or off, or saves the time and copies; bad values are refused", async () => {
    expect((await PUT(json("PUT", { enabled: true }))).status).toBe(200);
    expect(h.enable).toHaveBeenCalledWith(true);
    expect((await PUT(json("PUT", { autoTime: "1:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10 }))).status).toBe(400);
    expect((await PUT(json("PUT", { autoTime: "01:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10, zoneAtLoad: "America/Los_Angeles" }))).status).toBe(200);
    // Card #320: the zone the page showed goes to the service, which refuses a stale page.
    expect(h.save).toHaveBeenCalledWith({ autoTime: "01:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10 }, "America/Los_Angeles");
  });

  it("switching on without a proved key is a 409 with a sentence", async () => {
    h.enable.mockRejectedValueOnce(new AutoConflictError("Make a key and check it with its key file before switching automatic backups on"));
    const res = await PUT(json("PUT", { enabled: true }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Make a key/);
  });

  it("a new key is downloaded as its key file, never cached", async () => {
    const res = await makeKey(json("POST", { passphrase: "correct horse battery" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("YoSched key 2026-11-17 abcdef0123456789.yosched-key");
    expect(res.headers.get("cache-control")).toBe("no-store");
    h.makeKey.mockRejectedValueOnce(new BackupFileError("The passphrase must be at least 12 characters"));
    expect((await makeKey(json("POST", { passphrase: "x" }))).status).toBe(422);
  });

  it("checking a key: needs both parts, refuses an oversized file before reading it", async () => {
    expect((await verify(keyForm(20, ""))).status).toBe(400);
    expect((await verify(keyForm(17 * 1024))).status).toBe(413);
    expect(h.verify).not.toHaveBeenCalled();
    expect((await verify(keyForm())).status).toBe(200);
    expect(h.verify).toHaveBeenCalledWith(expect.any(Buffer), "correct horse battery");
    h.verify.mockRejectedValueOnce(new BackupFileError("Wrong passphrase, or the key file is damaged"));
    expect((await verify(keyForm())).status).toBe(422);
  });

  it("restore and check pass an attached key file along", async () => {
    const fd = new FormData();
    fd.set("file", new Blob([new Uint8Array(10)]), "b.yosched-backup");
    fd.set("keyfile", new Blob([new Uint8Array([1, 2, 3])]), "k.yosched-key");
    fd.set("passphrase", "correct horse battery");
    fd.set("confirm", "REPLACE");
    expect((await restore(new Request("http://x", { method: "POST", body: fd }))).status).toBe(200);
    expect(h.restore).toHaveBeenCalledWith(expect.any(Buffer), "correct horse battery", "replace", Buffer.from([1, 2, 3]));
    expect((await check(new Request("http://x", { method: "POST", body: fd }))).status).toBe(200);
    expect(h.check).toHaveBeenCalledWith(expect.any(Buffer), "correct horse battery", Buffer.from([1, 2, 3]));
  });

  it("a key file over 16 KB with a restore is refused", async () => {
    const fd = new FormData();
    fd.set("file", new Blob([new Uint8Array(10)]), "b.yosched-backup");
    fd.set("keyfile", new Blob([new Uint8Array(17 * 1024)]), "k.yosched-key");
    fd.set("passphrase", "correct horse battery");
    fd.set("confirm", "REPLACE");
    expect((await restore(new Request("http://x", { method: "POST", body: fd }))).status).toBe(400);
    expect(h.restore).not.toHaveBeenCalled();
  });
});
