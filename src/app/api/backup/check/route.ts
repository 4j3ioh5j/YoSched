import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth-guard";
import { gated } from "@/lib/write-gate";
import { checkBackup } from "@/lib/backup/service";
import { readUpload, refusal } from "../http";

// Card #314: check a backup file (passphrase, completeness, fit with this YoSched). Changes nothing.
async function handlePOST(req: Request) {
  const { error } = await getSession("data:backup");
  if (error) return error;
  const up = await readUpload(req);
  if (up instanceof NextResponse) return up;
  try {
    return NextResponse.json(await checkBackup(up.bytes, up.passphrase, up.keyFile));
  } catch (e) {
    return refusal(e);
  }
}

export const POST = gated(handlePOST);
