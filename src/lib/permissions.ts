// Single source of truth for resolving a user's EFFECTIVE permissions, shared by
// getSession (live auth) and the admin-safety invariant so they can never diverge.
//
// Resolution rule (mirrors the original inline logic in auth-guard): a user with a
// group uses that group's `permissions`; a user with no group falls back to a
// role default. admin and manager share the same full permission set (they differ
// only in group level); viewer gets read-only.

export type Role = "admin" | "manager" | "viewer";

/** Full permission set granted to ungrouped admin/manager logins (fallback only). */
export const FULL_PERMISSIONS: string[] = [
  "schedule:view", "schedule:edit", "schedule:auto",
  "staff:view", "staff:edit",
  "statistics:view", "statistics:manage",
  "settings:view", "settings:edit",
  "users:view", "users:edit",
  "groups:view", "groups:edit",
];

/** Read-only set granted to ungrouped viewer logins (fallback only). */
export const VIEWER_PERMISSIONS: string[] = ["schedule:view", "statistics:view", "settings:view"];

/** Effective permissions for a login. `group` wins when present (its stored
 *  permissions array); otherwise the role default. Pure. */
export function effectivePermissions(role: Role, group: { permissions: string[] } | null | undefined): string[] {
  if (group) return group.permissions;
  if (role === "admin" || role === "manager") return FULL_PERMISSIONS;
  return VIEWER_PERMISSIONS;
}

/** A login's effective hierarchy level. A grouped login uses its group's `level`;
 *  an ungrouped login falls back by role (admin → 3, manager → 2, else 0). MUST mirror
 *  getSession's groupLevel resolution exactly — used both for the acting user (there)
 *  and for the TARGET user in the /users level guards, so an ungrouped admin/manager
 *  target can't slip past a guard that only inspected `group`. Pure. */
export function effectiveGroupLevel(role: Role, group: { level: number } | null | undefined): number {
  if (group) return group.level;
  if (role === "admin") return 3;
  if (role === "manager") return 2;
  return 0;
}

/** RBAC hierarchy rule for the /users surface: an actor may assign or manage a group /
 *  user at OR BELOW their own group level — never one strictly above. So an admin
 *  (level 3) can create and manage other admins, while a Super User (2) still cannot
 *  touch admins. Single source of truth shared by the server routes and the UI so the
 *  two can't drift. Pure. */
export function canManageGroupLevel(actorLevel: number, targetLevel: number): boolean {
  return targetLevel <= actorLevel;
}
