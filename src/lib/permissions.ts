// Authorization is entirely group-based. Every user belongs to a group (User.groupId is
// NOT NULL — enforced at the DB level), and a login's permissions and hierarchy level come
// from that group. Shared by getSession (live auth) and the admin-safety invariant so they
// can never diverge.

/** Effective permissions for a login — its group's stored permission array. Pure. */
export function effectivePermissions(group: { permissions: string[] }): string[] {
  return group.permissions;
}

/** RBAC hierarchy rule for the /users surface: an actor may assign or manage a group /
 *  user at OR BELOW their own group level — never one strictly above. So an admin
 *  (level 3) can create and manage other admins, while a Super User (2) still cannot
 *  touch admins. Single source of truth shared by the server routes and the UI so the
 *  two can't drift. Pure. */
export function canManageGroupLevel(actorLevel: number, targetLevel: number): boolean {
  return targetLevel <= actorLevel;
}
