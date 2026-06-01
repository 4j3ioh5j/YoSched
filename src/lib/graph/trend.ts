/**
 * Trend computation for the line chart — the one place the metric engine is
 * looped. For each time bucket we re-run the full client compute over just that
 * bucket's assignments, then read the chosen metric per provider. Pure
 * (computeStatsModel is pure), so it is deterministic and unit-testable.
 */
import { computeStatsModel, type RawStatsData } from "./model";
import { scalarMetricValue, type MetricOpts, type MetricRow } from "./series";
import type { Bucket } from "./buckets";

export type TrendLine = { id: string; initials: string };
/** One x-axis point: the bucket label plus a value keyed by each provider's initials. */
export type TrendPoint = { bucket: string } & Record<string, number | string>;

export type Trend = { points: TrendPoint[]; lines: TrendLine[] };

/**
 * One line per included provider, one point per bucket.
 * `providerIds` is the set to plot (the staff-filtered providers); lines keep
 * the providers' source order. A "shiftCount" metric sums the given `codes`.
 */
export function computeTrend(
  raw: RawStatsData,
  buckets: Bucket[],
  metric: string,
  opts: MetricOpts,
  providerIds: string[],
  codes: string[],
): Trend {
  const idSet = new Set(providerIds);
  const lines: TrendLine[] = raw.providers
    .filter((p) => idSet.has(p.id))
    .map((p) => ({ id: p.id, initials: p.initials }));

  const sumCodes = (row: MetricRow) => codes.reduce((s, c) => s + (row.shiftCounts[c] ?? 0), 0);

  const points: TrendPoint[] = buckets.map((b) => {
    const assignments = raw.assignments.filter((a) => a.date >= b.start && a.date <= b.end);
    const model = computeStatsModel({ ...raw, assignments });
    const byId = new Map(model.data.map((r) => [r.providerId, r]));
    const point: TrendPoint = { bucket: b.label };
    for (const ln of lines) {
      const row = byId.get(ln.id);
      if (!row) {
        point[ln.initials] = 0;
      } else if (metric === "shiftCount") {
        const raw0 = sumCodes(row);
        point[ln.initials] = opts.perFte ? raw0 / (row.ftePercentage || 1) : raw0;
      } else {
        point[ln.initials] = scalarMetricValue(row, metric, opts);
      }
    }
    return point;
  });

  return { points, lines };
}
