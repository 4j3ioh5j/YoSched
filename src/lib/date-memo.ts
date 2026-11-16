// Card #266 (speed): the engine asks the same few hundred ISO dates for their weekday, next or
// previous day millions of times per spacing trial. These caches return exactly what the plain
// Date math returns (same expression, computed once per string); each is bounded and starts
// over when full, so a long-lived server process never grows without limit.
const LIMIT = 50_000;

function memo<T>(fn: (iso: string) => T): (iso: string) => T {
  const cache = new Map<string, T>();
  return (iso: string): T => {
    const hit = cache.get(iso);
    if (hit !== undefined) return hit;
    const out = fn(iso);
    if (cache.size >= LIMIT) cache.clear();
    cache.set(iso, out);
    return out;
  };
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** new Date(iso + "T12:00:00").getDay(), cached per string. */
export const isoDow = memo((iso) => new Date(iso + "T12:00:00").getDay());
/** new Date(iso + "T12:00:00").getTime(), cached per string. */
export const isoNoonMs = memo((iso) => new Date(iso + "T12:00:00").getTime());
/** The next calendar day (local noon + 1 day), cached per string. */
export const isoNext = memo((iso) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return fmt(d);
});
/** The previous calendar day (local noon − 1 day), cached per string. */
export const isoPrev = memo((iso) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return fmt(d);
});
