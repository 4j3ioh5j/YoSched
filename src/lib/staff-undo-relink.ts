// Card #223: the edit form's Undo of a deactivate is two steps — the PUT that re-activates the
// person, then (when the deactivation recorded a real login) the restore that links that login
// back. The re-activation is already saved when the restore runs, so a refused restore keeps it
// and only reports why the login could not be linked back.

export type RestoreOutcome<R> = { ok: true; row: R } | { ok: false; error: string };

export async function undoThenRelink<R>(
  put: () => Promise<R | null>,
  deactivationId: string | undefined | null,
  restore: (id: string) => Promise<RestoreOutcome<R>>,
): Promise<{ row: R; error: string | null } | null> {
  const row = await put();
  if (!row) return null;
  if (!deactivationId) return { row, error: null };
  const r = await restore(deactivationId);
  return r.ok ? { row: r.row, error: null } : { row, error: r.error };
}
