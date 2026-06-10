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
  hasUsersEdit,
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

// --- Staff-driven login provisioning & side-effects (slice 2b) ---
//
// These let staff lifecycle (create / deactivate / hard-delete) manage the PAIRED login
// without ever touching an administrator's login — admin logins are managed only from
// /users. Because non-admin changes can't shrink the admin set, the admin-skip is itself
// the invariant protection here (no assertUsersAdminSurvives needed).

type LinkedLogin = { id: string; isActive: boolean; role: string; group: { permissions: string[] } | null };

async function findLinkedLogin(staffId: string): Promise<LinkedLogin | null> {
  return prisma.user.findUnique({
    where: { staffId },
    select: { id: true, isActive: true, role: true, group: { select: { permissions: true } } },
  });
}

function isAdminLogin(u: LinkedLogin): boolean {
  return hasUsersEdit({ id: u.id, isActive: u.isActive, role: u.role as Role, groupPermissions: u.group?.permissions ?? null });
}

/** Create the disabled, credential-less shell login that pairs with a newly created
 *  active staff member (Staff group; admin completes email+password + activates later). */
export async function provisionStaffLogin(staffId: string, name: string): Promise<void> {
  const staffGroup = await prisma.group.findUnique({ where: { name: "Staff" }, select: { id: true } });
  await prisma.user.create({
    data: { staffId, name, email: null, passwordHash: null, isActive: false, role: "viewer", groupId: staffGroup?.id ?? null },
  });
}

/** Staff deactivated → disable its linked login, but NEVER an administrator's. */
export async function disableLoginForStaff(staffId: string): Promise<void> {
  const user = await findLinkedLogin(staffId);
  if (!user || !user.isActive) return;
  if (isAdminLogin(user)) return; // admin logins are decoupled from staff active-state
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
}

/** Staff hard-deleted → delete its linked shell login, but leave an administrator's
 *  intact (the staff delete will null out the link via onDelete: SetNull). Reuses the
 *  /users deletion cleanup for the user's private saved graph views. */
export async function deleteLoginForStaff(staffId: string): Promise<void> {
  const user = await findLinkedLogin(staffId);
  if (!user) return;
  if (isAdminLogin(user)) return;
  await prisma.savedGraphView.deleteMany({ where: { ownerId: user.id, isShared: false } });
  await prisma.user.delete({ where: { id: user.id } });
}
