import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const { ids } = (await req.json()) as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }

  await prisma.$transaction(
    ids.map((id, i) =>
      prisma.shiftType.update({ where: { id }, data: { sortOrder: i } })
    )
  );

  return NextResponse.json({ ok: true });
}
