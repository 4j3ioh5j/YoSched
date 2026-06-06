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

export type PieInput = {
  initials: string;
  totalHours: number;
  holidayWorkCount: number;
  shiftCounts: Record<string, number>;
  ftePercentage: number;
};

export type PieSlice = { initials: string; value: number };

/**
 * `metric` is "shiftCount" (sum of `codes`), "shift:CODE" (one code),
 * "hours", or "holidays". `codes` is only used by "shiftCount".
 */
export function shapePie(
  rows: PieInput[],
  metric: string,
  codes: string[],
  perFte = false,
): PieSlice[] {
  const valueOf = (r: PieInput): number => {
    let raw: number;
    if (metric === "shiftCount") raw = codes.reduce((s, c) => s + (r.shiftCounts[c] ?? 0), 0);
    else if (metric.startsWith("shift:")) raw = r.shiftCounts[metric.slice(6)] ?? 0;
    else if (metric === "hours") raw = r.totalHours;
    else if (metric === "holidays") raw = r.holidayWorkCount;
    else raw = 0;
    return perFte ? raw / (r.ftePercentage || 1) : raw;
  };
  return rows
    .map((r) => ({ initials: r.initials, value: valueOf(r) }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
}

/* ------------------------------------------------------------------ *
 * Heatmap — one row per provider, each cell carrying a shift code's raw count
 * and the provider's FTE-normalized per-shift z-score (deviation); with
 * `includeHolidays` a trailing "Holidays" cell (holidayWorkCount + holidayWork
 * dev) is appended. The view transposes this to shift codes (y) × staff (x) and
 * colors each cell from the deviation via `heatmapTempColor()`; this shaper
 * stays color-free so it is pure and unit-testable. `opportunityAdjusted`
 * selects the eligibility-adjusted deviations (spec.weighting === "opportunity")
 * over the plain ones, mirroring the radar.
 * ------------------------------------------------------------------ */

type PerShift = { perShift: Record<string, number>; holidayWork?: number };

export type HeatmapInput = {
  initials: string;
  shiftCounts: Record<string, number>;
  holidayWorkCount?: number;
  deviation: PerShift;
  displayDeviation: PerShift;
};

export type HeatmapCell = { code: string; count: number; deviation: number };
export type HeatmapRow = { initials: string; cells: HeatmapCell[] };

/* ------------------------------------------------------------------ *
 * Single-value metric — one value per provider. Covers a specific shift code
 * ("shift:CALL" -> that code's count), holidays/hours (scalar counts), and
 * desirability (the FTE-normalized z-score, sign-flipped to match the table so
 * higher = fewer undesirable shifts). `perFte` divides count metrics by FTE
 * (0-FTE -> 1.0); it does not apply to the z-score, which is already
 * FTE-normalized. shiftCount stays the stacked-by-code series (shapeBarSeries).
 * ------------------------------------------------------------------ */

export type MetricRow = {
  initials: string;
  shiftCounts: Record<string, number>;
  holidayWorkCount: number;
  totalHours: number;
  ftePercentage: number;
  deviation: { desirability: number };
  displayDeviation: { desirability: number };
};

export type MetricOpts = { perFte?: boolean; opportunityAdjusted?: boolean };

export type MetricBarRow = { initials: string; value: number };

/** True for metrics measured as additive counts (divisible by FTE); false for
 *  the signed z-score metrics. */
export function isCountMetric(metric: string): boolean {
  return metric.startsWith("shift:") || metric === "hours" || metric === "holidays" || metric === "shiftCount";
}

export function scalarMetricValue(row: MetricRow, metric: string, opts: MetricOpts = {}): number {
  const div = (n: number) => (opts.perFte ? n / (row.ftePercentage || 1) : n);
  if (metric.startsWith("shift:")) return div(row.shiftCounts[metric.slice(6)] ?? 0);
  switch (metric) {
    case "hours":
      return div(row.totalHours);
    case "holidays":
      return div(row.holidayWorkCount);
    case "desirability":
      return -(opts.opportunityAdjusted ? row.deviation : row.displayDeviation).desirability;
    default:
      return 0;
  }
}

export function shapeMetricBar(rows: MetricRow[], metric: string, opts: MetricOpts = {}): MetricBarRow[] {
  return [...rows]
    .sort((a, b) => a.initials.localeCompare(b.initials))
    .map((r) => ({ initials: r.initials, value: scalarMetricValue(r, metric, opts) }));
}

export function shapeHeatmap(
  rows: HeatmapInput[],
  codes: string[],
  opportunityAdjusted: boolean,
  includeHolidays = false,
): HeatmapRow[] {
  return [...rows]
    .sort((a, b) => a.initials.localeCompare(b.initials))
    .map((r) => {
      const dev = opportunityAdjusted ? r.deviation : r.displayDeviation;
      const cells = codes.map((code) => ({
        code,
        count: r.shiftCounts[code] ?? 0,
        deviation: dev.perShift[code] ?? 0,
      }));
      if (includeHolidays) {
        cells.push({ code: "Holidays", count: r.holidayWorkCount ?? 0, deviation: dev.holidayWork ?? 0 });
      }
      return { initials: r.initials, cells };
    });
}
