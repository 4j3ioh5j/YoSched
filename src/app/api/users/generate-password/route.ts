import { randomInt } from "node:crypto";
import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { canManageGroupLevel } from "@/lib/permissions";
import { generatePassword } from "@/lib/generate-password";

// POST {id}: give an existing login a fresh one-time password (Admin / Super User). The
// password is returned ONCE in the response (never stored in clear, never logged); the
// person must replace it at their next sign-in. Doesn't change whether the login is
// active — that stays a separate, explicit step.
export async function POST(req: NextRequest) {
  const result = await getSession("users:edit");
  if (result.error) return result.error;

  const body = await req.json().catch(() => null);
  const id = body && typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (id === result.userId) {
    return NextResponse.json({ error: "Change your own password on your Account page" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id }, select: { email: true, group: { select: { level: true } } } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!canManageGroupLevel(result.groupLevel, target.group.level)) {
    return NextResponse.json({ error: "Cannot edit a user above your group level" }, { status: 403 });
  }

  const password = generatePassword(randomInt);
  const passwordHash = await hash(password, 12);
  // A fresh password also lifts a lockout from failed attempts on the old one.
  await prisma.user.update({
    where: { id },
    data: { passwordHash, mustChangePassword: true, failedAttempts: 0, lockedUntil: null },
  });

  return NextResponse.json(
    { password, hasEmail: !!target.email },
    { headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } },
  );
}
