// Card #335: Restore is its own section, after both kinds of backup, and once a backup file is
// chosen it says exactly what that file needs: a manual backup only its download passphrase; an
// automatic one its key file (named by date and ID) and the key's passphrase.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { encodeBackup, encodeAutoBackup, createBackupKey } from "@/lib/backup/format";
import { backupKindOf, restoreGuide, HEAD_BYTES } from "../restore-kind";

const head = (b: Buffer) => new Uint8Array(b.subarray(0, HEAD_BYTES));

describe("backupKindOf", () => {
  it("reads a downloaded (manual) backup as manual", async () => {
    const file = await encodeBackup({ x: 1 }, "a long passphrase here", { N: 1024 });
    expect(backupKindOf(head(file))).toEqual({ kind: "manual" });
  });
  it("reads an automatic backup as automatic, with its key's ID and date", async () => {
    const key = await createBackupKey("a long passphrase here", { N: 1024, createdAt: new Date("2026-11-16T20:00:00Z") });
    const file = await encodeAutoBackup({ x: 1 }, { publicKey: key.publicKey, keyId: key.keyId, keyCreatedAt: key.createdAt });
    expect(backupKindOf(head(file))).toEqual({ kind: "automatic", keyId: key.keyId, keyCreatedAt: key.createdAt });
  });
  it("anything else is unknown (a key file, junk, an empty or cut-off file)", async () => {
    const key = await createBackupKey("a long passphrase here", { N: 1024 });
    expect(backupKindOf(head(key.keyFile))).toEqual({ kind: "unknown" });
    expect(backupKindOf(new TextEncoder().encode("hello"))).toEqual({ kind: "unknown" });
    expect(backupKindOf(new Uint8Array())).toEqual({ kind: "unknown" });
    expect(backupKindOf(new TextEncoder().encode('YOSCHED-BACKUP\n{"format":2,"keyId":"zz"'))).toEqual({ kind: "unknown" });
    expect(backupKindOf(new TextEncoder().encode('YOSCHED-BACKUP\n{"format":2,"keyId":"0123456789abcdef","keyCreatedAt":"nope"}\n'))).toEqual({ kind: "unknown" });
  });
});

describe("restoreGuide", () => {
  const day = (iso: string) => `D(${iso.slice(0, 10)})`;
  it("before a file is chosen: asks for the file, no key box", () => {
    const g = restoreGuide(null, day);
    expect(g.needsKey).toBe(false);
    expect(g.askPass).toBe(false);
  });
  it("manual: only the passphrase chosen at download, no key file", () => {
    const g = restoreGuide({ kind: "manual" }, day);
    expect(g.needsKey).toBe(false);
    expect(g.askPass).toBe(true);
    expect(g.text).toMatch(/manual backup/i);
    expect(g.text).toMatch(/No key file is needed/);
    expect(g.text).not.toMatch(/choose (that|the) key file/i);
    expect(g.passPlaceholder).toMatch(/passphrase you chose when you downloaded/i);
  });
  it("automatic: names the key by date and ID, needs the key file and the key's passphrase", () => {
    const g = restoreGuide({ kind: "automatic", keyId: "23e5c8d688704ce7", keyCreatedAt: "2026-11-16T20:00:00Z" }, day);
    expect(g.needsKey).toBe(true);
    expect(g.askPass).toBe(true);
    expect(g.text).toContain("D(2026-11-16)");
    expect(g.text).toContain("23e5c8d688704ce7");
    expect(g.passPlaceholder).toMatch(/key's passphrase/i);
  });
  it("unknown: says so; the server still gets the last word on Check file", () => {
    const g = restoreGuide({ kind: "unknown" }, day);
    expect(g.text).toMatch(/doesn't look like a YoSched backup/i);
    expect(g.needsKey).toBe(false);
    expect(g.askPass).toBe(true);
  });
});

describe("the Backup and Restore panel layout", () => {
  const src = readFileSync(path.join(__dirname, "..", "backup-panel.tsx"), "utf8");
  it("Restore comes after both kinds of backup, under its own divider", () => {
    const manual = src.indexOf(">Manual backup<");
    const auto = src.indexOf("<AutoBackupSection");
    const restore = src.indexOf(">Restore from a backup<");
    expect(manual).toBeGreaterThan(-1);
    expect(auto).toBeGreaterThan(manual);
    expect(restore).toBeGreaterThan(auto);
    expect(src).not.toContain("Key file (automatic backups only)");
    expect(src).not.toContain("The file's passphrase");
  });
  it("sends the key file only for an automatic backup", () => {
    expect(src).toMatch(/needsKey && keyFile/);
  });
});
