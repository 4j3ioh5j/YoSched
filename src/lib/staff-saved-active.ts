// Tracks each staff member's LAST SAVED active state on the staff page, separately from
// the draft being edited. The edit window's "Login" selector links immediately via
// /api/users, which refuses inactive staff, so it must key off what the server has —
// not the page-load props (stale after a save) and not an unsaved draft checkbox.

export type SavedActive = Readonly<Record<string, boolean>>;

export type SavedActiveEvent =
  | { kind: "saved"; id: string; isActive: boolean } // PUT /api/staff succeeded
  | { kind: "added"; id: string; isActive: boolean } // POST /api/staff succeeded
  | { kind: "deactivated"; id: string } // DELETE soft path
  | { kind: "removed"; id: string }; // DELETE hard path

export function initSavedActive(staff: { id: string; isActive: boolean }[]): SavedActive {
  return Object.fromEntries(staff.map((s) => [s.id, s.isActive]));
}

export function applySavedActive(state: SavedActive, e: SavedActiveEvent): SavedActive {
  switch (e.kind) {
    case "saved":
    case "added":
      return { ...state, [e.id]: e.isActive };
    case "deactivated":
      return { ...state, [e.id]: false };
    case "removed": {
      const next = { ...state };
      delete next[e.id];
      return next;
    }
  }
}

/** The Login selector can link only when the staff member is active on the server AND
 *  the draft hasn't unticked Active (saving that would unlink again). */
export function canLinkLogin(state: SavedActive, id: string, draftActive: boolean): boolean {
  return (state[id] ?? false) && draftActive;
}
