import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth-guard";
import { exclusiveRoute } from "@/lib/write-gate";
import { restoreBackup } from "@/lib/backup/service";
import { readUpload, refusal } from "../http";
import { CONFIRM_WORD } from "@/lib/backup/reminder";

// Card #314: replace everything with a backup file. The admin types REPLACE to confirm;
// what is there now is saved on the server first.

async function handlePOST(req: Request) {
  const { error } = await getSession("data:backup");
  if (error) return error;
  const up = await readUpload(req);
  if (up instanceof NextResponse) return up;
  if (up.form.get("confirm") !== CONFIRM_WORD) return NextResponse.json({ error: `Type ${CONFIRM_WORD} to confirm` }, { status: 400 });
  try {
    const { counts, safetyFile } = await restoreBackup(up.bytes, up.passphrase, "replace");
    console.log(`[backup] restore (replace) committed: ${Object.values(counts).reduce((a, b) => a + b, 0)} rows; safety file ${safetyFile}`);
    return NextResponse.json({ ok: true, counts, safetyFile: safetyFile ? safetyFile.split("/").pop() : null });
  } catch (e) {
    return refusal(e);
  }
}

export const POST = exclusiveRoute(handlePOST);
