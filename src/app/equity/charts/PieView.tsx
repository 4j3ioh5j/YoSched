"use client";

import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { shapePie, type PieInput } from "@/lib/graph/series";

const PIE_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#22c55e", "#06b6d4",
  "#eab308", "#ef4444", "#14b8a6", "#a855f7", "#f43f5e", "#84cc16",
  "#0ea5e9", "#d946ef", "#fb923c", "#10b981",
];

function titleFor(metric: string): string {
  if (metric.startsWith("shift:")) return `${metric.slice(6)} Share`;
  if (metric === "hours") return "Hours Share";
  if (metric === "holidays") return "Holiday Share";
  return "Shift Share";
}

/**
 * Department-share donut: one slice per provider sized by their value of the
 * chosen count metric. Shaping/sorting is the pure `shapePie`; this is the thin
 * view that assigns colors and renders the share tooltip.
 */
export function PieView({
  data,
  metric,
  codes,
  perFte,
}: {
  data: PieInput[];
  metric: string;
  codes: string[];
  perFte: boolean;
}) {
  const slices = useMemo(() => shapePie(data, metric, codes, perFte), [data, metric, codes, perFte]);
  const total = useMemo(() => slices.reduce((s, d) => s + d.value, 0), [slices]);

  if (slices.length === 0 || total === 0) return null;

  return (
    <div className="mb-6">
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          {titleFor(metric)}{perFte ? " — per 1.0 FTE" : ""}
        </h3>
        <ResponsiveContainer width="100%" height={340}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="initials"
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={130}
              paddingAngle={1}
              stroke="#0f172a"
              strokeWidth={1}
              label={(p: { initials?: string; percent?: number }) =>
                (p.percent ?? 0) >= 0.04 ? p.initials ?? "" : ""
              }
              labelLine={false}
            >
              {slices.map((s, i) => (
                <Cell key={s.initials} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as { initials: string; value: number };
                const pct = total > 0 ? (d.value / total) * 100 : 0;
                return (
                  <div className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs shadow-lg">
                    <div className="text-slate-300 font-medium mb-0.5">{d.initials}</div>
                    <div className="text-slate-200 font-mono">
                      {d.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} · {pct.toFixed(1)}%
                    </div>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
