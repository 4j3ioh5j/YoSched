// Pure helpers for linking a login (User) to a Staff record. Kept separate
// from the API route so the link/unlink + conflict rules are unit-testable.

/** Normalize a staffId form value: "", whitespace, null/undefined → null
 *  (meaning "unlink"); otherwise the trimmed id. */
export function normalizeStaffId(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** A staff maps to at most one login. Linking to a staff already owned by
 *  a DIFFERENT user is a conflict; re-linking your own staff is a no-op (fine);
 *  unlinking (wanted=null) is always fine.
 *
 *  @param wantedStaffId   the staff this user wants to link (or null to unlink)
 *  @param currentOwnerUserId the userId already linked to that staff, or null if free
 *  @param editingUserId      the user being edited (null when creating a new user) */
export function isStaffLinkConflict({
  wantedStaffId,
  currentOwnerUserId,
  editingUserId,
}: {
  wantedStaffId: string | null;
  currentOwnerUserId: string | null;
  editingUserId: string | null;
}): boolean {
  if (!wantedStaffId) return false;
  if (!currentOwnerUserId) return false;
  return currentOwnerUserId !== editingUserId;
}
