import { auth } from "./auth";
import { prisma } from "./prisma";
import { NextResponse } from "next/server";
import { effectivePermissions } from "./permissions";

export type Permission =
  | "schedule:view" | "schedule:edit" | "schedule:auto"
  | "requests:self" | "requests:view"
  | "staff:view" | "staff:edit"
  | "statistics:view" | "statistics:manage"
  | "settings:view" | "settings:edit"
  | "users:view" | "users:edit"
  | "groups:view" | "groups:edit";

type SessionOk = {
  error: null;
  session: { user: { id: string; email?: string | null; name?: string | null } };
  userId: string;
  permissions: string[];
  groupLevel: number;
  groupName: string;
  staffId: string | null; // linked Staff record, if any (self-service requests)
};

type SessionErr = {
  error: NextResponse;
  session: null;
  userId?: undefined;
  permissions?: undefined;
  groupLevel?: undefined;
  groupName?: undefined;
  staffId?: undefined;
};

type SessionResult = SessionOk | SessionErr;

export async function getSession(required?: Permission | Permission[]): Promise<SessionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true, staffId: true, group: { select: { permissions: true, level: true, name: true } } },
  });

  if (!dbUser || !dbUser.isActive) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }

  // Authorization is group-based: every user belongs to a group (groupId NOT NULL), so
  // permissions, level, and name all come straight from it.
  const permissions = effectivePermissions(dbUser.group);
  const groupLevel = dbUser.group.level;
  const groupName = dbUser.group.name;

  if (required) {
    const needed = Array.isArray(required) ? required : [required];
    for (const perm of needed) {
      if (!permissions.includes(perm)) {
        return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), session: null };
      }
    }
  }

  const user = session.user!;
  return { error: null, session: { user: user as { id: string } }, userId: user.id!, permissions, groupLevel, groupName, staffId: dbUser.staffId };
}
