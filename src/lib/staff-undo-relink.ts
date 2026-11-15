// Card #223: the edit form's Undo of a deactivate is two steps — the PUT that re-activates the
// person, then (when the deactivation recorded a real login) the restore that links that login
// back. The re-activation is already saved when the restore runs, so a refused restore keeps it
// and only reports why the login could not be linked back.
// Card #231: on a refused restore the server left the login unlinked, but the PUT's row is built
// from the old row (its login included), so `unlinked` clears the login on the row the page keeps,
// and `relinked` says whether the page may link the login back in its own list.

export type RestoreOutcome<R> = { ok: true; row: R } | { ok: false; error: string };

export async function undoThenRelink<R>(
  put: () => Promise<R | null>,
  deactivationId: string | undefined | null,
  restore: (id: string) => Promise<RestoreOutcome<R>>,
  unlinked: (row: R) => R = (row) => row,
): Promise<{ row: R; error: string | null; relinked: boolean } | null> {
  const row = await put();
  if (!row) return null;
  if (!deactivationId) return { row, error: null, relinked: false };
  const r = await restore(deactivationId);
  return r.ok ? { row: r.row, error: null, relinked: true } : { row: unlinked(row), error: r.error, relinked: false };
}
