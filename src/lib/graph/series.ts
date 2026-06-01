/**
 * Series shaping for the statistics graphing pipeline — turns per-provider
 * metrics into chart-ready rows. Pure and unit-tested; the chart components
 * stay thin.
 *
 * Slice 1 covers the shift-distribution bar series (today's only bar chart).
 * Later slices add pie/heatmap/line shapers and route them through GraphSpec.
 */

/** Minimum per-provider shape the bar series needs. */
export type BarSeriesInput = {
  initials: string;
  holidayWorkCount: number;
  shiftCounts: Record<string, number>;
  ftePercentage: number;
};

/** A chart row: one provider, keyed by shift code (+ optional "Holidays"). */
export type BarSeriesRow = { initials: string } & Record<string, string | number>;

/**
 * Build the per-provider shift-distribution bar series.
 *
 * Reproduces the current OverviewCharts behavior exactly:
 * - sorted by initials (locale compare)
 * - an optional "Holidays" series from holidayWorkCount
 * - one series per visible shift code (missing counts => 0)
 * - returns [] when nothing is selected (no codes and no holidays), so the
 *   caller can skip rendering the chart.
 *
 * When `perFte` is set (the global `normalize: "fte"` transform), every count
 * is divided by the provider's FTE percentage, giving a per-1.0-FTE rate so a
 * part-time provider's load is comparable to a full-timer's. An FTE of 0 (or
 * missing) is treated as 1.0 to avoid divide-by-zero.
 */
export function shapeBarSeries(
  rows: BarSeriesInput[],
  codes: string[],
  includeHolidays: boolean,
  perFte = false,
): BarSeriesRow[] {
  if (codes.length === 0 && !includeHolidays) return [];
  const norm = (count: number, fte: number) => (perFte ? count / (fte || 1) : count);
  return [...rows]
    .sort((a, b) => a.initials.localeCompare(b.initials))
    .map((d) => {
      const row: BarSeriesRow = { initials: d.initials };
      if (includeHolidays) row["Holidays"] = norm(d.holidayWorkCount, d.ftePercentage);
      for (const code of codes) row[code] = norm(d.shiftCounts[code] ?? 0, d.ftePercentage);
      return row;
    });
}
