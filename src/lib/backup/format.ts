import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, type ScryptOptions } from "node:crypto";
import { gzip as gzipCb, createGunzip } from "node:zlib";
import { promisify } from "node:util";

// Card #314: the .yosched-backup envelope.
//   line 1  "YOSCHED-BACKUP"
//   line 2  header JSON {format, kdf:"scrypt", N, r, p, salt, iv}  (authenticated as AAD)
//   rest    AES-256-GCM( gzip( JSON payload ) ) || 16-byte tag
// The key comes from the passphrase with scrypt; the passphrase is never stored.

export const FORMAT = 1;
export const MIN_PASSPHRASE = 12;
const MAGIC = "YOSCHED-BACKUP\n";
const TAG_LEN = 16;
const DEFAULT_N = 131072; // 2^17
const MAX_N = 1 << 20;
const DEFAULT_MAX_UNPACKED = 1024 * 1024 * 1024; // 1 GB

export class BackupFileError extends Error {
  constructor(message: string) { super(message); this.name = "BackupFileError"; }
}

const gzip = promisify(gzipCb);
function scrypt(pass: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(pass, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}
const kdfOpts = (N: number, r: number, p: number): ScryptOptions => ({ N, r, p, maxmem: 256 * N * r + 1024 * 1024 });

type Header = { format: number; kdf: "scrypt"; N: number; r: number; p: number; salt: string; iv: string };

export async function encodeBackup(payload: unknown, passphrase: string, opts: { N?: number } = {}): Promise<Buffer> {
  if (passphrase.length < MIN_PASSPHRASE) throw new BackupFileError(`The passphrase must be at least ${MIN_PASSPHRASE} characters`);
  const header: Header = { format: FORMAT, kdf: "scrypt", N: opts.N ?? DEFAULT_N, r: 8, p: 1, salt: randomBytes(16).toString("base64"), iv: randomBytes(12).toString("base64") };
  const headerBytes = Buffer.from(JSON.stringify(header) + "\n");
  const key = await scrypt(passphrase, Buffer.from(header.salt, "base64"), 32, kdfOpts(header.N, header.r, header.p));
  const cipher = createCipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  cipher.setAAD(headerBytes);
  const packed = await gzip(Buffer.from(JSON.stringify(payload)));
  const body = Buffer.concat([cipher.update(packed), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([Buffer.from(MAGIC), headerBytes, body]);
}

const DAMAGED = "Wrong passphrase, or the file is damaged";

function parseHeader(buf: Buffer): { header: Header; headerBytes: Buffer; body: Buffer } {
  if (buf.length < MAGIC.length || buf.subarray(0, MAGIC.length).toString("latin1") !== MAGIC) {
    throw new BackupFileError("This is not a YoSched backup file");
  }
  const end = buf.indexOf(0x0a, MAGIC.length);
  if (end < 0 || end - MAGIC.length > 4096) throw new BackupFileError(DAMAGED);
  const headerBytes = buf.subarray(MAGIC.length, end + 1);
  let header: Header;
  try { header = JSON.parse(headerBytes.toString("utf8")); } catch { throw new BackupFileError(DAMAGED); }
  if (typeof header.format !== "number") throw new BackupFileError(DAMAGED);
  if (header.format > FORMAT) throw new BackupFileError("This backup was made by a newer YoSched. Update YoSched first, then restore it.");
  const okInt = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  if (header.format !== FORMAT || header.kdf !== "scrypt" || !okInt(header.N, 1024, MAX_N) || (header.N & (header.N - 1)) !== 0
    || !okInt(header.r, 1, 16) || !okInt(header.p, 1, 4) || typeof header.salt !== "string" || typeof header.iv !== "string") {
    throw new BackupFileError(DAMAGED);
  }
  const body = buf.subarray(end + 1);
  if (body.length <= TAG_LEN) throw new BackupFileError(DAMAGED);
  return { header, headerBytes, body };
}

function gunzipCapped(data: Buffer, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const gz = createGunzip();
    const chunks: Buffer[] = [];
    let total = 0;
    gz.on("data", (c: Buffer) => {
      total += c.length;
      if (total > max) { gz.destroy(); reject(new BackupFileError("The backup is too large to restore")); return; }
      chunks.push(c);
    });
    gz.on("end", () => resolve(Buffer.concat(chunks)));
    gz.on("error", () => reject(new BackupFileError(DAMAGED)));
    gz.end(data);
  });
}

export async function decodeBackup(buf: Buffer, passphrase: string, opts: { maxUnpackedBytes?: number } = {}): Promise<unknown> {
  const { header, headerBytes, body } = parseHeader(buf);
  const key = await scrypt(passphrase, Buffer.from(header.salt, "base64"), 32, kdfOpts(header.N, header.r, header.p));
  let packed: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(body.subarray(body.length - TAG_LEN));
    packed = Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_LEN)), decipher.final()]);
  } catch {
    throw new BackupFileError(DAMAGED);
  }
  const json = await gunzipCapped(packed, opts.maxUnpackedBytes ?? DEFAULT_MAX_UNPACKED);
  try { return JSON.parse(json.toString("utf8")); } catch { throw new BackupFileError(DAMAGED); }
}
