import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }

  const rl = checkRateLimit(email.toLowerCase());
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return NextResponse.json({ error: `Account locked. Try again in ${mins} minutes.` }, { status: 423 });
  }

  const valid = await compare(password, user.passwordHash);
  if (!valid) {
    const attempts = user.failedAttempts + 1;
    const data: { failedAttempts: number; lockedUntil?: Date } = { failedAttempts: attempts };
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      data.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
    }
    await prisma.user.update({ where: { id: user.id }, data });
    const remaining = MAX_FAILED_ATTEMPTS - attempts;
    const msg = remaining > 0
      ? `Invalid email or password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
      : `Account locked for ${LOCKOUT_MINUTES} minutes.`;
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  return NextResponse.json({ requiresTotp: user.totpEnabled });
}
