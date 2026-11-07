// Card #78: client-side bookkeeping for the shift turn-on panel. Client-safe.
//
// Saving from the panel is several requests: the activation (who gets the shift, compare-and-set
// on a version), then the shift's follow rules and required follower. If the activation commits
// and a later request fails, the panel's version is spent; sending the activation again would be
// refused as stale. A retry must skip it and redo only the remaining requests.

export type CommittedActivation = { shiftId: string; version: string } | null;

/** True when this exact panel choice (shift + version it was made against) is already saved. */
export function activationAlreadyCommitted(committed: CommittedActivation, shiftId: string, version: string | undefined): boolean {
  return !!committed && version !== undefined && committed.shiftId === shiftId && committed.version === version;
}
