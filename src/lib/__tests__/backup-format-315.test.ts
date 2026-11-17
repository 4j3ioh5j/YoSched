import { describe, it, expect } from "vitest";
import {
  encodeBackup, decodeBackup, encodeAutoBackup, createBackupKey, openKeyFile, readBackupHeader, isKeyFile,
  BackupFileError, MAX_FILE_BYTES, MAX_UNPACKED_BYTES,
} from "@/lib/backup/format";

// Card #315: automatic backups are locked with the install's public key (format 2) and opened
// with the key file + its passphrase. Every producer refuses a file a restore would refuse.
const fast = { N: 1024 };
const PASS = "correct horse battery";
const payload = { format: 1, tables: { staff: [{ id: "s1", name: "Ann" }] } };
const created = "2026-11-17T01:00:00.000Z";

async function key() {
  return createBackupKey(PASS, { ...fast, createdAt: new Date(created) });
}

describe("backup key file (card #315)", () => {
  it("opens with the right passphrase and names its key", async () => {
    const k = await key();
    expect(k.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(isKeyFile(k.keyFile)).toBe(true);
    const opened = await openKeyFile(k.keyFile, PASS);
    expect(opened.keyId).toBe(k.keyId);
    expect(opened.createdAt).toBe(created);
  });

  it("does not hold the private key in the clear", async () => {
    const k = await key();
    expect(k.keyFile.toString("latin1")).not.toMatch(/PRIVATE KEY/);
  });

  it("refuses a wrong passphrase, a damaged file, and a short passphrase", async () => {
    const k = await key();
    await expect(openKeyFile(k.keyFile, "another passphrase")).rejects.toThrow(/Wrong passphrase, or the key file is damaged/);
    const bad = Buffer.from(k.keyFile); bad[bad.length - 3] ^= 0xff;
    await expect(openKeyFile(bad, PASS)).rejects.toBeInstanceOf(BackupFileError);
    await expect(openKeyFile(Buffer.from("hello"), PASS)).rejects.toThrow(/not a YoSched key file/);
    await expect(createBackupKey("short", fast)).rejects.toThrow(/at least 12/);
  });

  it("refuses a key file whose header was swapped for another key's", async () => {
    const a = await key();
    const b = await key();
    const nl = (buf: Buffer) => buf.indexOf(0x0a, 12);
    const forged = Buffer.concat([b.keyFile.subarray(0, nl(b.keyFile) + 1), a.keyFile.subarray(nl(a.keyFile) + 1)]);
    await expect(openKeyFile(forged, PASS)).rejects.toBeInstanceOf(BackupFileError);
  });
});

describe("format 2: automatic backups (card #315)", () => {
  it("round-trips with the key file and its passphrase", async () => {
    const k = await key();
    const buf = await encodeAutoBackup(payload, { publicKey: k.publicKey, keyId: k.keyId, keyCreatedAt: created });
    expect(await decodeBackup(buf, PASS, { keyFile: k.keyFile })).toEqual(payload);
    expect(buf.includes(Buffer.from("Ann"))).toBe(false);
  });

  it("the header says which key it needs, without the passphrase", async () => {
    const k = await key();
    const buf = await encodeAutoBackup(payload, { publicKey: k.publicKey, keyId: k.keyId, keyCreatedAt: created });
    expect(readBackupHeader(buf)).toEqual({ format: 2, keyId: k.keyId, keyCreatedAt: created });
  });

  it("without a key file it asks for one, naming the key's date", async () => {
    const k = await key();
    const buf = await encodeAutoBackup(payload, { publicKey: k.publicKey, keyId: k.keyId, keyCreatedAt: created });
    await expect(decodeBackup(buf, PASS)).rejects.toThrow(/needs its key file.*2026-11-17/);
  });

  it("another key file is refused by name, a wrong passphrase plainly", async () => {
    const k = await key();
    const other = await key();
    const buf = await encodeAutoBackup(payload, { publicKey: k.publicKey, keyId: k.keyId, keyCreatedAt: created });
    await expect(decodeBackup(buf, PASS, { keyFile: other.keyFile })).rejects.toThrow(/doesn't fit this backup/);
    await expect(decodeBackup(buf, "another passphrase", { keyFile: k.keyFile })).rejects.toThrow(/Wrong passphrase, or the key file is damaged/);
  });

  it("a tampered header or body is refused", async () => {
    const k = await key();
    const buf = await encodeAutoBackup(payload, { publicKey: k.publicKey, keyId: k.keyId, keyCreatedAt: created });
    const flipped = Buffer.from(buf); flipped[flipped.length - 20] ^= 0xff;
    await expect(decodeBackup(flipped, PASS, { keyFile: k.keyFile })).rejects.toThrow(/damaged/);
    const text = buf.toString("latin1");
    const nl2 = text.indexOf("\n", text.indexOf("\n") + 1);
    const header = JSON.parse(text.slice(text.indexOf("\n") + 1, nl2));
    header.keyCreatedAt = "2020-01-01T00:00:00.000Z";
    const forged = Buffer.concat([Buffer.from("YOSCHED-BACKUP\n" + JSON.stringify(header) + "\n"), buf.subarray(nl2 + 1)]);
    await expect(decodeBackup(forged, PASS, { keyFile: k.keyFile })).rejects.toThrow(/damaged/);
  });

  it("each file uses a fresh one-time key (two files of the same data differ)", async () => {
    const k = await key();
    const s = { publicKey: k.publicKey, keyId: k.keyId, keyCreatedAt: created };
    const a = await encodeAutoBackup(payload, s);
    const b = await encodeAutoBackup(payload, s);
    expect(a.equals(b)).toBe(false);
  });

  it("a passphrase file still opens without a key file, and ignores one given", async () => {
    const k = await key();
    const buf = await encodeBackup(payload, PASS, fast);
    expect(await decodeBackup(buf, PASS, { keyFile: k.keyFile })).toEqual(payload);
  });

  it("a format newer than 2 is refused as made by a newer YoSched", async () => {
    await expect(decodeBackup(Buffer.from('YOSCHED-BACKUP\n{"format":3}\nxx'), PASS)).rejects.toThrow(/newer YoSched/);
  });
});

describe("every producer enforces the restore limits (card #315 plan r1)", () => {
  it("the limits are the ones a restore applies", () => {
    expect(MAX_FILE_BYTES).toBe(100 * 1024 * 1024);
    expect(MAX_UNPACKED_BYTES).toBe(1024 * 1024 * 1024);
  });

  it("a passphrase backup over the unpacked limit is refused, not made", async () => {
    const big = { blob: "a".repeat(200_000) };
    await expect(encodeBackup(big, PASS, { ...fast, limits: { maxUnpackedBytes: 100_000 } })).rejects.toThrow(/too large to restore/);
  });

  it("a passphrase backup over the file limit is refused, not made", async () => {
    const big = { blob: Array.from({ length: 5000 }, (_, i) => `${i}-${Math.random()}`).join() };
    await expect(encodeBackup(big, PASS, { ...fast, limits: { maxFileBytes: 1000 } })).rejects.toThrow(/too large to restore/);
  });

  it("an automatic backup over either limit is refused, not made", async () => {
    const k = await key();
    const s = { publicKey: k.publicKey, keyId: k.keyId, keyCreatedAt: created };
    const big = { blob: Array.from({ length: 5000 }, (_, i) => `${i}-${Math.random()}`).join() };
    await expect(encodeAutoBackup(big, s, { maxUnpackedBytes: 1000 })).rejects.toThrow(/too large to restore/);
    await expect(encodeAutoBackup(big, s, { maxFileBytes: 1000 })).rejects.toThrow(/too large to restore/);
    expect((await encodeAutoBackup(big, s)).length).toBeGreaterThan(1000);
  });

  it("a file exactly at the unpacked limit is still made and restores", async () => {
    const p = { b: "x" };
    const exact = Buffer.byteLength(JSON.stringify(p));
    const buf = await encodeBackup(p, PASS, { ...fast, limits: { maxUnpackedBytes: exact } });
    expect(await decodeBackup(buf, PASS, { maxUnpackedBytes: exact })).toEqual(p);
  });
});
