import { NextResponse } from "next/server";
import { gated, exclusiveRoute } from "@/lib/write-gate";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { backupDir, restoreBackup } from "@/lib/backup/service";
import { ensureSetupCode, verifySetupCode, removeSetupCode } from "@/lib/backup/setup-code";
import { readUpload, refusal } from "../http";

// Card #314: first-run restore on an empty install. Public (nobody can sign in yet), so it
// needs the one-time setup code from the server, is rate-limited, and answers 404 as soon
// as any login exists.

async function empty(): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}

async function handleGET() {
  if (!(await empty())) return NextResponse.json({ available: false }, { status: 404 });
  await ensureSetupCode(backupDir());
  return NextResponse.json({ available: true });
}

async function handlePOST(req: Request) {
  if (!(await empty())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const rl = checkRateLimit(`backup-initial:${ip}`);
  if (!rl.allowed) return NextResponse.json({ error: "Too many attempts — wait a minute" }, { status: 429 });
  // The code travels in a header so it is checked before a byte of the upload is read:
  // nobody without it can make this server buffer anything.
  const code = req.headers.get("x-setup-code");
  if (!code || !(await verifySetupCode(backupDir(), code))) {
    await req.body?.cancel().catch(() => {}); // refusing anyway
    return NextResponse.json({ error: "That setup code isn't right" }, { status: 403 });
  }
  const up = await readUpload(req);
  if (up instanceof NextResponse) return up;
  try {
    const { counts } = await restoreBackup(up.bytes, up.passphrase, "initial", up.keyFile);
    await removeSetupCode(backupDir());
    console.log(`[backup] first-run restore committed: ${Object.values(counts).reduce((a, b) => a + b, 0)} rows`);
    return NextResponse.json({ ok: true, counts });
  } catch (e) {
    return refusal(e);
  }
}

export const GET = gated(handleGET);
export const POST = exclusiveRoute(handlePOST);
