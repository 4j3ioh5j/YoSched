import { prisma } from "@/lib/prisma";
import { getSession, isTotpRequired } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { gated } from "@/lib/write-gate";

// Card #319: "Require two-factor sign-in for every login" (Users page, next to the trusted
// device days). When on, a login without two-factor can only set it up after signing in.

async function handleGET() {
  const { error } = await getSession("users:view");
  if (error) return error;
  const [requireTotp, pendingLogins] = await Promise.all([
    isTotpRequired(),
    prisma.user.count({ where: { isActive: true, totpEnabled: false } }),
  ]);
  return NextResponse.json({ requireTotp, pendingLogins });
}

async function handlePUT(req: NextRequest) {
  const { error, userId } = await getSession("settings:edit");
  if (error) return error;

  const body = await req.json().catch(() => null);
  const requireTotp = body?.requireTotp;
  if (typeof requireTotp !== "boolean") {
    return NextResponse.json({ error: "requireTotp must be true or false" }, { status: 400 });
  }

  if (requireTotp) {
    const me = await prisma.user.findUnique({ where: { id: userId! }, select: { totpEnabled: true } });
    if (!me?.totpEnabled) {
      return NextResponse.json({ error: "Set up two-factor sign-in for your own login first (Account page), then turn this on." }, { status: 409 });
    }
  }

  await prisma.schedulingPreferences.upsert({
    where: { id: "default" },
    update: { requireTotp },
    create: { id: "default", requireTotp },
  });
  return NextResponse.json({ requireTotp });
}

export const GET = gated(handleGET);
export const PUT = gated(handlePUT);
