// Card #70: the status changes of one approve/decline/reset batch, IN THE ORDER THEY HAPPENED —
// each explicit change, then the neighbours its cascade moved — so the grid's Undo can replay
// them newest-first (a co-approval before the approval that caused it, so the approval's
// stored inverse meets the grid it left) and Redo oldest-first.
export type StatusOp<S extends string> = { id: string; from: S; to: S };

export class StatusOpRecorder<S extends string> {
  private cur: Map<string, S>;
  readonly ops: StatusOp<S>[] = [];
  constructor(pre: ReadonlyMap<string, S>, private readonly fallback: S) {
    this.cur = new Map(pre);
  }
  /** One request moved to `to` (no-op when it already was). */
  record(id: string, to: S): void {
    const from = this.cur.get(id) ?? this.fallback;
    if (from === to) return;
    this.ops.push({ id, from, to });
    this.cur.set(id, to);
  }
}

/** Undo order: newest first. */
export function undoOrder<T>(ops: readonly T[]): T[] {
  return [...ops].reverse();
}
