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
 */
export function shapeBarSeries(
  rows: BarSeriesInput[],
  codes: string[],
  includeHolidays: boolean,
): BarSeriesRow[] {
  if (codes.length === 0 && !includeHolidays) return [];
  return [...rows]
    .sort((a, b) => a.initials.localeCompare(b.initials))
    .map((d) => {
      const row: BarSeriesRow = { initials: d.initials };
      if (includeHolidays) row["Holidays"] = d.holidayWorkCount;
      for (const code of codes) row[code] = d.shiftCounts[code] ?? 0;
      return row;
    });
}
