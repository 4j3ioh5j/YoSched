import { formatDate, type DateFormatKey } from "@/lib/date-format";

// Card #312: Print and Export save a schedule version first, so a printout or an
// exported file never carries a stale (or missing) version number. A month needs a
// version when it has none at all (even a blank month: it becomes Version 1) or when
// its live cells no longer match its current version's hash. Pure helpers, shared by
// the grid, the export dialog and the /api/versions/ensure route.

export const AUTO_VERSION_MODES = ["auto", "ask", "off"] as const;
export type AutoVersionMode = (typeof AUTO_VERSION_MODES)[number];

/** Settings value → mode. Missing or unknown (an old server, junk) is Automatic. */
export function parseAutoVersionMode(v: unknown): AutoVersionMode {
  return typeof v === "string" && (AUTO_VERSION_MODES as readonly string[]).includes(v) ? (v as AutoVersionMode) : "auto";
}

export type YearMonth = { year: number; month: number }; // month 0-based
export type EnsureMonth = YearMonth & { expectedHash: string };

/** The twelve months of a year, January first. */
export function yearMonths(year: number): YearMonth[] {
  return Array.from({ length: 12 }, (_, month) => ({ year, month }));
}

/**
 * The months (in input order) that need a new version: no current version, or a
 * current version whose hash differs from the live cells. Each carries the live hash
 * the server must still see, so a change made elsewhere meanwhile is refused.
 */
export function monthsNeedingVersion(
  months: YearMonth[],
  liveHashOf: (year: number, month: number) => string,
  currentOf: (year: number, month: number) => { snapshotHash: string } | null,
): EnsureMonth[] {
  const out: EnsureMonth[] = [];
  for (const { year, month } of months) {
    const live = liveHashOf(year, month);
    const cur = currentOf(year, month);
    if (!cur || cur.snapshotHash !== live) out.push({ year, month, expectedHash: live });
  }
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The comment an automatic version carries: when, and why (24-hour time). */
export function autoVersionComment(kind: "print" | "export", now: Date, format: DateFormatKey, year?: number): string {
  const when = `${formatDate(now, format)} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  return kind === "print" ? `Auto: printed ${when}` : `Auto: exported ${year} on ${when}`;
}
