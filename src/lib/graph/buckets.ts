/**
 * Time bucketing for the trend (line) chart. Splits a date span into ordered
 * buckets — one per calendar month or per pay period — each carrying an
 * inclusive [start, end] ISO range the caller filters assignments against.
 *
 * Pure and string-based: dates are ISO `YYYY-MM-DD`, which sort lexically, so
 * month bounds use `-01`/`-31` sentinels (no real date exceeds `-31`) and no
 * Date object is needed.
 */
import type { PayPeriodRef } from "./filter";

export type BucketMode = "payPeriod" | "month";

export type Bucket = {
  key: string;
  label: string;
  /** inclusive ISO bounds */
  start: string;
  end: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthBuckets(dates: string[]): Bucket[] {
  const keys = [...new Set(dates.map((d) => d.slice(0, 7)))].sort(); // YYYY-MM
  return keys.map((ym) => {
    const [y, m] = ym.split("-");
    return {
      key: ym,
      label: `${MONTHS[Number(m) - 1]} ${y}`,
      start: `${ym}-01`,
      end: `${ym}-31`,
    };
  });
}

function ppLabel(startDate: string, endDate: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${Number(m)}/${Number(d)}`;
  };
  return `${fmt(startDate)}–${fmt(endDate)}`;
}

function payPeriodBuckets(dates: string[], payPeriods: PayPeriodRef[]): Bucket[] {
  if (dates.length === 0) return [];
  const min = dates.reduce((a, b) => (b < a ? b : a));
  const max = dates.reduce((a, b) => (b > a ? b : a));
  return payPeriods
    .filter((p) => p.startDate <= max && p.endDate >= min) // overlaps the span
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((p) => ({ key: p.id, label: ppLabel(p.startDate, p.endDate), start: p.startDate, end: p.endDate }));
}

/**
 * Build the ordered bucket list covering the dates present in `assignments`.
 * Returns [] when there are no dates.
 */
export function buildBuckets(
  dates: string[],
  mode: BucketMode,
  payPeriods: PayPeriodRef[],
): Bucket[] {
  if (dates.length === 0) return [];
  return mode === "month" ? monthBuckets(dates) : payPeriodBuckets(dates, payPeriods);
}
