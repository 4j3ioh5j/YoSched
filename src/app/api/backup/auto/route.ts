import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth-guard";
import { gated } from "@/lib/write-gate";
import { parseAutoSettings } from "@/lib/backup/auto";
import { getAutoView, saveAutoSettings, setAutoEnabled } from "@/lib/backup/auto-service";
import { refusal } from "../http";

// Card #315: automatic daily backups — what is set, how it is going, and changing it.
async function handleGET() {
  const { error } = await getSession("data:backup");
  if (error) return error;
  return NextResponse.json(await getAutoView());
}

/** { enabled: boolean } switches on or off; otherwise the time and how many copies to keep. */
async function handlePUT(req: Request) {
  const { error } = await getSession("data:backup");
  if (error) return error;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    if (body && typeof body.enabled === "boolean" && Object.keys(body).length === 1) {
      await setAutoEnabled(body.enabled);
    } else {
      const parsed = parseAutoSettings(body);
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
      await saveAutoSettings(parsed.value);
    }
  } catch (e) {
    return refusal(e);
  }
  return NextResponse.json(await getAutoView());
}

export const GET = gated(handleGET);
export const PUT = gated(handlePUT);
