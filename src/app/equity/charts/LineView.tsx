"use client";

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";
import type { Trend } from "@/lib/graph/trend";

const LINE_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#22c55e", "#06b6d4",
  "#eab308", "#ef4444", "#14b8a6", "#a855f7", "#f43f5e", "#84cc16",
  "#0ea5e9", "#d946ef", "#fb923c", "#10b981",
];

/**
 * Trend line chart — one line per provider over the time buckets. The data is
 * the pre-computed `Trend` (see computeTrend); this is the thin view.
 */
export function LineView({ trend, title }: { trend: Trend; title: string }) {
  if (trend.points.length === 0 || trend.lines.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{title}</h3>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={trend.points} margin={{ left: -10, right: 10, top: 5, bottom: 5 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={{ stroke: "#334155" }} tickLine={false} interval={0} />
            <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 4, fontSize: 11 }}
              labelStyle={{ color: "#cbd5e1" }}
              itemStyle={{ padding: 0 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="line" iconSize={10} />
            {trend.lines.map((ln, i) => (
              <Line
                key={ln.id}
                type="monotone"
                dataKey={ln.initials}
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                strokeWidth={1.75}
                dot={false}
                activeDot={{ r: 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
