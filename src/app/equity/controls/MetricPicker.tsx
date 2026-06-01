"use client";

import type { GraphMetric } from "@/lib/graph/spec";

/**
 * Metric options are the active equity factors: "All shifts" (every tracked
 * code, stacked), each individual tracked code (CALL, ORC, ORL, …), plus
 * Holiday and Desirability when those factors are enabled.
 */
export function MetricPicker({
  value,
  shiftCodes,
  showHoliday,
  showDesirability,
  onChange,
}: {
  value: GraphMetric;
  shiftCodes: string[];
  showHoliday: boolean;
  showDesirability: boolean;
  onChange: (metric: GraphMetric) => void;
}) {
  const options: { metric: GraphMetric; label: string }[] = [
    { metric: "shiftCount", label: "All shifts" },
    ...shiftCodes.map((c) => ({ metric: `shift:${c}` as GraphMetric, label: c })),
    ...(showHoliday ? [{ metric: "holidays" as GraphMetric, label: "Holiday" }] : []),
    ...(showDesirability ? [{ metric: "desirability" as GraphMetric, label: "Desirability" }] : []),
  ];
  const active = options.some((o) => o.metric === value) ? value : "shiftCount";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-slate-500 w-16">Metric</span>
      <div className="flex flex-wrap rounded overflow-hidden border border-slate-700">
        {options.map((o) => (
          <button
            key={o.metric}
            onClick={() => onChange(o.metric)}
            className={`px-2.5 py-1 text-[11px] transition-colors border-r border-slate-700 last:border-r-0 ${active === o.metric ? "bg-blue-600/30 text-blue-300" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
