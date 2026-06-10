// Shared shape + view helpers for the /users surface (the list route and the reset
// route). Kept here so both routes agree on what's selected, what's stripped before
// it reaches the client, and which rows are hidden.

import { hasUsersEdit } from "./user-admin-safety";

// Shape selected for every user row — includes the linked staff (with its active
// state, used to hide deactivated-staff logins) and passwordHash (used ONLY to
// derive `loginComplete`; never returned to the client).
export const USER_SELECT = {
  id: true, email: true, name: true, groupId: true, staffId: true, isActive: true, totpEnabled: true, createdAt: true,
  passwordHash: true,
  group: { select: { name: true, level: true, permissions: true } },
  staff: { select: { id: true, name: true, initials: true, isActive: true } },
} as const;

/** Strip passwordHash and add a derived `loginComplete` (has both email + password) —
 *  the activation gate the /users UI uses. The hash never leaves the server. */
export function toClientUser<T extends { email: string | null; passwordHash: string | null }>(u: T) {
  const { passwordHash, ...rest } = u;
  return { ...rest, loginComplete: !!u.email && !!passwordHash };
}

/** A staff-linked login whose staff member is INACTIVE is hidden from /users: the
 *  staff was deactivated and its login reset to a bare shell (it re-appears if the
 *  staff is reactivated). Effective administrators are never hidden — their logins
 *  are managed independently of staff active-state (the admin-skip in the staff
 *  lifecycle keeps them intact), so they must stay visible/manageable here. */
export function isHiddenStaffLogin(u: {
  isActive: boolean;
  group: { permissions: string[] } | null;
  staff: { isActive: boolean } | null;
}): boolean {
  if (!u.staff || u.staff.isActive) return false;
  const isAdmin = hasUsersEdit({ id: "", isActive: u.isActive, groupPermissions: u.group?.permissions ?? [] });
  return !isAdmin;
}
