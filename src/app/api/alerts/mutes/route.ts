import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { parseAlertKey } from "@/lib/alerts";
import { NextRequest, NextResponse } from "next/server";

// Mute/unmute a schedule alert. Mutes are SHARED across all logins, so mutating
// them requires the same authority as editing the schedule (schedule:edit).
// Reading mutes is not exposed here — they're loaded server-side with the grid.

async function readKey(req: NextRequest): Promise<string | null> {
  const body = await req.json().catch(() => null);
  return parseAlertKey((body as { alertKey?: unknown } | null)?.alertKey);
}

// POST { alertKey } — mute. Idempotent: re-muting an already-muted key just
// refreshes who muted it.
export async function POST(req: NextRequest) {
  const { error, userId } = await getSession("schedule:edit");
  if (error) return error;

  const alertKey = await readKey(req);
  if (!alertKey) {
    return NextResponse.json({ error: "Invalid alertKey" }, { status: 400 });
  }

  await prisma.mutedAlert.upsert({
    where: { alertKey },
    update: { mutedBy: userId },
    create: { alertKey, mutedBy: userId },
  });

  return NextResponse.json({ ok: true, alertKey, muted: true });
}

// DELETE { alertKey } — unmute. Idempotent: deleting a missing key is a no-op.
export async function DELETE(req: NextRequest) {
  const { error } = await getSession("schedule:edit");
  if (error) return error;

  const alertKey = await readKey(req);
  if (!alertKey) {
    return NextResponse.json({ error: "Invalid alertKey" }, { status: 400 });
  }

  await prisma.mutedAlert.deleteMany({ where: { alertKey } });

  return NextResponse.json({ ok: true, alertKey, muted: false });
}
