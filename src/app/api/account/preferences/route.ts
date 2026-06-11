import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { parseUserSort } from "@/lib/users-sort";
import { NextRequest, NextResponse } from "next/server";

// Self-service: any logged-in user reads/writes ONLY their own UI preferences. There is no
// user id in the body — the target is always the session user — so this can't touch anyone
// else's row regardless of what the client sends.

function asObject(value: unknown): Record<string, unknown> {
  // uiPreferences defaults to {} but a manual DB edit or future code could leave it a
  // non-object; never spread anything but a plain object.
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function PUT(req: NextRequest) {
  const { error, userId } = await getSession();
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Only the users-table sort is supported today. Validate with the shared parser so junk
  // shapes are rejected rather than persisted.
  const usersTableSort = parseUserSort((body as Record<string, unknown>).usersTableSort);
  if (!usersTableSort) {
    return NextResponse.json({ error: "Invalid usersTableSort" }, { status: 400 });
  }

  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { uiPreferences: true },
  });
  if (!current) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const merged = { ...asObject(current.uiPreferences), usersTableSort };
  await prisma.user.update({ where: { id: userId }, data: { uiPreferences: merged } });

  return NextResponse.json({ ok: true, usersTableSort });
}
