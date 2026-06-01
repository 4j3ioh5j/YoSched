"use client";

import type { GraphChart } from "@/lib/graph/spec";

// Chart types selectable for the overview panel. Radar is the per-provider
// drill-down (not a panel chart); pie + line arrive in later slices.
const CHARTS: { chart: GraphChart; label: string }[] = [
  { chart: "bar", label: "Bar" },
  { chart: "heatmap", label: "Heatmap" },
];

export function ChartTypePicker({
  value,
  onChange,
}: {
  value: GraphChart;
  onChange: (chart: GraphChart) => void;
}) {
  // Fall back to bar for chart values this slice doesn't render yet.
  const active = CHARTS.some((c) => c.chart === value) ? value : "bar";
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 w-16">Chart</span>
      <div className="flex rounded overflow-hidden border border-slate-700">
        {CHARTS.map((c) => (
          <button
            key={c.chart}
            onClick={() => onChange(c.chart)}
            className={`px-2.5 py-1 text-[11px] transition-colors ${active === c.chart ? "bg-blue-600/30 text-blue-300" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
