import { getSession } from "@/lib/auth-guard";
import { gated } from "@/lib/write-gate";
import { createPendingKey } from "@/lib/backup/auto-service";
import { refusal } from "../../http";

// Card #315: make a new key for automatic backups. The key file is sent once, here, and never
// kept on the server; the key waits until the admin checks it (../verify).
async function handlePOST(req: Request) {
  const { error } = await getSession("data:backup");
  if (error) return error;
  const body = (await req.json().catch(() => null)) as { passphrase?: unknown } | null;
  const passphrase = typeof body?.passphrase === "string" ? body.passphrase : "";
  try {
    const { keyFile, fileName } = await createPendingKey(passphrase);
    return new Response(new Uint8Array(keyFile), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return refusal(e);
  }
}

export const POST = gated(handlePOST);
