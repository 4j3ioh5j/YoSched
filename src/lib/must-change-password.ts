// Forced password change at first sign-in (after an admin set or generated the password).
// Pure rules; enforcement lives in the middleware (pages, from the JWT), getSession (APIs and
// page loaders, from the DB — authoritative, so a stale or forged token can't skip it) and
// the password route (clears the flag).

export const ACCOUNT_PATH = "/account";
export const MUST_CHANGE_QUERY = "mustChange";

/** Middleware: should this PAGE request be redirected to /account to change the password?
 *  `path` is basePath-relative. APIs are never redirected (they get a JSON 403 from
 *  getSession instead), nor are /account itself, /login and the public pages, nor Next's
 *  internal assets. */
export function shouldRedirectToPasswordChange(path: string, mustChangePassword: boolean, publicPaths: ReadonlySet<string>): boolean {
  if (!mustChangePassword) return false;
  if (path === "/api" || path.startsWith("/api/")) return false;
  if (path.startsWith("/_next/")) return false;
  if (path === ACCOUNT_PATH || path.startsWith(ACCOUNT_PATH + "/")) return false;
  if (publicPaths.has(path)) return path === "/"; // "/" is the app home for a signed-in user
  return true;
}

/** Who sets the flag when a password is written through /api/users: a password an admin
 *  sets for SOMEONE ELSE must be replaced by that person; your own password never is. */
export function mustChangeAfterAdminSet(targetUserId: string | null, callerUserId: string): boolean {
  return targetUserId !== callerUserId;
}
