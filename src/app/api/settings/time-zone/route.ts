import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-guard";
import { gated } from "@/lib/write-gate";
import { isValidZone, resolveZone } from "@/lib/time-zone";
import { prisma } from "@/lib/prisma";
import { AutoConflictError, setTimeZone } from "@/lib/backup/auto-service";

// Card #320: Settings › Time zone. Every time YoSched shows or asks for is in this zone. Changing
// it converts the automatic backup time in the same transaction, so the next backup keeps its moment.
// zoneAtLoad is the stored zone the page showed (null = none chosen); a stale page is refused.

/** Any signed-in login: the zone every page shows times in (not a secret; every page needs it). */
async function handleGET() {
  const { error } = await getSession();
  if (error) return error;
  const prefs = await prisma.schedulingPreferences.findFirst({ select: { timeZone: true } });
  const storedZone = prefs?.timeZone ?? null;
  return NextResponse.json({ storedZone, zone: resolveZone(storedZone) });
}

async function handlePUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const timeZone = body?.timeZone;
  if (!isValidZone(timeZone)) return NextResponse.json({ error: "Choose a time zone from the list" }, { status: 400 });
  const zoneAtLoad = body?.zoneAtLoad;
  if (zoneAtLoad !== null && typeof zoneAtLoad !== "string") {
    return NextResponse.json({ error: "zoneAtLoad must be the zone the page showed, or null" }, { status: 400 });
  }
  try {
    return NextResponse.json(await setTimeZone(timeZone, zoneAtLoad));
  } catch (e) {
    if (e instanceof AutoConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

export const GET = gated(handleGET);
export const PUT = gated(handlePUT);
