import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { canManageGroupLevel, effectiveGroupLevel, type Role } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const result = await getSession("users:edit");
  if (result.error) return result.error;

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, group: { select: { level: true } } },
  });
  if (targetUser && !canManageGroupLevel(result.groupLevel, effectiveGroupLevel(targetUser.role as Role, targetUser.group))) {
    return NextResponse.json({ error: "Cannot reset TOTP for a user above your group level" }, { status: 403 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: null, totpEnabled: false },
  });

  return NextResponse.json({ ok: true });
}
