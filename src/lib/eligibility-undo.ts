// Card #75 (Codex #385): Undo of a Staff / employment-type save reverses ONLY what that save
// changed in the eligibility list. Client-safe (no server imports).
//
// A save sends (list, base) and the server applies the user's diff on top of what is stored, so
// the stored list after the save can also hold changes made elsewhere (a shift turned on in
// Settings). Undo therefore must not send "the old list": it sends the list after the save with
// exactly the save's own additions taken out and its removals put back, against that list as base.

export type ListApplied = { add: string[]; remove: string[] };

const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** The diff the server says it applied; for a server that doesn't say (rollback), the user's own
 *  diff limited to what the saved list shows. */
export function appliedDiff(reported: unknown, sent: readonly string[], base: readonly string[], after: readonly string[]): ListApplied {
  const r = reported as Partial<ListApplied> | null | undefined;
  if (r && isIds(r.add) && isIds(r.remove)) return { add: [...r.add], remove: [...r.remove] };
  const s = new Set(sent), b = new Set(base), a = new Set(after);
  return {
    add: sent.filter((id) => !b.has(id) && a.has(id)),
    remove: base.filter((id) => !s.has(id) && !a.has(id)),
  };
}

/** What an Undo sends: `list` against `base` (= the list after the save). */
export function undoList(after: readonly string[], applied: ListApplied): { list: string[]; base: string[] } {
  const add = new Set(applied.add);
  const list = after.filter((id) => !add.has(id));
  for (const id of applied.remove) if (!list.includes(id)) list.push(id);
  return { list, base: [...after] };
}
