import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-guard";
import { validatePassword } from "@/lib/password";
import { NextRequest, NextResponse } from "next/server";
import { compare, hash } from "bcryptjs";

export async function PUT(req: NextRequest) {
  const { error, session } = await requireAuth("viewer");
  if (error) return error;

  const { currentPassword, newPassword } = await req.json();
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new password required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session!.user!.id } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const valid = await compare(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const { valid: passValid, errors } = validatePassword(newPassword);
  if (!passValid) {
    return NextResponse.json({ error: `Password requirements: ${errors.join(", ")}` }, { status: 400 });
  }

  const passwordHash = await hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  return NextResponse.json({ ok: true });
}
