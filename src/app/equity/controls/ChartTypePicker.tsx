"use client";

import type { GraphChart, GraphMetric } from "@/lib/graph/spec";
import { isCompatible } from "@/lib/graph/compat";

// Chart types selectable for the overview panel. Radar is the per-staff
// drill-down (not a panel chart).
const CHARTS: { chart: GraphChart; label: string }[] = [
  { chart: "bar", label: "Bar" },
  { chart: "pie", label: "Pie" },
  { chart: "heatmap", label: "Heatmap" },
];

export function ChartTypePicker({
  value,
  metric,
  onChange,
}: {
  value: GraphChart;
  metric: GraphMetric;
  onChange: (chart: GraphChart) => void;
}) {
  // Fall back to bar for chart values this slice doesn't render yet.
  const active = CHARTS.some((c) => c.chart === value) ? value : "bar";
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 w-16">Chart</span>
      <div className="flex rounded overflow-hidden border border-slate-700">
        {CHARTS.map((c) => {
          const ok = isCompatible(metric, c.chart);
          return (
            <button
              key={c.chart}
              onClick={() => ok && onChange(c.chart)}
              disabled={!ok}
              title={ok ? undefined : `Not available for this metric`}
              className={`px-2.5 py-1 text-[11px] transition-colors ${
                active === c.chart
                  ? "bg-blue-600/30 text-blue-300"
                  : ok
                    ? "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    : "bg-slate-800 text-slate-700 cursor-not-allowed"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
