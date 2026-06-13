// DB-bound chokepoint for the admin-safety invariant. Routes that can shrink the set
// of active administrators (users delete/update, group permission edit / delete) call
// assertUsersAdminSurvives BEFORE persisting; it throws AdminGuardError, which routes
// translate to HTTP 409. The set-counting logic is pure (src/lib/user-admin-safety.ts).
//
// Scope note: this governs only what affects the invariant — isActive / group /
// existence. Credential & security writes (password change, failed-attempt/lockout,
// TOTP) do NOT pass through here; they can't change who can administer.

import { prisma } from "./prisma";
import { needsStaffLogin } from "./staff-login-backfill";
import {
  type AdminUser,
  hasUsersEdit,
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

// --- Staff-driven login provisioning & side-effects (slice 2b) ---
//
// These let staff lifecycle (create / deactivate / hard-delete) manage the PAIRED login
// without ever touching an administrator's login — admin logins are managed only from
// /users. Because non-admin changes can't shrink the admin set, the admin-skip is itself
// the invariant protection here (no assertUsersAdminSurvives needed).

type LinkedLogin = { id: string; isActive: boolean; group: { permissions: string[] } | null };

async function findLinkedLogin(staffId: string): Promise<LinkedLogin | null> {
  return prisma.user.findUnique({
    where: { staffId },
    select: { id: true, isActive: true, group: { select: { permissions: true } } },
  });
}

function isAdminLogin(u: LinkedLogin): boolean {
  return hasUsersEdit({ id: u.id, isActive: u.isActive, groupPermissions: u.group?.permissions ?? [] });
}

/** Create the disabled, credential-less shell login that pairs with a newly created
 *  active staff member (Staff group; admin completes email+password + activates later).
 *  Accepts a transaction client so the caller can pair the login atomically with the
 *  staff insert (defaults to the shared `prisma` when run standalone). */
export async function provisionStaffLogin(
  staffId: string,
  name: string,
  db: Pick<typeof prisma, "user" | "group"> = prisma,
): Promise<void> {
  const staffGroup = await db.group.findUnique({ where: { name: "Staff" }, select: { id: true } });
  // Every user must belong to a group (groupId is NOT NULL) — refuse to provision rather
  // than create an orphaned login if the seeded "Staff" group is somehow missing.
  if (!staffGroup) throw new Error('Cannot provision a staff login: the "Staff" group is missing — run the seed.');
  await db.user.create({
    data: { staffId, name, email: null, passwordHash: null, isActive: false, groupId: staffGroup.id },
  });
}

/** Self-heal the "every active staff has a login" invariant for a single staff member.
 *  Eager provisioning only fires at staff CREATE and in the one-time backfill (which skips
 *  inactive staff), so a staff row that entered another way — imported/seeded directly, or
 *  inactive when the backfill ran and reactivated later — can be active with no paired
 *  login and (since the manual /users link field was removed) no way to get one. Called on
 *  the staff PUT path: if the staff is active and has no login, provision the disabled
 *  shell now so the admin can complete it from /users. No-op if inactive or already linked;
 *  idempotent. Does NOT enable the login — activation stays a deliberate /users action. */
export async function ensureStaffLogin(staffId: string): Promise<void> {
  const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { name: true, isActive: true } });
  if (!staff) return;
  const existing = await prisma.user.findUnique({ where: { staffId }, select: { id: true } });
  if (!needsStaffLogin(staff.isActive, existing !== null)) return;
  await provisionStaffLogin(staffId, staff.name);
}

/** Staff deactivated → RESET its linked login to a bare, disabled shell (disabled, no
 *  email, no password), but NEVER an administrator's. The row is kept; combined with the
 *  /users hide-filter (isHiddenStaffLogin) the login disappears from the list until the
 *  staff member is reactivated, at which point it re-surfaces as a "Needs setup" shell. */
export async function resetLoginForStaff(staffId: string): Promise<void> {
  const user = await findLinkedLogin(staffId);
  if (!user) return;
  if (isAdminLogin(user)) return; // admin logins are decoupled from staff active-state
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false, email: null, passwordHash: null } });
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
