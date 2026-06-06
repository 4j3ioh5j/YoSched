// Pure helpers for linking a login (User) to a Provider record. Kept separate
// from the API route so the link/unlink + conflict rules are unit-testable.

/** Normalize a providerId form value: "", whitespace, null/undefined → null
 *  (meaning "unlink"); otherwise the trimmed id. */
export function normalizeProviderId(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** A provider maps to at most one login. Linking to a provider already owned by
 *  a DIFFERENT user is a conflict; re-linking your own provider is a no-op (fine);
 *  unlinking (wanted=null) is always fine.
 *
 *  @param wantedProviderId   the provider this user wants to link (or null to unlink)
 *  @param currentOwnerUserId the userId already linked to that provider, or null if free
 *  @param editingUserId      the user being edited (null when creating a new user) */
export function isProviderLinkConflict({
  wantedProviderId,
  currentOwnerUserId,
  editingUserId,
}: {
  wantedProviderId: string | null;
  currentOwnerUserId: string | null;
  editingUserId: string | null;
}): boolean {
  if (!wantedProviderId) return false;
  if (!currentOwnerUserId) return false;
  return currentOwnerUserId !== editingUserId;
}
