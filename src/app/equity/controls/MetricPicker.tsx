"use client";

import type { GraphMetric } from "@/lib/graph/spec";

// Metrics wired so far. shiftCount is the per-code distribution; hours/holidays
// are scalar per-provider counts. The signed equity z-scores
// (desirability/equityDeviation) stay table/radar-only for now.
const METRICS: { metric: GraphMetric; label: string }[] = [
  { metric: "shiftCount", label: "Shift count" },
  { metric: "hours", label: "Hours" },
  { metric: "holidays", label: "Holidays" },
];

export function MetricPicker({
  value,
  onChange,
}: {
  value: GraphMetric;
  onChange: (metric: GraphMetric) => void;
}) {
  const active = METRICS.some((m) => m.metric === value) ? value : "shiftCount";
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 w-16">Metric</span>
      <div className="flex rounded overflow-hidden border border-slate-700">
        {METRICS.map((m) => (
          <button
            key={m.metric}
            onClick={() => onChange(m.metric)}
            className={`px-2.5 py-1 text-[11px] transition-colors ${active === m.metric ? "bg-blue-600/30 text-blue-300" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
