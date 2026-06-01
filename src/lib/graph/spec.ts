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
  | "equityDeviation"
  /** a specific tracked shift code, e.g. "shift:CALL" */
  | `shift:${string}`;

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

/* ------------------------------------------------------------------ *
 * URL encoding (?g=...) — shareable links with zero DB cost.
 *
 * encodeSpec/decodeSpec round-trip a GraphSpec through a URL query value.
 * decodeSpec is defensive: the input is untrusted (anyone can edit the URL),
 * so it coerces field-by-field onto DEFAULT_SPEC and drops anything invalid,
 * returning null only when the value isn't parseable JSON or isn't an object.
 * ------------------------------------------------------------------ */

const METRICS: GraphMetric[] = ["shiftCount", "hours", "holidays", "desirability", "equityDeviation"];
const CHARTS: GraphChart[] = ["bar", "pie", "radar", "heatmap", "line"];

function isMetric(v: unknown): v is GraphMetric {
  return typeof v === "string" && (METRICS.includes(v as GraphMetric) || v.startsWith("shift:"));
}

export function encodeSpec(spec: GraphSpec): string {
  return encodeURIComponent(JSON.stringify(spec));
}

function coerceDateRange(v: unknown): GraphDateRange {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.kind === "payPeriods" && Array.isArray(o.payPeriodIds)) {
      return { kind: "payPeriods", payPeriodIds: o.payPeriodIds.filter((x): x is string => typeof x === "string") };
    }
    if (o.kind === "custom" && typeof o.start === "string" && typeof o.end === "string") {
      return { kind: "custom", start: o.start, end: o.end };
    }
  }
  return { ...DEFAULT_SPEC.dateRange };
}

function coerceStaff(v: unknown): GraphStaffFilter {
  if (!v || typeof v !== "object") return { ...DEFAULT_SPEC.staff };
  const o = v as Record<string, unknown>;
  const staff: GraphStaffFilter = {};
  if (typeof o.all === "boolean") staff.all = o.all;
  if (Array.isArray(o.names)) staff.names = o.names.filter((x): x is string => typeof x === "string");
  if (typeof o.employmentType === "string") staff.employmentType = o.employmentType;
  else if (o.employmentType === null) staff.employmentType = null;
  if (typeof o.minFtePct === "number" && Number.isFinite(o.minFtePct)) staff.minFtePct = o.minFtePct;
  else if (o.minFtePct === null) staff.minFtePct = null;
  return Object.keys(staff).length ? staff : { ...DEFAULT_SPEC.staff };
}

export function decodeSpec(raw: string): GraphSpec | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;

  const spec: GraphSpec = {
    version: 1,
    dateRange: coerceDateRange(o.dateRange),
    staff: coerceStaff(o.staff),
    metric: isMetric(o.metric) ? o.metric : DEFAULT_SPEC.metric,
    chart: CHARTS.includes(o.chart as GraphChart) ? (o.chart as GraphChart) : DEFAULT_SPEC.chart,
    normalize: o.normalize === "fte" ? "fte" : "raw",
    weighting: o.weighting === "opportunity" ? "opportunity" : "none",
  };
  spec.groupByShiftCode =
    typeof o.groupByShiftCode === "boolean" ? o.groupByShiftCode : DEFAULT_SPEC.groupByShiftCode;
  if (o.timeBucket === "payPeriod" || o.timeBucket === "month") spec.timeBucket = o.timeBucket;
  return spec;
}
