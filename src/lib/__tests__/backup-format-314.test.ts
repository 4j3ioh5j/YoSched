import { describe, it, expect } from "vitest";
import { encodeBackup, decodeBackup, BackupFileError, MIN_PASSPHRASE } from "@/lib/backup/format";

// Card #314: the backup file's envelope. Every failure is refused with a plain message
// before anything is touched; nothing is ever half-read.
const fast = { N: 1024 };
const payload = { format: 1, tables: { Staff: [{ id: "s1", name: "Ann" }] } };
const PASS = "correct horse battery";

describe("backup file envelope (card #314)", () => {
  it("round-trips", async () => {
    const buf = await encodeBackup(payload, PASS, fast);
    expect(await decodeBackup(buf, PASS)).toEqual(payload);
  });

  it("does not contain the data in the clear", async () => {
    const buf = await encodeBackup({ secret: "ZZ-very-visible-ZZ" }, PASS, fast);
    expect(buf.includes(Buffer.from("ZZ-very-visible-ZZ"))).toBe(false);
  });

  it("wrong passphrase is refused", async () => {
    const buf = await encodeBackup(payload, PASS, fast);
    await expect(decodeBackup(buf, "another passphrase")).rejects.toThrow(/Wrong passphrase, or the file is damaged/);
  });

  it("a tampered header is refused", async () => {
    const buf = await encodeBackup(payload, PASS, fast);
    const text = buf.toString("latin1");
    const nl2 = text.indexOf("\n", text.indexOf("\n") + 1);
    const header = JSON.parse(text.slice(text.indexOf("\n") + 1, nl2));
    header.N = 2048; // still valid JSON, different parameters
    const forged = Buffer.concat([Buffer.from("YOSCHED-BACKUP\n" + JSON.stringify(header) + "\n"), buf.subarray(nl2 + 1)]);
    await expect(decodeBackup(forged, PASS)).rejects.toBeInstanceOf(BackupFileError);
  });

  it("a flipped body byte and a truncated file are refused", async () => {
    const buf = await encodeBackup(payload, PASS, fast);
    const flipped = Buffer.from(buf);
    flipped[flipped.length - 20] ^= 0xff;
    await expect(decodeBackup(flipped, PASS)).rejects.toBeInstanceOf(BackupFileError);
    await expect(decodeBackup(buf.subarray(0, buf.length - 5), PASS)).rejects.toBeInstanceOf(BackupFileError);
  });

  it("not a backup file, an empty file, and a newer format are refused with plain messages", async () => {
    await expect(decodeBackup(Buffer.from("hello"), PASS)).rejects.toThrow(/not a YoSched backup/);
    await expect(decodeBackup(Buffer.alloc(0), PASS)).rejects.toThrow(/not a YoSched backup/);
    const newer = Buffer.from('YOSCHED-BACKUP\n{"format":99}\nxx');
    await expect(decodeBackup(newer, PASS)).rejects.toThrow(/newer YoSched/);
  });

  it("refuses scrypt parameters outside sane bounds (a forged header can't exhaust memory)", async () => {
    const evil = Buffer.from('YOSCHED-BACKUP\n{"format":1,"kdf":"scrypt","N":1073741824,"r":8,"p":1,"salt":"AA==","iv":"AAAAAAAAAAAAAAAA"}\nxxxxxxxxxxxxxxxxxxxxxxxx');
    await expect(decodeBackup(evil, PASS)).rejects.toThrow(/damaged/);
  });

  it("caps the unpacked size", async () => {
    const big = { blob: "a".repeat(200_000) };
    const buf = await encodeBackup(big, PASS, fast);
    await expect(decodeBackup(buf, PASS, { maxUnpackedBytes: 50_000 })).rejects.toThrow(/too large/);
  });

  it("refuses a short passphrase when making a file", async () => {
    await expect(encodeBackup(payload, "x".repeat(MIN_PASSPHRASE - 1), fast)).rejects.toThrow(/at least 12/);
  });
});
