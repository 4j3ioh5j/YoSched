// DB-bound chokepoint for the admin-safety invariant. Routes that can shrink the set
// of active administrators (users delete/update, group permission edit / delete) call
// assertUsersAdminSurvives BEFORE persisting; it throws AdminGuardError, which routes
// translate to HTTP 409. The set-counting logic is pure (src/lib/user-admin-safety.ts).
//
// Scope note: this governs only what affects the invariant — isActive / role / group /
// existence. Credential & security writes (password change, failed-attempt/lockout,
// TOTP) do NOT pass through here; they can't change who can administer.

import { prisma } from "./prisma";
import type { Role } from "./permissions";
import {
  type AdminUser,
  leavesNoActiveAdmin,
  withUserRemoved,
  withUserPatched,
  withGroupPermissions,
  withGroupRemoved,
} from "./user-admin-safety";

export class AdminGuardError extends Error {
  constructor(message = "This change would leave no active administrator who can manage users.") {
    super(message);
    this.name = "AdminGuardError";
  }
}

export type UsersAdminChange =
  | { kind: "deleteUser"; userId: string }
  | { kind: "updateUser"; userId: string; isActive?: boolean; role?: Role; groupId?: string | null }
  | { kind: "updateGroupPermissions"; groupId: string; permissions: string[] }
  | { kind: "deleteGroup"; groupId: string };

type RawUser = { id: string; isActive: boolean; role: string; groupId: string | null; group: { permissions: string[] } | null };

function toAdminUser(u: RawUser): AdminUser {
  return { id: u.id, isActive: u.isActive, role: u.role as Role, groupPermissions: u.group?.permissions ?? null };
}

/** Throw AdminGuardError if applying `change` would leave zero active administrators
 *  (active users with effective users:edit). Reads the current user snapshot, applies
 *  the change in-memory, and counts. */
export async function assertUsersAdminSurvives(change: UsersAdminChange): Promise<void> {
  const raw: RawUser[] = await prisma.user.findMany({
    select: { id: true, isActive: true, role: true, groupId: true, group: { select: { permissions: true } } },
  });
  const users = raw.map(toAdminUser);

  let after: AdminUser[];
  switch (change.kind) {
    case "deleteUser":
      after = withUserRemoved(users, change.userId);
      break;
    case "updateUser": {
      const patch: Partial<Pick<AdminUser, "isActive" | "role" | "groupPermissions">> = {};
      if (change.isActive !== undefined) patch.isActive = change.isActive;
      if (change.role !== undefined) patch.role = change.role;
      if (change.groupId !== undefined) {
        if (change.groupId === null) {
          patch.groupPermissions = null; // ungrouped → role default
        } else {
          const g = await prisma.group.findUnique({ where: { id: change.groupId }, select: { permissions: true } });
          patch.groupPermissions = g?.permissions ?? null;
        }
      }
      after = withUserPatched(users, change.userId, patch);
      break;
    }
    case "updateGroupPermissions": {
      const memberIds = new Set(raw.filter((u) => u.groupId === change.groupId).map((u) => u.id));
      after = withGroupPermissions(users, memberIds, change.permissions);
      break;
    }
    case "deleteGroup": {
      const memberIds = new Set(raw.filter((u) => u.groupId === change.groupId).map((u) => u.id));
      after = withGroupRemoved(users, memberIds);
      break;
    }
  }

  if (leavesNoActiveAdmin(after)) throw new AdminGuardError();
}
