// Card #25: the last SAVED version of each Staff-page row. Cancel, a failed save and Undo
// restore from here, never from the page-load props: after a save, Cancel in the same visit
// must go back to what was just saved, not to what the page first loaded.
export class SavedRows<T extends { id: string }> {
  private rows: Map<string, T>;
  constructor(initial: readonly T[]) {
    this.rows = new Map(initial.map((r) => [r.id, r] as const));
  }
  /** The last saved version, or undefined for a row never saved. */
  get(id: string): T | undefined {
    return this.rows.get(id);
  }
  /** A save (or an Undo's write, or an add) succeeded with this row. */
  remember(row: T): void {
    this.rows.set(row.id, row);
  }
  /** The row is gone on the server. */
  forget(id: string): void {
    this.rows.delete(id);
  }
}
