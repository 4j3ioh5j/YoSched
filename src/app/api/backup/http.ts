import { NextResponse } from "next/server";
import { BackupFileError } from "@/lib/backup/format";
import { MAX_UPLOAD_BYTES, NotEmptyError } from "@/lib/backup/service";

// Card #314: shared request parsing and error mapping for the backup routes.

/** Room for the form's own fields and boundaries around the file. */
const FORM_OVERHEAD = 64 * 1024;
const tooLarge = () => NextResponse.json({ error: "The file is too large" }, { status: 413 });

/** The whole request body, or null as soon as it passes `limit` bytes (the rest is never read:
 *  the stream is cancelled). A missing or false Content-Length can't get past this. */
async function readCapped(req: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => {}); return null; } // already refusing
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

export async function readUpload(req: Request): Promise<{ bytes: Buffer; passphrase: string; form: FormData } | NextResponse> {
  const limit = MAX_UPLOAD_BYTES + FORM_OVERHEAD;
  if (Number(req.headers.get("content-length") ?? "0") > limit) return tooLarge();
  const body = await readCapped(req, limit);
  if (body === null) return tooLarge();
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch { return NextResponse.json({ error: "Choose a backup file" }, { status: 400 }); }
  const file = form.get("file");
  const passphrase = form.get("passphrase");
  if (!(file instanceof Blob) || typeof passphrase !== "string" || !passphrase) {
    return NextResponse.json({ error: "Choose a backup file and enter its passphrase" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) return tooLarge();
  return { bytes: Buffer.from(await file.arrayBuffer()), passphrase, form };
}

/** A refusal the person can act on → 4xx with its sentence; anything else is rethrown. */
export function refusal(e: unknown): NextResponse {
  if (e instanceof BackupFileError) return NextResponse.json({ error: e.message }, { status: 422 });
  if (e instanceof NotEmptyError) return NextResponse.json({ error: e.message }, { status: 409 });
  throw e;
}
