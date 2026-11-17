import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth-guard";
import { gated } from "@/lib/write-gate";
import { MAX_KEY_FILE_BYTES } from "@/lib/backup/format";
import { getAutoView, verifyPendingKey } from "@/lib/backup/auto-service";
import { FORM_OVERHEAD, readCapped, refusal } from "../../http";

// Card #315: check the new key with its key file and passphrase. A real automatic backup is
// made to the new key in memory and opened again; only then does the key take over and
// automatic backups switch on.
async function handlePOST(req: Request) {
  const { error } = await getSession("data:backup");
  if (error) return error;
  const limit = MAX_KEY_FILE_BYTES + FORM_OVERHEAD;
  const tooLarge = () => NextResponse.json({ error: "That isn't a YoSched key file (it is too large)" }, { status: 413 });
  if (Number(req.headers.get("content-length") ?? "0") > limit) return tooLarge();
  const body = await readCapped(req, limit);
  if (body === null) return tooLarge();
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch { return NextResponse.json({ error: "Choose the key file" }, { status: 400 }); }
  const keyfile = form.get("keyfile");
  const passphrase = form.get("passphrase");
  if (!(keyfile instanceof Blob) || keyfile.size === 0 || typeof passphrase !== "string" || !passphrase) {
    return NextResponse.json({ error: "Choose the key file and enter its passphrase" }, { status: 400 });
  }
  if (keyfile.size > MAX_KEY_FILE_BYTES) return tooLarge();
  try {
    await verifyPendingKey(Buffer.from(await keyfile.arrayBuffer()), passphrase);
  } catch (e) {
    return refusal(e);
  }
  return NextResponse.json(await getAutoView());
}

export const POST = gated(handlePOST);
