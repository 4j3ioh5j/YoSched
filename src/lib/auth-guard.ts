import { auth } from "./auth";
import { prisma } from "./prisma";
import { NextResponse } from "next/server";

export type Permission =
  | "schedule:view" | "schedule:edit" | "schedule:auto"
  | "staff:view" | "staff:edit"
  | "statistics:view"
  | "settings:view" | "settings:edit"
  | "users:view" | "users:edit"
  | "groups:view" | "groups:edit";

type Role = "admin" | "manager" | "viewer";

const ROLE_LEVEL: Record<Role, number> = {
  viewer: 0,
  manager: 1,
  admin: 2,
};

type SessionOk = {
  error: null;
  session: { user: { id: string; email?: string | null; name?: string | null; role?: string } };
  userId: string;
  permissions: string[];
  groupLevel: number;
  groupName: string;
};

type SessionErr = {
  error: NextResponse;
  session: null;
  userId?: undefined;
  permissions?: undefined;
  groupLevel?: undefined;
  groupName?: undefined;
};

type SessionResult = SessionOk | SessionErr;

export async function getSession(required?: Permission | Permission[]): Promise<SessionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, isActive: true, groupId: true, group: { select: { permissions: true, level: true, name: true } } },
  });

  if (!dbUser || !dbUser.isActive) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }

  let permissions: string[];
  let groupLevel: number;
  let groupName: string;

  if (dbUser.group) {
    permissions = dbUser.group.permissions;
    groupLevel = dbUser.group.level;
    groupName = dbUser.group.name;
  } else {
    // Dual-mode fallback: user not yet assigned to a group (stale data)
    const role = dbUser.role as Role;
    if (role === "admin") {
      permissions = ["schedule:view", "schedule:edit", "schedule:auto", "staff:view", "staff:edit", "statistics:view", "settings:view", "settings:edit", "users:view", "users:edit", "groups:view", "groups:edit"];
      groupLevel = 3;
      groupName = "Admin";
    } else if (role === "manager") {
      permissions = ["schedule:view", "schedule:edit", "schedule:auto", "staff:view", "staff:edit", "statistics:view", "settings:view", "settings:edit", "users:view", "users:edit", "groups:view", "groups:edit"];
      groupLevel = 2;
      groupName = "Super User";
    } else {
      permissions = ["schedule:view", "statistics:view", "settings:view"];
      groupLevel = 0;
      groupName = "Staff";
    }
  }

  if (required) {
    const needed = Array.isArray(required) ? required : [required];
    for (const perm of needed) {
      if (!permissions.includes(perm)) {
        return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), session: null };
      }
    }
  }

  const user = session.user!;
  (user as { role: string }).role = dbUser.role as string;
  return { error: null, session: { user: user as { id: string; role?: string } }, userId: user.id!, permissions, groupLevel, groupName };
}

// --- Legacy functions (kept during migration, removed in phase 3) ---

export async function requireAuth(minRole: Role = "viewer") {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, isActive: true },
  });

  if (!dbUser || !dbUser.isActive) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }

  const userRole = dbUser.role as Role;
  if (!userRole || ROLE_LEVEL[userRole] < ROLE_LEVEL[minRole]) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), session: null };
  }

  (session.user as { role: string }).role = userRole;
  return { error: null, session };
}

export async function getSessionRole(): Promise<{ role: Role; userId: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, isActive: true },
  });

  if (!dbUser || !dbUser.isActive) return null;
  return { role: dbUser.role as Role, userId: session.user.id };
}
