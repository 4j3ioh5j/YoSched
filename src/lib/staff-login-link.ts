// Pure rules for linking logins (User) to staff members (Staff.loginUser / User.staffId).
//
// A staff member may have a login, a login may have a staff member, neither is required
// (User.staffId is optional + unique, so 0..1 both ways). Admins/Super Users (users:edit)
// link, unlink and change the link from /users and the staff edit window. Logins are
// created on demand — staff are no longer given an empty "shell" login automatically.
//
// Kept DB-free so every decision is unit-tested; the routes do the I/O.

export type LoginCredentials = { email: string | null; passwordHash: string | null };

/** A never-completed login: no email AND no password. Such a login can't sign in and
 *  can't be activated (activation requires both), so it is safe to delete outright. A
 *  login with EITHER credential belongs to a real person and is never deleted by the
 *  link/lifecycle paths. */
export function isShellLogin(u: LoginCredentials): boolean {
  return !u.email && !u.passwordHash;
}

export type DetachAction = "none" | "delete" | "detach";

/** What happens to a staff member's linked login when the link is removed — by an admin
 *  unlinking it, or by the staff member being deactivated or deleted:
 *   - no linked login     → "none"
 *   - never-completed shell → "delete" (nobody's account; leaving it would orphan it)
 *   - anything else       → "detach": clear staffId ONLY — credentials, active state,
 *     group, 2FA and saved views are kept (the person's account survives; administrators
 *     included). */
export function detachAction(login: LoginCredentials | null): DetachAction {
  if (!login) return "none";
  return isShellLogin(login) ? "delete" : "detach";
}

/** Parse the `staffId` field of a /api/users request body:
 *   - absent (undefined) → leave the link unchanged
 *   - null or ""         → unlink
 *   - non-empty string   → link to that staff id
 *   - anything else      → invalid */
export type StaffIdField = { kind: "unchanged" } | { kind: "unlink" } | { kind: "link"; staffId: string } | { kind: "invalid" };

export function parseStaffIdField(value: unknown): StaffIdField {
  if (value === undefined) return { kind: "unchanged" };
  if (value === null || value === "") return { kind: "unlink" };
  if (typeof value === "string" && value.trim() !== "") return { kind: "link", staffId: value.trim() };
  return { kind: "invalid" };
}

export type LinkTargetStaff = { id: string; initials: string; isActive: boolean };
export type LinkHolder = { id: string; name: string };

export type LinkCheck = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };

/** Validate linking login `userId` (null when creating a new login) to `staff`, given the
 *  login that currently holds that staff member (if any). Rule 1: never MOVE a link —
 *  if another login holds the staff member, refuse and say which one. */
export function checkLinkTarget(staff: LinkTargetStaff | null, holder: LinkHolder | null, userId: string | null): LinkCheck {
  if (!staff) return { ok: false, status: 404, error: "Staff member not found" };
  if (!staff.isActive) return { ok: false, status: 400, error: `${staff.initials} is inactive and can't be linked to a login` };
  if (holder && holder.id !== userId) return { ok: false, status: 409, error: linkTakenMessage(staff.initials, holder.name) };
  return { ok: true };
}

export function linkTakenMessage(initials: string, holderName: string): string {
  return `${initials} is already linked to ${holderName}. Unlink it there first.`;
}

/** True only for a unique-constraint violation on users.staffId (Prisma P2002). Email
 *  collisions are a different P2002 and must keep their own message. */
export function isStaffIdUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: unknown; meta?: unknown };
  if (err.code !== "P2002" || !err.meta) return false;
  // Classic engines put the columns in meta.target; Prisma 7 driver adapters nest them
  // (meta.driverAdapterError.cause.constraint.{fields|index}). Search the whole meta.
  let text: string;
  try {
    text = JSON.stringify(err.meta);
  } catch {
    return false;
  }
  return /staff_?id/i.test(text);
}

export type LinkOptionStaff = { id: string; name: string; initials: string; isActive: boolean };
export type LinkOption = { id: string; label: string };

/** Options for a login's "Linked staff" dropdown: active staff who have no login, plus the
 *  login's own current staff member (shown even if inactive, so the form never silently
 *  drops it). `takenStaffIds` = staff ids already linked to ANY login. Sorted by initials. */
export function linkOptionsForLogin(staff: LinkOptionStaff[], takenStaffIds: Set<string>, currentStaffId: string | null): LinkOption[] {
  return staff
    .filter((s) => s.id === currentStaffId || (s.isActive && !takenStaffIds.has(s.id)))
    .sort((a, b) => a.initials.localeCompare(b.initials))
    .map((s) => ({ id: s.id, label: `${s.initials} — ${s.name}${s.isActive ? "" : " (inactive)"}` }));
}

export type LinkOptionLogin = { id: string; name: string; email: string | null; staffId: string | null };

/** Options for a staff member's "Login" dropdown (staff edit window): logins with no staff
 *  link, plus the staff member's own current login. Sorted by name. */
export function loginOptionsForStaff(logins: LinkOptionLogin[], staffId: string): LinkOption[] {
  return logins
    .filter((u) => u.staffId === null || u.staffId === staffId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ id: u.id, label: u.email ? `${u.name} (${u.email})` : `${u.name} (no email yet)` }));
}
