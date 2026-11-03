// DB-bound chokepoint for the admin-safety invariant. Routes that can shrink the set
// of active administrators (users delete/update, group permission edit / delete) call
// assertUsersAdminSurvives BEFORE persisting; it throws AdminGuardError, which routes
// translate to HTTP 409. The set-counting logic is pure (src/lib/user-admin-safety.ts).
//
// Scope note: this governs only what affects the invariant — isActive / group /
// existence. Credential & security writes (password change, failed-attempt/lockout,
// TOTP) do NOT pass through here; they can't change who can administer.

import { prisma } from "./prisma";
import { detachAction, type DetachAction } from "./staff-login-link";
import {
  type AdminUser,
  leavesNoActiveAdmin,
  withUserRemoved,
  withUserPatched,
  withGroupPermissions,
} from "./user-admin-safety";

export class AdminGuardError extends Error {
  constructor(message = "This change would leave no active administrator who can manage users.") {
    super(message);
    this.name = "AdminGuardError";
  }
}

export type UsersAdminChange =
  | { kind: "deleteUser"; userId: string }
  | { kind: "updateUser"; userId: string; isActive?: boolean; groupId?: string }
  | { kind: "updateGroupPermissions"; groupId: string; permissions: string[] };

type RawUser = { id: string; isActive: boolean; groupId: string; group: { permissions: string[] } };

function toAdminUser(u: RawUser): AdminUser {
  return { id: u.id, isActive: u.isActive, groupPermissions: u.group.permissions };
}

/** Throw AdminGuardError if applying `change` would leave zero active administrators
 *  (active users with effective users:edit). Reads the current user snapshot, applies
 *  the change in-memory, and counts. */
export async function assertUsersAdminSurvives(change: UsersAdminChange): Promise<void> {
  const raw: RawUser[] = await prisma.user.findMany({
    select: { id: true, isActive: true, groupId: true, group: { select: { permissions: true } } },
  });
  const users = raw.map(toAdminUser);

  let after: AdminUser[];
  switch (change.kind) {
    case "deleteUser":
      after = withUserRemoved(users, change.userId);
      break;
    case "updateUser": {
      const patch: Partial<Pick<AdminUser, "isActive" | "groupPermissions">> = {};
      if (change.isActive !== undefined) patch.isActive = change.isActive;
      if (change.groupId !== undefined) {
        const g = await prisma.group.findUnique({ where: { id: change.groupId }, select: { permissions: true } });
        patch.groupPermissions = g?.permissions ?? [];
      }
      after = withUserPatched(users, change.userId, patch);
      break;
    }
    case "updateGroupPermissions": {
      const memberIds = new Set(raw.filter((u) => u.groupId === change.groupId).map((u) => u.id));
      after = withGroupPermissions(users, memberIds, change.permissions);
      break;
    }
  }

  if (leavesNoActiveAdmin(after)) throw new AdminGuardError();
}

// --- Staff-driven login side-effects ---
//
// Logins are created ON DEMAND (from /users, or the staff page's "Create login" link);
// staff are no longer given an automatic shell login. When a staff member is deactivated
// or deleted, or an admin unlinks a login, the link is removed by detachLoginForStaff:
// a never-completed shell (no email, no password) is deleted; any real login only has its
// staffId cleared — its credentials, active state, group, 2FA and saved views are kept.
// Neither branch can shrink the active-administrator set: detach changes no isActive or
// group, and a shell can never be active (activation requires email + password).

type TxClient = Pick<typeof prisma, "user" | "savedGraphView">;

/** Remove the link between a staff member and its login (Rules 2 + 4). Pass the caller's
 *  transaction client so the staff mutation and the login cleanup commit together.
 *  Returns what happened. */
export async function detachLoginForStaff(staffId: string, db: TxClient = prisma): Promise<DetachAction> {
  const login = await db.user.findUnique({
    where: { staffId },
    select: { id: true, email: true, passwordHash: true },
  });
  return applyDetach(login, db);
}

/** Unlink a specific login from its staff member (the /users "— none —" choice). Same
 *  semantics as detachLoginForStaff. */
export async function unlinkLogin(userId: string, db: TxClient = prisma): Promise<DetachAction> {
  const login = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, passwordHash: true, staffId: true },
  });
  if (!login || !login.staffId) return "none"; // already unlinked: nothing to do
  return applyDetach(login, db);
}

async function applyDetach(
  login: { id: string; email: string | null; passwordHash: string | null } | null,
  db: TxClient,
): Promise<DetachAction> {
  const action = detachAction(login);
  if (action === "delete") {
    await db.savedGraphView.deleteMany({ where: { ownerId: login!.id, isShared: false } });
    await db.user.delete({ where: { id: login!.id } });
  } else if (action === "detach") {
    await db.user.update({ where: { id: login!.id }, data: { staffId: null } });
  }
  return action;
}
