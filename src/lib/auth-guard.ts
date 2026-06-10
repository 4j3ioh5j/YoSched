import { auth } from "./auth";
import { prisma } from "./prisma";
import { NextResponse } from "next/server";
import { effectivePermissions, type Role } from "./permissions";

export type Permission =
  | "schedule:view" | "schedule:edit" | "schedule:auto"
  | "requests:self"
  | "staff:view" | "staff:edit"
  | "statistics:view" | "statistics:manage"
  | "settings:view" | "settings:edit"
  | "users:view" | "users:edit"
  | "groups:view" | "groups:edit";

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
    select: { role: true, isActive: true, groupId: true, staffId: true, group: { select: { permissions: true, level: true, name: true } } },
  });

  if (!dbUser || !dbUser.isActive) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }

  // Effective permissions resolve identically here and in the admin-safety invariant
  // (src/lib/permissions.ts): group wins, else role default.
  const role = dbUser.role as Role;
  const permissions = effectivePermissions(role, dbUser.group);
  let groupLevel: number;
  let groupName: string;
  if (dbUser.group) {
    groupLevel = dbUser.group.level;
    groupName = dbUser.group.name;
  } else if (role === "admin") {
    // Dual-mode fallback: user not yet assigned to a group (stale data)
    groupLevel = 3;
    groupName = "Admin";
  } else if (role === "manager") {
    groupLevel = 2;
    groupName = "Super User";
  } else {
    groupLevel = 0;
    groupName = "Staff";
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
  return { error: null, session: { user: user as { id: string; role?: string } }, userId: user.id!, permissions, groupLevel, groupName, staffId: dbUser.staffId };
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
