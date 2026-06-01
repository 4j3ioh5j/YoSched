/**
 * Access rules for saved graph views. Kept pure so the owner-scoping logic is
 * unit-tested rather than buried in route handlers.
 *
 * Visibility model:
 *  - Shared views (isShared = true) are visible to everyone and managed by any
 *    user holding statistics:manage.
 *  - Private views (isShared = false) are visible to, and managed only by, their
 *    owner. A view whose owner was deleted keeps ownerId = null; private orphans
 *    are removed on user deletion so no invisible rows remain.
 */

export type ViewAccess = { isShared: boolean; ownerId: string | null };

/** Can this user SEE the view? (read visibility) */
export function canSeeView(view: ViewAccess, userId: string): boolean {
  return view.isShared || view.ownerId === userId;
}

/** Can this user EDIT/DELETE the view? (requires statistics:manage at the route) */
export function canManageView(view: ViewAccess, userId: string): boolean {
  return view.isShared || view.ownerId === userId;
}

/**
 * The ownerId a view should have after an update, given who is acting.
 *
 * A view that transitions from shared to private must be claimed by the acting
 * user. Otherwise a department-owned shared view (ownerId = null) would become
 * an invisible orphan, and another user's shared view would become private to
 * its original owner — locking out the manager who just made it private. In all
 * other cases ownership is left unchanged.
 *
 * @param nextIsShared the requested isShared value, or undefined if unchanged.
 */
export function nextOwnerId(
  existing: ViewAccess,
  nextIsShared: boolean | undefined,
  actorId: string,
): string | null {
  const becomingPrivate = nextIsShared === false && existing.isShared;
  return becomingPrivate ? actorId : existing.ownerId;
}
