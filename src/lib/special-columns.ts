/**
 * Card #300: one admin-set order across the schedule's "special" columns — the printed
 * aggregate columns (PrintAggregateColumn), the dedicated shift columns (ShiftType with
 * dedicatedColumn) and the count columns (CountColumn). Stored on
 * SchedulingPreferences.specialColumnOrder as a list of "<kind>:<id>" keys.
 *
 * A null/empty order is exactly the built-in layout: aggregate → dedicated → count, each
 * group in its own order. Keys that name no current column (deleted, or the wrong kind)
 * are ignored; columns the order does not name follow the named ones in the built-in
 * order, so a newly added column shows up last.
 *
 * Kept DB/React-free so it is unit-testable in isolation.
 */

export type SpecialColumnKind = "agg" | "ded" | "count";

export type OrderedSpecialColumn<A, D, C> =
  | { kind: "agg"; key: string; col: A }
  | { kind: "ded"; key: string; col: D }
  | { kind: "count"; key: string; col: C };

export const SPECIAL_COLUMN_ORDER_MAX = 500;
const KEY_RE = /^(agg|ded|count):[A-Za-z0-9_-]{1,64}$/;

export function specialColumnKey(kind: SpecialColumnKind, id: string): string {
  return `${kind}:${id}`;
}

export function orderSpecialColumns<A extends { id: string }, D extends { id: string }, C extends { id: string }>(
  groups: { agg: readonly A[]; ded: readonly D[]; count: readonly C[] },
  order: readonly string[] | null | undefined,
): OrderedSpecialColumn<A, D, C>[] {
  const builtIn: OrderedSpecialColumn<A, D, C>[] = [
    ...groups.agg.map((col) => ({ kind: "agg" as const, key: specialColumnKey("agg", col.id), col })),
    ...groups.ded.map((col) => ({ kind: "ded" as const, key: specialColumnKey("ded", col.id), col })),
    ...groups.count.map((col) => ({ kind: "count" as const, key: specialColumnKey("count", col.id), col })),
  ];
  if (!order || order.length === 0) return builtIn;
  const byKey = new Map(builtIn.map((x) => [x.key, x]));
  const placed = new Set<string>();
  const out: OrderedSpecialColumn<A, D, C>[] = [];
  for (const key of order) {
    const item = byKey.get(key);
    if (!item || placed.has(key)) continue;
    placed.add(key);
    out.push(item);
  }
  for (const item of builtIn) if (!placed.has(item.key)) out.push(item);
  return out;
}

/** Strict check for a write: a list of at most 500 distinct "<kind>:<id>" keys. */
export function validateSpecialColumnOrder(value: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "specialColumnOrder must be an array of column keys" };
  if (value.length > SPECIAL_COLUMN_ORDER_MAX) return { ok: false, error: `specialColumnOrder has more than ${SPECIAL_COLUMN_ORDER_MAX} entries` };
  const seen = new Set<string>();
  for (const k of value) {
    if (typeof k !== "string" || !KEY_RE.test(k)) return { ok: false, error: "specialColumnOrder entries must look like agg:<id>, ded:<id> or count:<id>" };
    if (seen.has(k)) return { ok: false, error: `specialColumnOrder lists ${k} twice` };
    seen.add(k);
  }
  return { ok: true, value: [...value] as string[] };
}

/** Lenient read of the stored value: the key list, or null (built-in order). */
export function parseSpecialColumnOrder(value: unknown): string[] | null {
  const v = validateSpecialColumnOrder(value);
  return v.ok ? v.value : null;
}

/**
 * For a replace-the-list writer that keeps row ids: which body rows keep their id (it is
 * a string AND names an existing row) and which existing rows go. An id that names no
 * existing row is never written — that row is created with a fresh id. The same id twice
 * is refused. A body with no ids (an older tab) recreates every row, as before.
 */
export function planKeepIds(
  existingIds: ReadonlySet<string>,
  bodyIds: readonly unknown[],
): { ok: true; keep: (string | null)[]; deleteIds: string[] } | { ok: false; error: string } {
  const seen = new Set<string>();
  const keep: (string | null)[] = [];
  for (const id of bodyIds) {
    if (typeof id !== "string" || !id) { keep.push(null); continue; }
    if (seen.has(id)) return { ok: false, error: `column id ${id} is listed twice` };
    seen.add(id);
    keep.push(existingIds.has(id) ? id : null);
  }
  const kept = new Set(keep.filter((x): x is string => x !== null));
  return { ok: true, keep, deleteIds: [...existingIds].filter((id) => !kept.has(id)) };
}
