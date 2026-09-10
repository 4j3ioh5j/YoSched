/**
 * Staff column ordering — pure helpers deciding the left-to-right order of staff
 * columns on the schedule (on-screen grid AND print, which share one staff array).
 *
 * The order is a stack of criteria applied in sequence (first criterion is the
 * primary sort; later ones break ties within each group). The stack is admin-
 * configurable and persisted as SchedulingPreferences.staffColumnOrder (JSON,
 * null = DEFAULT_STAFF_ORDER). "manual" is special: it is only ever valid as the
 * SOLE criterion (all-manual mode driven by Staff.sortOrder), never stacked.
 *
 * Kept DB/React-free so it is unit-testable in isolation and safe to call from
 * server components and API routes alike.
 */

export const STAFF_ORDER_KEYS = [
  "employmentType",
  "ftePercentage",
  "alphabetical",
  "initials",
  "autoScheduled",
  "seniority",
  "manual",
] as const;

export type StaffOrderKey = (typeof STAFF_ORDER_KEYS)[number];
export type StaffOrderDir = "asc" | "desc";
export type StaffOrderCriterion = { key: StaffOrderKey; dir?: StaffOrderDir };

/** FTE group before Fee Basis, highest FTE% first, then alphabetical. */
export const DEFAULT_STAFF_ORDER: StaffOrderCriterion[] = [
  { key: "employmentType" },
  { key: "ftePercentage", dir: "desc" },
  { key: "alphabetical" },
];

/** Direction each criterion uses when none is stored. */
export const STAFF_ORDER_DEFAULT_DIR: Record<StaffOrderKey, StaffOrderDir> = {
  employmentType: "asc", // EmploymentType.sortOrder: FTE (0) before Fee Basis (1)
  ftePercentage: "desc", // 1.0 leftmost
  alphabetical: "asc",
  initials: "asc",
  autoScheduled: "desc", // auto-scheduled staff first
  seniority: "asc", // earliest hire leftmost
  manual: "asc", // Staff.sortOrder
};

export type OrderableStaff = {
  id: string;
  name: string;
  initials: string;
  ftePercentage: number | null;
  isAutoScheduled: boolean;
  sortOrder: number;
  createdAt: string | Date;
  employmentType?: { sortOrder: number } | null;
};

function isStaffOrderKey(v: unknown): v is StaffOrderKey {
  return typeof v === "string" && (STAFF_ORDER_KEYS as readonly string[]).includes(v);
}

/**
 * Lenient read of a stored criteria list. Unknown/duplicate keys and malformed
 * entries are dropped; an empty or non-array result falls back to the default
 * stack (fail-open — a corrupt setting must never blank the schedule). If
 * "manual" appears at all, the whole config collapses to manual-only: manual is
 * an all-or-nothing mode, and honoring the admin's explicit choice of it beats
 * guessing at a mixed intent that the strict write path never allows.
 */
export function parseStaffOrderCriteria(raw: unknown): StaffOrderCriterion[] {
  if (!Array.isArray(raw)) return [...DEFAULT_STAFF_ORDER];
  const out: StaffOrderCriterion[] = [];
  const seen = new Set<StaffOrderKey>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { key, dir } = item as { key?: unknown; dir?: unknown };
    if (!isStaffOrderKey(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, ...(dir === "asc" || dir === "desc" ? { dir } : {}) });
  }
  if (out.length === 0) return [...DEFAULT_STAFF_ORDER];
  if (out.some((c) => c.key === "manual")) return [{ key: "manual" }];
  return out;
}

/**
 * Strict write-side validation: array of {key, dir?}, known keys, no duplicates,
 * and "manual" only as the sole entry. Returns the normalized list or an error
 * message (bad values are rejected, never coerced — matching the other
 * scheduling-preferences fields).
 */
export function validateStaffOrderCriteria(
  raw: unknown,
): { value: StaffOrderCriterion[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "staffColumnOrder must be a non-empty array of {key, dir?}" };
  }
  const out: StaffOrderCriterion[] = [];
  const seen = new Set<StaffOrderKey>();
  for (const item of raw) {
    if (!item || typeof item !== "object") return { error: "staffColumnOrder entries must be objects" };
    const { key, dir } = item as { key?: unknown; dir?: unknown };
    if (!isStaffOrderKey(key)) return { error: `Unknown staff order key: ${String(key)}` };
    if (seen.has(key)) return { error: `Duplicate staff order key: ${key}` };
    if (dir !== undefined && dir !== "asc" && dir !== "desc") {
      return { error: `dir must be "asc" or "desc" (key ${key})` };
    }
    seen.add(key);
    out.push({ key, ...(dir !== undefined ? { dir } : {}) });
  }
  if (seen.has("manual") && out.length > 1) {
    return { error: '"manual" cannot be combined with other criteria' };
  }
  return { value: out };
}

/**
 * The alphabetical sort key: the last name when one is listed, else the
 * letters of the initials after the first (initials are first-initial +
 * last-name letters, e.g. "ADh" → "Dh"). "Has a last name" means the name
 * contains whitespace and isn't just the initials; the last word wins so
 * middle names don't interfere. Single-letter initials fall back to the whole
 * initials rather than an empty key.
 */
export function staffAlphaKey(name: string, initials: string): string {
  const trimmed = (name ?? "").trim();
  if (/\s/.test(trimmed) && trimmed !== initials.trim()) {
    const parts = trimmed.split(/\s+/);
    return parts[parts.length - 1];
  }
  return initials.slice(1) || initials;
}

function cmpStr(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function createdMs(v: string | Date): number {
  const ms = (v instanceof Date ? v : new Date(v)).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function compareBy(c: StaffOrderCriterion, a: OrderableStaff, b: OrderableStaff): number {
  let cmp: number;
  switch (c.key) {
    case "employmentType":
      cmp = (a.employmentType?.sortOrder ?? 0) - (b.employmentType?.sortOrder ?? 0);
      break;
    case "ftePercentage":
      cmp = (a.ftePercentage ?? 0) - (b.ftePercentage ?? 0);
      break;
    case "alphabetical":
      cmp = cmpStr(staffAlphaKey(a.name, a.initials), staffAlphaKey(b.name, b.initials));
      break;
    case "initials":
      cmp = cmpStr(a.initials, b.initials);
      break;
    case "autoScheduled":
      cmp = (a.isAutoScheduled ? 1 : 0) - (b.isAutoScheduled ? 1 : 0);
      break;
    case "seniority":
      cmp = createdMs(a.createdAt) - createdMs(b.createdAt);
      break;
    case "manual":
      cmp = a.sortOrder - b.sortOrder;
      break;
  }
  const dir = c.dir ?? STAFF_ORDER_DEFAULT_DIR[c.key];
  return dir === "desc" ? -cmp : cmp;
}

/**
 * Order staff for display. Applies the criteria stack in sequence, then an
 * unconditional final tie-break of initials → id so the result is fully
 * deterministic even under duplicate sortOrder values (two pairs exist in
 * production data) or identical names. Pure — returns a new array.
 */
export function orderStaff<S extends OrderableStaff>(
  staff: S[],
  criteria: StaffOrderCriterion[],
): S[] {
  const crits = criteria.length > 0 ? criteria : DEFAULT_STAFF_ORDER;
  return [...staff].sort((a, b) => {
    for (const c of crits) {
      const cmp = compareBy(c, a, b);
      if (cmp !== 0) return cmp;
    }
    return cmpStr(a.initials, b.initials) || a.id.localeCompare(b.id);
  });
}
