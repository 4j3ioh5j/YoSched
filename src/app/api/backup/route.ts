import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth-guard";
import { exclusiveRoute } from "@/lib/write-gate";
import { createBackup } from "@/lib/backup/service";
import { MIN_PASSPHRASE } from "@/lib/backup/format";
import { refusal } from "./http";
import { backupFileName } from "@/lib/backup/reminder";

// Card #314: download a backup of everything, encrypted with the passphrase given.
async function handlePOST(req: Request) {
  const { error } = await getSession("data:backup");
  if (error) return error;
  const body = (await req.json().catch(() => null)) as { passphrase?: unknown } | null;
  const passphrase = typeof body?.passphrase === "string" ? body.passphrase : "";
  if (passphrase.length < MIN_PASSPHRASE) return NextResponse.json({ error: `The passphrase must be at least ${MIN_PASSPHRASE} characters` }, { status: 400 });
  try {
    const { bytes, createdAt } = await createBackup(passphrase);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${backupFileName(createdAt)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return refusal(e);
  }
}

export const POST = exclusiveRoute(handlePOST);
