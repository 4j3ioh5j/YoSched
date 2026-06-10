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
