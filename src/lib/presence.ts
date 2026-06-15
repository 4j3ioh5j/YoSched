// Presence is the passive "other editors are active" banner on the schedule page.
// It answers one question — "is another schedule editor logged in and active right
// now?" — and deliberately knows NOTHING about which page anyone is on. There is no
// conflict detection, no compare-and-swap, no cell locking here: presence never
// touches the assignment write path, so it cannot revert edits or lose data.
//
// "Active" is not "logged in": a JWT stays valid for hours after someone walks away,
// so we instead require a recent heartbeat. Each editor's client upserts its lastSeen
// on a short interval; this function decides who still counts by a freshness TTL. A
// closed tab stops heart-beating and silently ages out of the banner — no logout
// event and no cleanup job needed.

/** How recent a heartbeat must be to count an editor as active. Comfortably larger
 *  than the client heartbeat interval so a single missed ping (e.g. a throttled
 *  background tab, which browsers slow to ~1/min) never makes someone flicker out. */
export const PRESENCE_TTL_MS = 120_000; // 2 minutes

/** How often each editor's client sends a heartbeat. */
export const HEARTBEAT_INTERVAL_MS = 45_000; // 45 seconds

export type ActivityRow = {
  userId: string;
  name: string;
  permissions: string[];
  lastSeen: Date;
};

export type ActiveEditor = { id: string; name: string };

/**
 * The OTHER schedule editors who are currently active, for the banner shown to
 * `selfUserId`. Pure — all time and identity come in as arguments so it is trivially
 * testable. An editor counts when they: are not the viewer, hold `schedule:edit`, and
 * have a heartbeat within `ttlMs`. Result is sorted by name for a stable banner.
 *
 * Note the viewer is excluded but NOT required to be an editor themselves — the caller
 * (the route / the banner) decides whether to show a banner at all. The banner's
 * "2 or more editors" rule is simply: viewer is an editor AND this list is non-empty.
 */
export function activeEditors(
  rows: ActivityRow[],
  opts: { now: Date; selfUserId: string; ttlMs?: number }
): ActiveEditor[] {
  const ttlMs = opts.ttlMs ?? PRESENCE_TTL_MS;
  const cutoff = opts.now.getTime() - ttlMs;
  return rows
    .filter((r) => r.userId !== opts.selfUserId)
    .filter((r) => r.permissions.includes("schedule:edit"))
    .filter((r) => r.lastSeen.getTime() >= cutoff)
    .map((r) => ({ id: r.userId, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
