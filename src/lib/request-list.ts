// Pure search + sort for the Requests page list. Kept free of React / i18n /
// date-formatting so it's unit-testable: the page projects each row into a
// `RequestSortFields` using its own display helpers, then this module filters
// and orders them. The status-tab filter stays in the page (it's a simple
// equality on the raw status); this handles free-text search and column sort.

// Click-to-sort columns (the Actions column is buttons-only, never sortable).
export type RequestSortKey = "staff" | "dates" | "request" | "status" | "source" | "received" | "approved";
export type RequestSortDir = "asc" | "desc";
export type RequestSort = { key: RequestSortKey; dir: RequestSortDir };

// Comparable projection of a request row. `haystack` is the lowercased blob of
// everything visible in the row (built by the caller from its display helpers);
// `statusRank` orders statuses by the status-tab order, not alphabetically.
export type RequestSortFields = {
  staff: string;
  startDate: string;
  endDate: string;
  request: string;
  statusRank: number;
  source: string;
  receivedAt: string;
  approvedAt: string | null;
  haystack: string;
};

/** Ascending field comparison for one sort column. Direction is applied by the caller. */
export function compareByKey(a: RequestSortFields, b: RequestSortFields, key: RequestSortKey): number {
  switch (key) {
    case "staff":
      return a.staff.localeCompare(b.staff);
    case "dates":
      // ISO dates compare lexicographically; tie-break on the end date.
      return a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate);
    case "request":
      return a.request.localeCompare(b.request);
    case "status":
      return a.statusRank - b.statusRank;
    case "source":
      return a.source.localeCompare(b.source);
    case "received":
      return a.receivedAt.localeCompare(b.receivedAt);
    case "approved":
      return (a.approvedAt ?? "").localeCompare(b.approvedAt ?? "");
  }
}

/**
 * Free-text match: case-insensitive, whitespace-split, every term must appear
 * somewhere in the haystack (AND). An empty/blank query matches everything.
 */
export function matchesSearch(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = haystack.toLowerCase();
  return q.split(/\s+/).every((t) => hay.includes(t));
}

/**
 * Filter rows by free-text search then sort by the chosen column. Generic over
 * the row type: `fieldsOf` projects each row to its comparable fields (computed
 * once per row, not per comparison). Stable-ish: returns a new array, original
 * order preserved when no sort is set. Unapproved rows (null `approvedAt`) always
 * sort last on the "approved" column regardless of direction, so reversing the
 * sort never buries the rows that actually have a timestamp.
 */
export function filterAndSortRequests<T>(
  rows: T[],
  fieldsOf: (row: T) => RequestSortFields,
  opts: { query: string; sort: RequestSort | null },
): T[] {
  let paired = rows.map((row) => ({ row, f: fieldsOf(row) }));

  if (opts.query.trim()) {
    paired = paired.filter((p) => matchesSearch(p.f.haystack, opts.query));
  }

  if (opts.sort) {
    const { key, dir } = opts.sort;
    const mul = dir === "asc" ? 1 : -1;
    paired = [...paired].sort((a, b) => {
      if (key === "approved") {
        if (!a.f.approvedAt && !b.f.approvedAt) return 0;
        if (!a.f.approvedAt) return 1;
        if (!b.f.approvedAt) return -1;
      }
      return compareByKey(a.f, b.f, key) * mul;
    });
  }

  return paired.map((p) => p.row);
}
