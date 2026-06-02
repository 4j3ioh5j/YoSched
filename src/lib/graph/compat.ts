/**
 * Chart × metric compatibility — which panel chart types can sensibly render
 * each metric. Drives the grey-out in the chart/metric pickers and the
 * auto-correction when a selection would otherwise leave an invalid combo.
 *
 * Rationale:
 * - Counts (shiftCount/hours/holidays) are additive, non-negative → bar, pie
 *   both work.
 * - shiftCount additionally has a per-shift-code breakdown → heatmap (the
 *   providers × codes equity grid) only makes sense for it.
 * - The equity z-scores (desirability/equityDeviation) are signed and not
 *   additive → bar only (no pie share, no per-code heatmap).
 *
 * `radar` is the per-provider drill-down, not a panel chart, so it is not part
 * of this matrix.
 */
import type { GraphChart, GraphMetric } from "./spec";

const COMPAT: Record<string, GraphChart[]> = {
  shiftCount: ["bar", "pie", "heatmap"],
  hours: ["bar", "pie"],
  holidays: ["bar", "pie"],
  desirability: ["bar"],
  equityDeviation: ["bar"],
};

// A specific shift code ("shift:CALL") has the same chart options as shiftCount
// (it is a per-code count, and the heatmap shows it in context of the others).
function compatKey(metric: GraphMetric): string {
  return metric.startsWith("shift:") ? "shiftCount" : metric;
}

export function isCompatible(metric: GraphMetric, chart: GraphChart): boolean {
  return (COMPAT[compatKey(metric)] ?? ["bar"]).includes(chart);
}

export function validChartsForMetric(metric: GraphMetric): GraphChart[] {
  return COMPAT[compatKey(metric)] ?? ["bar"];
}

/**
 * Return `chart` if it can render `metric`, else the metric's first valid chart
 * (always "bar" in practice). Use when the metric changes so the spec never
 * lands on an impossible combination.
 */
export function coerceChart(metric: GraphMetric, chart: GraphChart): GraphChart {
  return isCompatible(metric, chart) ? chart : validChartsForMetric(metric)[0];
}
