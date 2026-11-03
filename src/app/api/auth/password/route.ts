import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { validatePassword } from "@/lib/password";
import { NextRequest, NextResponse } from "next/server";
import { compare, hash } from "bcryptjs";

export async function PUT(req: NextRequest) {
  // Exempt from the forced-change gate: this IS the change.
  const { error, session } = await getSession(undefined, { allowPendingPasswordChange: true });
  if (error) return error;

  const { currentPassword, newPassword } = await req.json();
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new password required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session!.user!.id } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!user.passwordHash) {
    // Shell login with no password — there is no "current password" to verify against.
    return NextResponse.json({ error: "No password is set for this account" }, { status: 400 });
  }

  const valid = await compare(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const { valid: passValid, errors } = validatePassword(newPassword);
  if (!passValid) {
    return NextResponse.json({ error: `Password requirements: ${errors.join(", ")}` }, { status: 400 });
  }

  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "Choose a new password that is different from the current one" }, { status: 400 });
  }

  const passwordHash = await hash(newPassword, 12);
  // Setting your own password clears a pending forced change. The client then signs out,
  // so no session token keeps the old flag.
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  return NextResponse.json({ ok: true });
}
