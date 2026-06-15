import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { effectivePermissions } from "@/lib/permissions";
import { activeEditors, PRESENCE_TTL_MS } from "@/lib/presence";
import { NextResponse } from "next/server";

// Heartbeat for the passive "other editors are active" banner. Editors-only: a
// non-editor login is irrelevant to the banner, so getSession gates on schedule:edit
// and any other caller gets 403 and is never recorded. Read-only with respect to the
// schedule itself — this endpoint never touches assignments, so it is incapable of the
// edit-reverting / conflict-dialog problems that forced the earlier multi-editor
// rollback. Each call does two cheap things: refresh my own lastSeen, and return the
// OTHER editors currently active (within the TTL) so the caller can render the banner.
export async function POST() {
  const { error, userId } = await getSession("schedule:edit");
  if (error) return error;

  // Refresh my heartbeat. One row per user (PK = userId); upsert keeps it to a single
  // bounded row that is overwritten, never accumulated.
  await prisma.userActivity.upsert({
    where: { userId },
    create: { userId },
    update: { lastSeen: new Date() },
  });

  // Fetch only fresh rows (older heartbeats can't matter), joined to each login's
  // group so we can keep "is an editor" consistent with the rest of authz. The pure
  // activeEditors() helper applies the TTL + self-exclusion + editor filter and sorts.
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS);
  const rows = await prisma.userActivity.findMany({
    where: { lastSeen: { gte: cutoff } },
    select: {
      userId: true,
      lastSeen: true,
      // userId is a plain column (no FK), so resolve the login + its group separately.
    },
  });

  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.userId) } },
    select: { id: true, name: true, group: { select: { permissions: true } } },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const editors = activeEditors(
    rows.flatMap((r) => {
      const u = userById.get(r.userId);
      if (!u) return []; // login deleted since its last heartbeat — drop the stale row
      return [{ userId: r.userId, name: u.name, permissions: effectivePermissions(u.group), lastSeen: r.lastSeen }];
    }),
    { now: new Date(), selfUserId: userId }
  );

  return NextResponse.json({ activeEditors: editors });
}
