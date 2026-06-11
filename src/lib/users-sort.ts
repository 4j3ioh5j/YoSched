// Pure sorting + preference-parsing logic for the /users table. Kept free of React and
// Prisma so it can be unit-tested and reused by both the SSR loader (to seed the initial
// sort) and the self-service preferences API (to validate what gets persisted).

export type UserSortColumn = "name" | "email" | "group" | "staff" | "status" | "totp";
export type SortDir = "asc" | "desc";
export type UserSort = { column: UserSortColumn; dir: SortDir };

// Columns the UI lets you click. "Actions" is intentionally excluded.
export const SORTABLE_COLUMNS: readonly UserSortColumn[] = [
  "name",
  "email",
  "group",
  "staff",
  "status",
  "totp",
] as const;

// Human label per sortable column (header text lives in the component, but keeping the
// canonical set here means the union and the UI can't drift).
const COLUMN_SET = new Set<string>(SORTABLE_COLUMNS);

/** Validate an untrusted value (persisted JSON or request body) into a UserSort, or null.
 *  Used by both the API route (reject bad input with 400) and the loader (ignore junk). */
export function parseUserSort(value: unknown): UserSort | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.column !== "string" || !COLUMN_SET.has(v.column)) return null;
  if (v.dir !== "asc" && v.dir !== "desc") return null;
  return { column: v.column as UserSortColumn, dir: v.dir };
}

export type SortableUser = {
  id: string;
  name: string;
  email: string | null;
  group?: { name: string; level: number } | null;
  staff?: { name: string; initials: string } | null;
  isActive: boolean;
  loginComplete: boolean;
  totpEnabled?: boolean;
};

// Status column shows Active / Disabled / Needs setup. Rank them so the sort is meaningful:
// Active (operational) > Disabled-but-complete (has creds, just off) > Needs setup (incomplete shell).
function statusRank(u: SortableUser): number {
  if (u.isActive) return 2;
  if (u.loginComplete) return 1; // disabled but has email + password
  return 0; // needs setup (no creds yet)
}

// Pin an explicit locale so ordering is identical on the server (this client component is
// SSR'd) and in the browser — a default/undefined locale could differ between the two and
// cause a hydration mismatch when a persisted sort is active.
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

// Primary comparison value per column (ascending). Strings compared via collator; numbers
// (group level, status rank, totp 0/1) compared numerically. Missing email/staff sort to
// the end in ascending order (empty string is handled explicitly so null ties with "").
function compareByColumn(a: SortableUser, b: SortableUser, column: UserSortColumn): number {
  switch (column) {
    case "name":
      return collator.compare(a.name, b.name);
    case "email": {
      // Rows without an email group together at the end (ascending); among those with an
      // email, compare case-insensitively.
      const ae = a.email ?? "";
      const be = b.email ?? "";
      if (!ae && !be) return 0;
      if (!ae) return 1;
      if (!be) return -1;
      return collator.compare(ae, be);
    }
    case "group":
      // Hierarchy, not alphabetical: lower level first ascending. Ungrouped (shouldn't
      // happen — groupId is NOT NULL) sorts as level 0.
      return (a.group?.level ?? 0) - (b.group?.level ?? 0);
    case "staff": {
      const as = a.staff?.name ?? "";
      const bs = b.staff?.name ?? "";
      if (!as && !bs) return 0;
      if (!as) return 1;
      if (!bs) return -1;
      return collator.compare(as, bs);
    }
    case "status":
      return statusRank(a) - statusRank(b);
    case "totp":
      return (a.totpEnabled ? 1 : 0) - (b.totpEnabled ? 1 : 0);
  }
}

/** Return a new array of users sorted by the given column/direction. Ties break by name
 *  then id so the order is stable and deterministic regardless of input order. */
export function sortUsers<T extends SortableUser>(users: readonly T[], sort: UserSort): T[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...users].sort((a, b) => {
    const primary = compareByColumn(a, b, sort.column);
    if (primary !== 0) return primary * factor;
    // Stable tiebreak (always ascending, independent of dir, so equal-key rows keep a
    // consistent relative order whichever direction is chosen).
    const byName = collator.compare(a.name, b.name);
    if (byName !== 0) return byName;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
