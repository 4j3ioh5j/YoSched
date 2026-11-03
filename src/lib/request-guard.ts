// Binds an async result to the UI context that started it. Every time the context changes
// (a form closes, or switches to another record) call `invalidate()`; a response is applied
// only if `isCurrent(ticket)` — i.e. nothing changed since `begin()` and no newer request
// started. Used so a late "Generate password" response can never land in another user's form.

export type RequestTicket = { readonly epoch: number; readonly seq: number; readonly key: string | null };

export function createRequestGuard() {
  let epoch = 0;
  let seq = 0;
  let key: string | null = null;
  return {
    /** Context changed (form closed / opened for another record). */
    invalidate(nextKey: string | null = null) {
      epoch++;
      key = nextKey;
    },
    begin(): RequestTicket {
      seq++;
      return { epoch, seq, key };
    },
    isCurrent(t: RequestTicket): boolean {
      return t.epoch === epoch && t.seq === seq && t.key === key;
    },
  };
}
