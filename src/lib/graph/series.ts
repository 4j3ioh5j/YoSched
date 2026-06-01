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

/* ------------------------------------------------------------------ *
 * Pie — department share by provider for an additive count metric. Each slice
 * is one provider sized by their value of the metric; the view turns the
 * values into shares. shiftCount sums the given (tracked) codes; hours/holidays
 * are the scalar totals. `perFte` divides by FTE (0-FTE -> 1.0) so the pie can
 * show share of per-1.0-FTE load. Zero/negative slices are dropped (a pie of
 * them is meaningless) and the rest are sorted largest-first.
 * ------------------------------------------------------------------ */

export type PieMetric = "shiftCount" | "hours" | "holidays";

export type PieInput = {
  initials: string;
  totalHours: number;
  holidayWorkCount: number;
  shiftCounts: Record<string, number>;
  ftePercentage: number;
};

export type PieSlice = { initials: string; value: number };

export function shapePie(
  rows: PieInput[],
  metric: PieMetric,
  codes: string[],
  perFte = false,
): PieSlice[] {
  const valueOf = (r: PieInput): number => {
    const raw =
      metric === "hours"
        ? r.totalHours
        : metric === "holidays"
          ? r.holidayWorkCount
          : codes.reduce((s, c) => s + (r.shiftCounts[c] ?? 0), 0);
    return perFte ? raw / (r.ftePercentage || 1) : raw;
  };
  return rows
    .map((r) => ({ initials: r.initials, value: valueOf(r) }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
}

/* ------------------------------------------------------------------ *
 * Heatmap — providers × shift codes, each cell carrying its raw count and the
 * provider's FTE-normalized per-shift z-score (deviation). The view colors the
 * cell from the deviation via `fairnessColor()`; this shaper stays color-free
 * so it is pure and unit-testable. `opportunityAdjusted` selects the
 * eligibility-adjusted deviations (spec.weighting === "opportunity") over the
 * plain ones, mirroring the radar.
 * ------------------------------------------------------------------ */

type PerShift = { perShift: Record<string, number> };

export type HeatmapInput = {
  initials: string;
  shiftCounts: Record<string, number>;
  deviation: PerShift;
  displayDeviation: PerShift;
};

export type HeatmapCell = { code: string; count: number; deviation: number };
export type HeatmapRow = { initials: string; cells: HeatmapCell[] };

/* ------------------------------------------------------------------ *
 * Single-metric bar — one value per provider for a scalar count metric
 * (hours / holidays). `perFte` divides by FTE for a per-1.0-FTE rate (same
 * rule as shapeBarSeries; 0-FTE treated as 1.0). shiftCount keeps its own
 * stacked-by-code series (shapeBarSeries); the signed z-score metrics are not
 * handled here.
 * ------------------------------------------------------------------ */

export type ScalarMetric = "hours" | "holidays";

export type MetricBarInput = {
  initials: string;
  totalHours: number;
  holidayWorkCount: number;
  ftePercentage: number;
};

export type MetricBarRow = { initials: string; value: number };

export function shapeMetricBar(
  rows: MetricBarInput[],
  metric: ScalarMetric,
  perFte = false,
): MetricBarRow[] {
  return [...rows]
    .sort((a, b) => a.initials.localeCompare(b.initials))
    .map((r) => {
      const raw = metric === "hours" ? r.totalHours : r.holidayWorkCount;
      return { initials: r.initials, value: perFte ? raw / (r.ftePercentage || 1) : raw };
    });
}

export function shapeHeatmap(
  rows: HeatmapInput[],
  codes: string[],
  opportunityAdjusted: boolean,
): HeatmapRow[] {
  return [...rows]
    .sort((a, b) => a.initials.localeCompare(b.initials))
    .map((r) => {
      const dev = opportunityAdjusted ? r.deviation : r.displayDeviation;
      return {
        initials: r.initials,
        cells: codes.map((code) => ({
          code,
          count: r.shiftCounts[code] ?? 0,
          deviation: dev.perShift[code] ?? 0,
        })),
      };
    });
}
