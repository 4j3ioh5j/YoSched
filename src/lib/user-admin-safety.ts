// Pure primitives for the "never lock out all administrators" invariant.
//
// An *administrator* is any ACTIVE user whose group grants `users:edit`. This is
// permission-based, NOT role-string-based: it's purely a function of the user's group's
// permission array (every user belongs to a group — User.groupId is NOT NULL). The system
// must always retain at least one such user, across every mutation that can shrink the set:
// user delete/disable/group changes AND group permission edits.
//
// These functions are pure so the rule is unit-tested; the DB-bound guard that fetches
// the snapshot and applies a concrete change lives in src/lib/user-lifecycle.ts.

export const ADMIN_PERMISSION = "users:edit";

export type AdminUser = {
  id: string;
  isActive: boolean;
  /** The user's group's permissions (every user has a group). */
  groupPermissions: string[];
};

export function hasUsersEdit(u: AdminUser): boolean {
  return u.groupPermissions.includes(ADMIN_PERMISSION);
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
  patch: Partial<Pick<AdminUser, "isActive" | "groupPermissions">>,
): AdminUser[] {
  return users.map((u) => (u.id === userId ? { ...u, ...patch } : u));
}

/** A group's permissions changed: every member now resolves through the new array. */
export function withGroupPermissions(users: AdminUser[], memberIds: Set<string>, permissions: string[]): AdminUser[] {
  return users.map((u) => (memberIds.has(u.id) ? { ...u, groupPermissions: permissions } : u));
}
