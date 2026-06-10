"use client";

import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { shapeMetricBar, isCountMetric, type MetricRow } from "@/lib/graph/series";

function titleFor(metric: string): string {
  if (metric.startsWith("shift:")) return `${metric.slice(6)} Shifts`;
  if (metric === "holidays") return "Holidays Worked";
  if (metric === "hours") return "Total Hours";
  if (metric === "desirability") return "Desirability";
  return "Metric";
}

function colorFor(metric: string): string {
  if (metric === "holidays") return "#ef4444";
  if (metric === "desirability") return "#22c55e";
  return "#3b82f6";
}

function unitFor(metric: string, perFte: boolean): string {
  if (perFte && isCountMetric(metric)) return "per 1.0 FTE";
  if (metric === "hours") return "hrs";
  return "";
}

function BarTip({ active, payload, label, unit }: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs shadow-lg">
      <div className="text-slate-300 font-medium mb-0.5">{label}</div>
      <div className="text-slate-200 font-mono">
        {payload[0].value.toLocaleString(undefined, { maximumFractionDigits: 2 })} {unit}
      </div>
    </div>
  );
}

/**
 * Single-value-per-staff bar for one metric (a specific shift code, holidays,
 * hours, or the desirability z-score). Shaping is the pure `shapeMetricBar`;
 * this stays a thin view. The desirability metric is a signed z-score, so a
 * zero reference line is drawn for it.
 */
export function MetricBarView({
  data,
  metric,
  perFte,
  opportunityAdjusted,
}: {
  data: MetricRow[];
  metric: string;
  perFte: boolean;
  opportunityAdjusted: boolean;
}) {
  const rows = useMemo(
    () => shapeMetricBar(data, metric, { perFte, opportunityAdjusted }),
    [data, metric, perFte, opportunityAdjusted],
  );
  const signed = !isCountMetric(metric); // desirability can go negative
  const unit = unitFor(metric, perFte);
  const showFteSuffix = perFte && isCountMetric(metric);

  return (
    <div className="mb-6">
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          {titleFor(metric)}{showFteSuffix ? " — per 1.0 FTE" : ""}
        </h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={rows} margin={{ left: -10, right: 10, top: 5, bottom: 5 }} barCategoryGap="20%">
            <XAxis dataKey="initials" tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "monospace" }} axisLine={{ stroke: "#334155" }} tickLine={false} interval={0} />
            <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<BarTip unit={unit} />} cursor={{ fill: "#33415533" }} />
            {signed && <ReferenceLine y={0} stroke="#475569" />}
            <Bar dataKey="value" name={titleFor(metric)} fill={colorFor(metric)} fillOpacity={0.75} radius={[2, 2, 0, 0]} minPointSize={2} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
