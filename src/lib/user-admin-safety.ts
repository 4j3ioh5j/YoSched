// Pure primitives for the "never lock out all administrators" invariant.
//
// An *administrator* is any ACTIVE user whose EFFECTIVE permissions include
// `users:edit` (resolved via src/lib/permissions.ts — group wins, else role default).
// This is permission-based, NOT role-string-based: a manager, or a viewer-role user in
// an admin-permissioned group, both count; an admin-role user whose group lacks
// users:edit does NOT. The system must always retain at least one such user, across
// every mutation that can shrink the set: user delete/disable/role/group changes AND
// group permission edits / group deletion.
//
// These functions are pure so the rule is unit-tested; the DB-bound guard that fetches
// the snapshot and applies a concrete change lives in src/lib/user-lifecycle.ts.

import { effectivePermissions, type Role } from "./permissions";

export const ADMIN_PERMISSION = "users:edit";

export type AdminUser = {
  id: string;
  isActive: boolean;
  role: Role;
  /** The user's group's permissions, or null when the user has no group (→ role default). */
  groupPermissions: string[] | null;
};

export function hasUsersEdit(u: AdminUser): boolean {
  const group = u.groupPermissions == null ? null : { permissions: u.groupPermissions };
  return effectivePermissions(u.role, group).includes(ADMIN_PERMISSION);
}

/** Number of active users who can administer (effective users:edit). */
export function activeAdminCount(users: AdminUser[]): number {
  return users.filter((u) => u.isActive && hasUsersEdit(u)).length;
}

/** Would the post-change snapshot leave nobody able to administer? */
export function leavesNoActiveAdmin(after: AdminUser[]): boolean {
  return activeAdminCount(after) === 0;
}

// --- in-memory simulations of each mutation (return a new snapshot) ---

export function withUserRemoved(users: AdminUser[], userId: string): AdminUser[] {
  return users.filter((u) => u.id !== userId);
}

export function withUserPatched(
  users: AdminUser[],
  userId: string,
  patch: Partial<Pick<AdminUser, "isActive" | "role" | "groupPermissions">>,
): AdminUser[] {
  return users.map((u) => (u.id === userId ? { ...u, ...patch } : u));
}

/** A group's permissions changed: every member now resolves through the new array. */
export function withGroupPermissions(users: AdminUser[], memberIds: Set<string>, permissions: string[]): AdminUser[] {
  return users.map((u) => (memberIds.has(u.id) ? { ...u, groupPermissions: permissions } : u));
}

/** A group was deleted: its members fall back to the role default (groupPermissions = null). */
export function withGroupRemoved(users: AdminUser[], memberIds: Set<string>): AdminUser[] {
  return users.map((u) => (memberIds.has(u.id) ? { ...u, groupPermissions: null } : u));
}
