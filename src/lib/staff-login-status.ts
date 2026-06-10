// Derives the login-setup status shown (read-only) on the /staff page from a staff
// member's linked login. Pure + tested. The actual setup/activation happens on /users.
//
// The three authentication gates are: (1) email set, (2) password set, (3) admin has
// enabled the account. This status reports how far along those gates a login is.

export type StaffLoginInfo = { isActive: boolean; email: string | null; passwordHash: string | null } | null;

export type StaffLoginStatus = "none" | "needs_setup" | "disabled" | "active";

export function staffLoginStatus(login: StaffLoginInfo): StaffLoginStatus {
  if (!login) return "none";
  if (!login.email || !login.passwordHash) return "needs_setup";
  return login.isActive ? "active" : "disabled";
}

export const STAFF_LOGIN_STATUS_LABEL: Record<StaffLoginStatus, string> = {
  none: "No login",
  needs_setup: "Needs email + password",
  disabled: "Disabled",
  active: "Active",
};
