/**
 * Chart × metric compatibility — which panel chart types can sensibly render
 * each metric. Drives the grey-out in the chart/metric pickers and the
 * auto-correction when a selection would otherwise leave an invalid combo.
 *
 * Rationale:
 * - Counts (shiftCount/hours/holidays) are additive, non-negative → bar, pie,
 *   line all work.
 * - shiftCount additionally has a per-shift-code breakdown → heatmap (the
 *   providers × codes equity grid) only makes sense for it.
 * - The equity z-scores (desirability/equityDeviation) are signed and not
 *   additive → bar/line only (no pie share, no per-code heatmap).
 *
 * `radar` is the per-provider drill-down, not a panel chart, so it is not part
 * of this matrix. `pie`/`line` appear here now but are wired in 4b-ii / 4c.
 */
import type { GraphChart, GraphMetric } from "./spec";

const COMPAT: Record<GraphMetric, GraphChart[]> = {
  shiftCount: ["bar", "pie", "heatmap", "line"],
  hours: ["bar", "pie", "line"],
  holidays: ["bar", "pie", "line"],
  desirability: ["bar", "line"],
  equityDeviation: ["bar", "line"],
};

export function isCompatible(metric: GraphMetric, chart: GraphChart): boolean {
  return COMPAT[metric].includes(chart);
}

export function validChartsForMetric(metric: GraphMetric): GraphChart[] {
  return COMPAT[metric];
}

/**
 * Return `chart` if it can render `metric`, else the metric's first valid chart
 * (always "bar" in practice). Use when the metric changes so the spec never
 * lands on an impossible combination.
 */
export function coerceChart(metric: GraphMetric, chart: GraphChart): GraphChart {
  return isCompatible(metric, chart) ? chart : validChartsForMetric(metric)[0];
}
