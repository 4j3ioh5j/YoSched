import { auth } from "./auth";
import { prisma } from "./prisma";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { ACCOUNT_PATH, MUST_CHANGE_QUERY } from "./must-change-password";
import { effectivePermissions } from "./permissions";

export type Permission =
  | "schedule:view" | "schedule:edit" | "schedule:auto"
  | "requests:self" | "requests:view"
  | "staff:view" | "staff:edit"
  | "statistics:view" | "statistics:manage"
  | "settings:view" | "settings:edit" | "settings:autogen-priority"
  | "users:view" | "users:edit"
  | "groups:view" | "groups:edit"
  | "manual:view";

type SessionOk = {
  error: null;
  session: { user: { id: string; email?: string | null; name?: string | null } };
  userId: string;
  permissions: string[];
  groupLevel: number;
  groupName: string;
  staffId: string | null; // linked Staff record, if any (self-service requests)
  mustChangePassword?: undefined;
};

type SessionErr = {
  error: NextResponse;
  session: null;
  /** Signed in, but must replace an admin-set password first (see getPageSession). */
  mustChangePassword?: true;
  userId?: undefined;
  permissions?: undefined;
  groupLevel?: undefined;
  groupName?: undefined;
  staffId?: undefined;
};

type SessionResult = SessionOk | SessionErr;

export type SessionOptions = {
  /** Let a person whose password must be changed through — ONLY for what /account needs to
   *  do that (the password route, its 2FA calls). Everything else gets a JSON 403. */
  allowPendingPasswordChange?: boolean;
};

export async function getSession(required?: Permission | Permission[], opts: SessionOptions = {}): Promise<SessionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true, staffId: true, mustChangePassword: true, group: { select: { permissions: true, level: true, name: true } } },
  });

  if (!dbUser || !dbUser.isActive) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }

  // Forced password change: read from the DB on every call, so it holds even when the
  // session token predates the flag (an admin generated a password while they were signed
  // in) or was tampered with. Pages are redirected by getPageSession / the middleware.
  if (dbUser.mustChangePassword && !opts.allowPendingPasswordChange) {
    return {
      error: NextResponse.json({ error: "You must change your password before continuing", mustChangePassword: true }, { status: 403 }),
      session: null,
      mustChangePassword: true,
    };
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

/** getSession for server-rendered PAGES: a pending password change redirects to /account
 *  (the database decides, so this also catches a session token that doesn't know yet).
 *  Any other error is returned for the page to handle as before. */
export async function getPageSession(required?: Permission | Permission[]): Promise<SessionResult> {
  const result = await getSession(required);
  if (result.error && result.mustChangePassword) redirect(`${ACCOUNT_PATH}?${MUST_CHANGE_QUERY}=1`);
  return result;
}
