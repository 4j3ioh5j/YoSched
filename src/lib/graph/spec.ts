/**
 * GraphSpec — the single serializable source of truth for the statistics
 * graphing tool. Every picker control reads/writes this object, and the chart
 * is a pure function of it. Saving a view (a later slice) is just persisting a
 * GraphSpec. See docs/statistics-revamp-plan.md.
 *
 * Slice 1 introduces the type and the pure series/filter helpers it will drive.
 * The page still computes server-side for now; client-side recompute and the
 * remaining controls land in subsequent slices.
 */

export type GraphMetric =
  | "shiftCount"
  | "hours"
  | "holidays"
  | "desirability"
  | "equityDeviation";

export type GraphChart = "bar" | "pie" | "radar" | "heatmap" | "line";

export type GraphDateRange =
  | { kind: "payPeriods"; payPeriodIds: string[] }
  | { kind: "custom"; start: string; end: string };

export type GraphStaffFilter = {
  all?: boolean;
  /** explicit provider ids */
  names?: string[];
  /** employment type name, e.g. "FTE" | "Fee Basis" */
  employmentType?: string | null;
  minFtePct?: number | null;
};

export type GraphSpec = {
  version: 1;
  dateRange: GraphDateRange;
  staff: GraphStaffFilter;
  metric: GraphMetric;
  /** stack bar/area series by shift code */
  groupByShiftCode?: boolean;
  chart: GraphChart;
  normalize: "raw" | "fte";
  weighting: "none" | "opportunity";
  /** only used by the line/trend chart */
  timeBucket?: "payPeriod" | "month";
};

/**
 * Default spec — reproduces today's Statistics view: a raw, per-provider shift
 * distribution bar chart across all staff and the full date range.
 */
export const DEFAULT_SPEC: GraphSpec = {
  version: 1,
  dateRange: { kind: "custom", start: "", end: "" },
  staff: { all: true },
  metric: "shiftCount",
  groupByShiftCode: true,
  chart: "bar",
  normalize: "raw",
  weighting: "none",
};
