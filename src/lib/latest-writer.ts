// Card #214: one save at a time per field, and only the newest choice counts.
// A write requested while another for the same key is in flight is queued (only the latest
// queued value is kept); when the in-flight one settles, the queued one is sent. So writes
// reach the server in the order the user made them, and the server ends on the last choice.
// `onSettled` reports only for the newest requested value of that key — a late result
// (success or failure) of an older write never changes what the page shows.

export type LatestWriter<K extends string, V> = {
  write(key: K, value: V): void;
  /** True while a write for this key is in flight or queued. */
  busy(key: K): boolean;
};

export function createLatestWriter<K extends string, V>(
  send: (key: K, value: V) => Promise<void>,
  onSettled: (key: K, value: V, error: unknown | null) => void,
): LatestWriter<K, V> {
  const inFlight = new Set<K>();
  const queued = new Map<K, V>();
  const latest = new Map<K, { value: V; seq: number }>();
  let seq = 0;

  function run(key: K, value: V, mySeq: number): void {
    inFlight.add(key);
    send(key, value).then(
      () => settle(key, value, mySeq, null),
      (e: unknown) => settle(key, value, mySeq, e ?? new Error("save failed")),
    );
  }

  function settle(key: K, value: V, mySeq: number, error: unknown | null): void {
    inFlight.delete(key);
    const next = queued.get(key);
    if (next !== undefined || queued.has(key)) {
      queued.delete(key);
      run(key, next as V, latest.get(key)!.seq);
      return; // a newer choice is on its way; this one's result is stale
    }
    if (latest.get(key)?.seq === mySeq) onSettled(key, value, error);
  }

  return {
    write(key, value) {
      const mySeq = ++seq;
      latest.set(key, { value, seq: mySeq });
      if (inFlight.has(key)) { queued.set(key, value); return; }
      run(key, value, mySeq);
    },
    busy(key) { return inFlight.has(key) || queued.has(key); },
  };
}
