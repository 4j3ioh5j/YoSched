import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const result = await getSession("users:edit");
  if (result.error) return result.error;

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { group: { select: { level: true } } },
  });
  if (targetUser?.group && targetUser.group.level >= result.groupLevel) {
    return NextResponse.json({ error: "Cannot reset TOTP for a user at or above your group level" }, { status: 403 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: null, totpEnabled: false },
  });

  return NextResponse.json({ ok: true });
}
