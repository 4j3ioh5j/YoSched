import {
  createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync,
  hkdfSync, randomBytes, scrypt as scryptCb, type KeyObject, type ScryptOptions,
} from "node:crypto";
import { gzip as gzipCb, createGunzip } from "node:zlib";
import { promisify } from "node:util";

// Card #314: the .yosched-backup envelope.
//   line 1  "YOSCHED-BACKUP"
//   line 2  header JSON (authenticated as AAD)
//   rest    AES-256-GCM( gzip( JSON payload ) ) || 16-byte tag
// Format 1 (Download, safety copies): {format:1, kdf:"scrypt", N, r, p, salt, iv}; the key comes
//   from the passphrase with scrypt; the passphrase is never stored.
// Format 2 (card #315, automatic backups): {format:2, kdf:"x25519", keyId, keyCreatedAt, epk, iv};
//   a fresh one-time X25519 key per file meets the install's public key (ECDH), and HKDF-SHA256
//   (salt = the one-time public key, info "yosched-backup-v2") gives the AES key. Only the key
//   file — the private key sealed with the admin's passphrase, never kept on the server — opens it.
//
// Key file ("YOSCHED-KEY"): {format:1, kdf:"scrypt", N, r, p, salt, iv, keyId, createdAt} then
//   AES-256-GCM(PKCS#8 private key) || tag, header as AAD. keyId = first 16 hex of sha256(SPKI).

export const FORMAT = 2; // the newest envelope this YoSched reads
export const MIN_PASSPHRASE = 12;
const MAGIC = "YOSCHED-BACKUP\n";
const KEY_MAGIC = "YOSCHED-KEY\n";
const TAG_LEN = 16;
const DEFAULT_N = 131072; // 2^17
const MAX_N = 1 << 20;
const HKDF_INFO = "yosched-backup-v2";
/** A key file is tiny; anything larger isn't one. */
export const MAX_KEY_FILE_BYTES = 16 * 1024;

// The restore limits. Every producer (Download, safety copy, automatic backup) refuses a file
// over them, so no file is ever made that a restore would refuse (card #315 plan r1).
export const MAX_FILE_BYTES = 100 * 1024 * 1024; // the upload limit
export const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024; // 1 GB of JSON once unzipped
export type Limits = { maxFileBytes?: number; maxUnpackedBytes?: number };

export class BackupFileError extends Error {
  constructor(message: string) { super(message); this.name = "BackupFileError"; }
}
const TOO_LARGE = "This backup would be too large to restore, so it wasn't made and nothing was changed";

const gzip = promisify(gzipCb);
function scrypt(pass: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(pass, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}
const kdfOpts = (N: number, r: number, p: number): ScryptOptions => ({ N, r, p, maxmem: 256 * N * r + 1024 * 1024 });

type ScryptHeader = { kdf: "scrypt"; N: number; r: number; p: number; salt: string; iv: string };
type Header1 = ScryptHeader & { format: 1 };
type Header2 = { format: 2; kdf: "x25519"; keyId: string; keyCreatedAt: string; epk: string; iv: string };
type KeyHeader = ScryptHeader & { format: 1; keyId: string; createdAt: string };

const okInt = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const okScrypt = (h: ScryptHeader) => h.kdf === "scrypt" && okInt(h.N, 1024, MAX_N) && (h.N & (h.N - 1)) === 0
  && okInt(h.r, 1, 16) && okInt(h.p, 1, 4) && typeof h.salt === "string" && typeof h.iv === "string";
const isKeyId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{16}$/.test(v);
const isIso = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

function newScryptHeader(N: number): ScryptHeader {
  return { kdf: "scrypt", N, r: 8, p: 1, salt: randomBytes(16).toString("base64"), iv: randomBytes(12).toString("base64") };
}
const scryptKey = (pass: string, h: ScryptHeader) => scrypt(pass, Buffer.from(h.salt, "base64"), 32, kdfOpts(h.N, h.r, h.p));

function seal(key: Buffer, iv: string, aad: Buffer, data: Buffer): Buffer {
  const cipher = createCipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}
function unseal(key: Buffer, iv: string, aad: Buffer, body: Buffer, damaged: string): Buffer {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAAD(aad);
    decipher.setAuthTag(body.subarray(body.length - TAG_LEN));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_LEN)), decipher.final()]);
  } catch {
    throw new BackupFileError(damaged);
  }
}

/** JSON → gzip, refusing anything a restore would refuse to unpack. */
async function pack(payload: unknown, limits: Limits): Promise<Buffer> {
  let json: Buffer;
  try { json = Buffer.from(JSON.stringify(payload)); } catch (e) {
    if (e instanceof RangeError) throw new BackupFileError(TOO_LARGE); // larger than a JS string can hold
    throw e;
  }
  if (json.length > (limits.maxUnpackedBytes ?? MAX_UNPACKED_BYTES)) throw new BackupFileError(TOO_LARGE);
  return gzip(json);
}
function capFile(file: Buffer, limits: Limits): Buffer {
  if (file.length > (limits.maxFileBytes ?? MAX_FILE_BYTES)) throw new BackupFileError(TOO_LARGE);
  return file;
}
const tooShort = () => new BackupFileError(`The passphrase must be at least ${MIN_PASSPHRASE} characters`);

/** Format 1: a file locked with a passphrase (Download, and the safety copy before a restore). */
export async function encodeBackup(payload: unknown, passphrase: string, opts: { N?: number; limits?: Limits } = {}): Promise<Buffer> {
  if (passphrase.length < MIN_PASSPHRASE) throw tooShort();
  const header: Header1 = { format: 1, ...newScryptHeader(opts.N ?? DEFAULT_N) };
  const headerBytes = Buffer.from(JSON.stringify(header) + "\n");
  const packed = await pack(payload, opts.limits ?? {});
  const key = await scryptKey(passphrase, header);
  return capFile(Buffer.concat([Buffer.from(MAGIC), headerBytes, seal(key, header.iv, headerBytes, packed)]), opts.limits ?? {});
}

export type PublicKeyInfo = { publicKey: string; keyId: string; keyCreatedAt: string };

const keyIdOf = (spkiDer: Buffer) => createHash("sha256").update(spkiDer).digest("hex").slice(0, 16);
function aesKey(shared: Buffer, epkDer: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, epkDer, HKDF_INFO, 32));
}

/** Format 2: an automatic backup, locked with the install's public key. */
export async function encodeAutoBackup(payload: unknown, key: PublicKeyInfo, limits: Limits = {}): Promise<Buffer> {
  const spki = Buffer.from(key.publicKey, "base64");
  const recipient = createPublicKey({ key: spki, format: "der", type: "spki" });
  if (recipient.asymmetricKeyType !== "x25519" || keyIdOf(spki) !== key.keyId) throw new Error("The automatic backup key is damaged");
  const eph = generateKeyPairSync("x25519");
  const epkDer = eph.publicKey.export({ format: "der", type: "spki" });
  const header: Header2 = { format: 2, kdf: "x25519", keyId: key.keyId, keyCreatedAt: key.keyCreatedAt, epk: epkDer.toString("base64"), iv: randomBytes(12).toString("base64") };
  const headerBytes = Buffer.from(JSON.stringify(header) + "\n");
  const packed = await pack(payload, limits);
  const k = aesKey(diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), epkDer);
  return capFile(Buffer.concat([Buffer.from(MAGIC), headerBytes, seal(k, header.iv, headerBytes, packed)]), limits);
}

/** A new key pair: the public half for the database, the private half sealed in a key file. */
export async function createBackupKey(passphrase: string, opts: { N?: number; createdAt?: Date } = {}): Promise<{ publicKey: string; keyId: string; createdAt: string; keyFile: Buffer }> {
  if (passphrase.length < MIN_PASSPHRASE) throw tooShort();
  const pair = generateKeyPairSync("x25519");
  const spki = pair.publicKey.export({ format: "der", type: "spki" });
  const keyId = keyIdOf(spki);
  const createdAt = (opts.createdAt ?? new Date()).toISOString();
  const header: KeyHeader = { format: 1, ...newScryptHeader(opts.N ?? DEFAULT_N), keyId, createdAt };
  const headerBytes = Buffer.from(JSON.stringify(header) + "\n");
  const k = await scryptKey(passphrase, header);
  const pkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" });
  return { publicKey: spki.toString("base64"), keyId, createdAt, keyFile: Buffer.concat([Buffer.from(KEY_MAGIC), headerBytes, seal(k, header.iv, headerBytes, pkcs8)]) };
}

export function isKeyFile(buf: Buffer): boolean {
  return buf.length >= KEY_MAGIC.length && buf.subarray(0, KEY_MAGIC.length).toString("latin1") === KEY_MAGIC;
}

const KEY_DAMAGED = "Wrong passphrase, or the key file is damaged";

/** Open a key file with its passphrase. The private key lives only in this process's memory. */
export async function openKeyFile(buf: Buffer, passphrase: string): Promise<{ privateKey: KeyObject; keyId: string; createdAt: string }> {
  if (!isKeyFile(buf) || buf.length > MAX_KEY_FILE_BYTES) throw new BackupFileError("This is not a YoSched key file");
  const { header, headerBytes, body } = splitHeader<KeyHeader>(buf, KEY_MAGIC.length, KEY_DAMAGED);
  if (header.format !== 1 || !okScrypt(header) || !isKeyId(header.keyId) || !isIso(header.createdAt)) throw new BackupFileError(KEY_DAMAGED);
  const pkcs8 = unseal(await scryptKey(passphrase, header), header.iv, headerBytes, body, KEY_DAMAGED);
  let privateKey: KeyObject;
  try { privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }); } catch { throw new BackupFileError(KEY_DAMAGED); }
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  if (privateKey.asymmetricKeyType !== "x25519" || keyIdOf(spki) !== header.keyId) throw new BackupFileError(KEY_DAMAGED);
  return { privateKey, keyId: header.keyId, createdAt: header.createdAt };
}

/** The public key id of an opened private key (to match it against the database's). */
export function keyIdOfPrivate(privateKey: KeyObject): string {
  return keyIdOf(createPublicKey(privateKey).export({ format: "der", type: "spki" }));
}

const DAMAGED = "Wrong passphrase, or the file is damaged";
const FILE_DAMAGED = "The backup file is damaged";

function splitHeader<H>(buf: Buffer, at: number, damaged: string): { header: H; headerBytes: Buffer; body: Buffer } {
  const end = buf.indexOf(0x0a, at);
  if (end < 0 || end - at > 4096) throw new BackupFileError(damaged);
  const headerBytes = buf.subarray(at, end + 1);
  let header: H;
  try { header = JSON.parse(headerBytes.toString("utf8")); } catch { throw new BackupFileError(damaged); }
  if (!header || typeof header !== "object") throw new BackupFileError(damaged);
  const body = buf.subarray(end + 1);
  if (body.length <= TAG_LEN) throw new BackupFileError(damaged);
  return { header, headerBytes, body };
}

function parseHeader(buf: Buffer): { header: Header1 | Header2; headerBytes: Buffer; body: Buffer } {
  if (buf.length < MAGIC.length || buf.subarray(0, MAGIC.length).toString("latin1") !== MAGIC) {
    throw new BackupFileError("This is not a YoSched backup file");
  }
  const end = buf.indexOf(0x0a, MAGIC.length);
  if (end < 0 || end - MAGIC.length > 4096) throw new BackupFileError(DAMAGED);
  let peek: { format?: unknown };
  try { peek = JSON.parse(buf.subarray(MAGIC.length, end + 1).toString("utf8")); } catch { throw new BackupFileError(DAMAGED); }
  if (!peek || typeof peek.format !== "number") throw new BackupFileError(DAMAGED);
  if (peek.format > FORMAT) throw new BackupFileError("This backup was made by a newer YoSched. Update YoSched first, then restore it.");
  const parts = splitHeader<Header1 | Header2>(buf, MAGIC.length, DAMAGED);
  const h = parts.header;
  if (h.format === 1 && okScrypt(h)) return parts;
  if (h.format === 2 && h.kdf === "x25519" && isKeyId(h.keyId) && isIso(h.keyCreatedAt)
    && typeof h.epk === "string" && h.epk.length <= 200 && typeof h.iv === "string") return parts;
  throw new BackupFileError(DAMAGED);
}

/** What a file needs to be opened, without opening it. */
export function readBackupHeader(buf: Buffer): { format: 1 } | { format: 2; keyId: string; keyCreatedAt: string } {
  const { header } = parseHeader(buf);
  return header.format === 1 ? { format: 1 } : { format: 2, keyId: header.keyId, keyCreatedAt: header.keyCreatedAt };
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

const day = (iso: string) => iso.slice(0, 10);

/** Open a backup: format 1 with its passphrase; format 2 with its key file + that file's passphrase. */
export async function decodeBackup(buf: Buffer, passphrase: string, opts: { maxUnpackedBytes?: number; keyFile?: Buffer | null } = {}): Promise<unknown> {
  const { header, headerBytes, body } = parseHeader(buf);
  let packed: Buffer;
  if (header.format === 1) {
    packed = unseal(await scryptKey(passphrase, header), header.iv, headerBytes, body, DAMAGED);
  } else {
    if (!opts.keyFile) {
      throw new BackupFileError(`This backup was made automatically and needs its key file too: the key made on ${day(header.keyCreatedAt)}. Choose the key file, and enter that key's passphrase.`);
    }
    const key = await openKeyFile(opts.keyFile, passphrase);
    if (key.keyId !== header.keyId) {
      throw new BackupFileError(`This key file doesn't fit this backup: the backup needs the key made on ${day(header.keyCreatedAt)}, and this key file is the one made on ${day(key.createdAt)}.`);
    }
    let epk: KeyObject;
    try { epk = createPublicKey({ key: Buffer.from(header.epk, "base64"), format: "der", type: "spki" }); } catch { throw new BackupFileError(FILE_DAMAGED); }
    if (epk.asymmetricKeyType !== "x25519") throw new BackupFileError(FILE_DAMAGED);
    let shared: Buffer;
    try { shared = diffieHellman({ privateKey: key.privateKey, publicKey: epk }); } catch { throw new BackupFileError(FILE_DAMAGED); }
    packed = unseal(aesKey(shared, Buffer.from(header.epk, "base64")), header.iv, headerBytes, body, FILE_DAMAGED);
  }
  const json = await gunzipCapped(packed, opts.maxUnpackedBytes ?? MAX_UNPACKED_BYTES);
  try { return JSON.parse(json.toString("utf8")); } catch { throw new BackupFileError(DAMAGED); }
}
