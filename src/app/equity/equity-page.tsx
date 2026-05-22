"use client";

import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
  Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Legend,
} from "recharts";

type Deviation = {
  desirability: number;
  holidayWork: number;
  overall: number;
  perShift: Record<string, number>;
};

type EquityRow = {
  providerId: string;
  initials: string;
  name: string;
  isAutoScheduled: boolean;
  ftePercentage: number;
  desirabilityScore: number;
  undesirableShiftCount: number;
  desirableShiftCount: number;
  holidayWorkCount: number;
  totalWorkDays: number;
  totalLeaveDays: number;
  totalHours: number;
  deviation: Deviation;
  shiftCounts: Record<string, number>;
  shiftTally: Record<string, number>;
};

type EquityThresholds = { low: number; med: number; high: number };

type Averages = {
  desirabilityScore: number;
  holidayWorkCount: number;
  perShift: Record<string, number>;
  totalHours: number;
  totalWorkDays: number;
  totalLeaveDays: number;
};

type Props = {
  data: EquityRow[];
  averages: Averages;
  trackedShiftCodes: string[];
  dateRange: { min: string; max: string };
  shiftCodes: string[];
  equityThresholds: EquityThresholds;
};

type SortKey = "initials" | "overall" | "desirability" | "holiday" | "hours" | "workDays" | "leaveDays" | string;

function equityColor(burden: number, t: EquityThresholds): string {
  if (burden > t.high) return "#ef4444";
  if (burden > t.med) return "#f97316";
  if (burden > t.low) return "#eab308";
  if (burden < -t.high) return "#22c55e";
  if (burden < -t.med) return "#3b82f6";
  if (burden < -t.low) return "#6366f1";
  return "#6b7280";
}

function equityLabel(burden: number, t: EquityThresholds): string {
  if (burden > t.high) return "Overworked";
  if (burden > t.med) return "Heavy";
  if (burden > t.low) return "Slightly Heavy";
  if (burden < -t.high) return "Light";
  if (burden < -t.med) return "Easy";
  if (burden < -t.low) return "Slightly Easy";
  return "Balanced";
}

const CHART_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#22c55e", "#06b6d4", "#eab308", "#ef4444"];

function ChartTooltipContent({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs shadow-lg">
      <div className="text-slate-300 font-medium mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="text-slate-200 font-mono">{typeof p.value === "number" ? p.value.toFixed(1) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function deviationColor(value: number): string {
  if (value > 0.3) return "#3b82f6";
  if (value < -0.3) return "#f97316";
  return "#6b7280";
}

function OverviewCharts({ data, trackedShiftCodes }: {
  data: EquityRow[];
  trackedShiftCodes: string[];
}) {
  const equityData = useMemo(() => {
    const values = data.map((d) => -d.deviation.overall);
    const med = median(values);
    return [...data]
      .sort((a, b) => (-b.deviation.overall - med) - (-a.deviation.overall - med))
      .map((d) => {
        const v = parseFloat((-d.deviation.overall - med).toFixed(2));
        return { initials: d.initials, value: v, fill: deviationColor(v) };
      });
  }, [data]);

  const { desirabilityData, desExtent } = useMemo(() => {
    const fteNormed = data.map((d) => d.desirabilityScore / (d.ftePercentage || 1));
    const med = median(fteNormed);
    const rows = [...data]
      .sort((a, b) => (b.desirabilityScore / (b.ftePercentage || 1) - med) - (a.desirabilityScore / (a.ftePercentage || 1) - med))
      .map((d) => {
        const normed = d.desirabilityScore / (d.ftePercentage || 1);
        const v = parseFloat((normed - med).toFixed(1));
        return { initials: d.initials, value: v, fill: deviationColor(v / 10) };
      });
    const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
    return { desirabilityData: rows, desExtent: maxAbs };
  }, [data]);

  const shiftData = useMemo(() => {
    if (trackedShiftCodes.length === 0) return [];
    return [...data].sort((a, b) => a.initials.localeCompare(b.initials)).map((d) => {
      const row: Record<string, string | number> = { initials: d.initials };
      for (const code of trackedShiftCodes) {
        row[code] = d.shiftCounts[code] || 0;
      }
      return row;
    });
  }, [data, trackedShiftCodes]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Overall Workload Balance</h3>
        <p className="text-[10px] text-slate-600 mb-3">Deviation from median — right = lighter load</p>
        <ResponsiveContainer width="100%" height={Math.max(200, data.length * 28 + 40)}>
          <BarChart data={equityData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
            <XAxis type="number" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#334155" }} tickLine={false} />
            <YAxis type="category" dataKey="initials" tick={{ fill: "#94a3b8", fontSize: 11, fontFamily: "monospace" }} width={40} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltipContent />} />
            <ReferenceLine x={0} stroke="#475569" strokeWidth={1} label={{ value: "median", position: "top", fill: "#475569", fontSize: 9 }} />
            <Bar dataKey="value" name="vs Median" radius={[0, 3, 3, 0]} maxBarSize={18}>
              {equityData.map((d, i) => <Cell key={i} fill={d.fill} fillOpacity={0.8} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-slate-600 mt-2">Weighted composite of all enabled equity factors (desirability, holidays, per-shift counts). Each factor is z-scored and FTE-normalized, then combined using the weights from Settings. Zero = department median.</p>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Shift Desirability</h3>
        <p className="text-[10px] text-slate-600 mb-3">FTE-normalized, deviation from median — right = better shifts</p>
        <ResponsiveContainer width="100%" height={Math.max(200, data.length * 28 + 40)}>
          <BarChart data={desirabilityData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
            <XAxis type="number" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#334155" }} tickLine={false} domain={[-desExtent, desExtent]} />
            <YAxis type="category" dataKey="initials" tick={{ fill: "#94a3b8", fontSize: 11, fontFamily: "monospace" }} width={40} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltipContent />} />
            <ReferenceLine x={0} stroke="#475569" strokeWidth={1} label={{ value: "median", position: "top", fill: "#475569", fontSize: 9 }} />
            <Bar dataKey="value" name="vs Median" radius={[0, 3, 3, 0]} maxBarSize={18}>
              {desirabilityData.map((d, i) => (
                <Cell key={i} fill={d.fill} fillOpacity={0.75} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-slate-600 mt-2">Sum of desirability weights for each shift+day-of-week worked, divided by FTE. Weights are configured per shift type and day in Settings &gt; Desirability. Opportunity-adjusted: only compares against shifts the provider is eligible for.</p>
      </div>

      {trackedShiftCodes.length > 0 && (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4 xl:col-span-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Shift Distribution</h3>
          <p className="text-[10px] text-slate-600 mb-3">Raw count of each shift type assigned per provider. Stubs at the baseline indicate zero assignments.</p>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={shiftData} margin={{ left: -10, right: 10, top: 5, bottom: 5 }} barGap={1} barCategoryGap="15%">
              <XAxis dataKey="initials" tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "monospace" }} axisLine={{ stroke: "#334155" }} tickLine={false} interval={0} />
              <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend
                wrapperStyle={{ fontSize: 11, color: "#94a3b8" }}
                iconType="circle"
                iconSize={8}
              />
              {trackedShiftCodes.map((code, i) => (
                <Bar key={code} dataKey={code} name={code} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.75} radius={[2, 2, 0, 0]} minPointSize={3} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function StaffDetailPanel({ row, averages, trackedShiftCodes, equityThresholds, onClose }: {
  row: EquityRow;
  averages: Averages;
  trackedShiftCodes: string[];
  equityThresholds: EquityThresholds;
  onClose: () => void;
}) {
  const eqColor = equityColor(row.deviation.overall, equityThresholds);
  const eqText = equityLabel(row.deviation.overall, equityThresholds);
  const fte = row.ftePercentage;

  const radarData = useMemo(() => {
    const raw: { label: string; provider: number; average: number }[] = [
      { label: "Desirability", provider: Math.abs(row.desirabilityScore), average: Math.abs(averages.desirabilityScore * fte) },
      { label: "Holidays", provider: row.holidayWorkCount, average: averages.holidayWorkCount * fte },
      { label: "Work Days", provider: row.totalWorkDays, average: averages.totalWorkDays * fte },
      { label: "Hours", provider: row.totalHours, average: averages.totalHours * fte },
    ];
    for (const code of trackedShiftCodes) {
      raw.push({
        label: code,
        provider: row.shiftCounts[code] || 0,
        average: (averages.perShift[code] || 0) * fte,
      });
    }
    return raw.map((d) => {
      const scale = d.average || Math.max(d.provider, 1);
      return { label: d.label, provider: (d.provider / scale) * 100, average: 100 };
    });
  }, [row, averages, trackedShiftCodes, fte]);

  const comparisonData = useMemo(() => {
    const items: { label: string; provider: number; average: number; unit: string }[] = [
      { label: "Desirability", provider: row.desirabilityScore, average: parseFloat((averages.desirabilityScore * fte).toFixed(1)), unit: "pts" },
      { label: "Holidays", provider: row.holidayWorkCount, average: parseFloat((averages.holidayWorkCount * fte).toFixed(1)), unit: "" },
      { label: "Hours", provider: row.totalHours, average: parseFloat((averages.totalHours * fte).toFixed(1)), unit: "hrs" },
      { label: "Work Days", provider: row.totalWorkDays, average: parseFloat((averages.totalWorkDays * fte).toFixed(1)), unit: "" },
      { label: "Leave Days", provider: row.totalLeaveDays, average: parseFloat((averages.totalLeaveDays * fte).toFixed(1)), unit: "" },
    ];
    for (const code of trackedShiftCodes) {
      items.push({
        label: `${code} Shifts`,
        provider: row.shiftCounts[code] || 0,
        average: parseFloat(((averages.perShift[code] || 0) * fte).toFixed(1)),
        unit: "",
      });
    }
    return items;
  }, [row, averages, trackedShiftCodes, fte]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-xl bg-slate-900 border-l border-slate-700 shadow-2xl overflow-y-auto animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur border-b border-slate-700 px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold text-lg text-slate-100">{row.initials}</span>
            <span className="text-sm text-slate-400">{row.name}</span>
            {row.ftePercentage < 1 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400/80 font-mono">{(row.ftePercentage * 100).toFixed(0)}% FTE</span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors text-lg px-2">&times;</button>
        </div>

        <div className="p-5 space-y-6">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ backgroundColor: eqColor + "20" }}>
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: eqColor }} />
              <span className="text-sm font-semibold" style={{ color: eqColor }}>{eqText}</span>
            </div>
            <span className="text-xs text-slate-500">Overall score: {row.deviation.overall.toFixed(2)}</span>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Profile vs Department Average</h3>
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={radarData} cx="50%" cy="50%">
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <PolarRadiusAxis tick={false} axisLine={false} domain={[0, "auto"]} />
                  <Radar name="Dept Avg (baseline)" dataKey="average" stroke="#475569" fill="#475569" fillOpacity={0.1} strokeWidth={1.5} strokeDasharray="4 4" />
                  <Radar name={row.initials} dataKey="provider" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={2} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
                </RadarChart>
              </ResponsiveContainer>
              <p className="text-[10px] text-slate-600 mt-2">Each axis shows provider value as % of FTE-adjusted department average (dashed = 100%). Extending beyond the dashed line means above average for that metric.</p>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Category Breakdown</h3>
            <p className="text-[10px] text-slate-600 mb-3">Each bar = provider&apos;s value as % of FTE-adjusted dept average. 100% line = average. Orange = above avg, blue = below, grey = near avg.</p>
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={comparisonData.map((d) => {
                  const scale = d.average || Math.max(Math.abs(d.provider), 1);
                  return { label: d.label, provider: Math.round((d.provider / scale) * 100), average: 100 };
                })} margin={{ left: -10, right: 10, top: 5, bottom: 5 }}>
                  <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={{ stroke: "#334155" }} tickLine={false} interval={0} angle={-30} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <ReferenceLine y={100} stroke="#475569" strokeDasharray="3 3" label={{ value: "Avg", fill: "#64748b", fontSize: 10, position: "right" }} />
                  <Bar dataKey="provider" name={row.initials} fill="#3b82f6" fillOpacity={0.8} radius={[3, 3, 0, 0]} maxBarSize={28}>
                    {comparisonData.map((d, i) => {
                      const scale = d.average || Math.max(Math.abs(d.provider), 1);
                      const pct = (d.provider / scale) * 100;
                      return <Cell key={i} fill={pct > 110 ? "#f97316" : pct < 90 ? "#3b82f6" : "#6b7280"} fillOpacity={0.8} />;
                    })}
                  </Bar>
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {Object.keys(row.deviation.perShift).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Equity Deviations (Z-Score)</h3>
              <p className="text-[10px] text-slate-600 mb-3">Each factor as a z-score (standard deviations from dept mean). FTE-normalized. Desirability is opportunity-adjusted to only count eligible shifts.</p>
              <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
                <ResponsiveContainer width="100%" height={Math.max(150, Object.keys(row.deviation.perShift).length * 36 + 60)}>
                  <BarChart
                    data={(() => {
                      const items = [
                        { label: "Desirability", value: parseFloat((-row.deviation.desirability).toFixed(2)) },
                        { label: "Holidays", value: parseFloat((-row.deviation.holidayWork).toFixed(2)) },
                        ...Object.entries(row.deviation.perShift).map(([code, dev]) => ({
                          label: code,
                          value: parseFloat((-dev).toFixed(2)),
                        })),
                      ];
                      return items.sort((a, b) => b.value - a.value);
                    })()}
                    layout="vertical"
                    margin={{ left: 10, right: 20, top: 5, bottom: 5 }}
                  >
                    <XAxis type="number" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#334155" }} tickLine={false} domain={(() => { const vals = [Math.abs(row.deviation.desirability), Math.abs(row.deviation.holidayWork), ...Object.values(row.deviation.perShift).map(Math.abs)]; const m = Math.ceil(Math.max(...vals, 0.5) * 10) / 10; return [-m, m]; })() as [number, number]} tickFormatter={(v: number) => v.toFixed(1)} />
                    <YAxis type="category" dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} width={80} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltipContent />} />
                    <ReferenceLine x={0} stroke="#475569" strokeWidth={1} label={{ value: "median", position: "top", fill: "#475569", fontSize: 9 }} />
                    <Bar dataKey="value" name="vs Median" radius={[0, 3, 3, 0]} maxBarSize={18}>
                      {(() => {
                        const items = [
                          { value: -row.deviation.desirability },
                          { value: -row.deviation.holidayWork },
                          ...Object.values(row.deviation.perShift).map((v) => ({ value: -v })),
                        ];
                        return items.sort((a, b) => b.value - a.value);
                      })().map((d, i) => (
                        <Cell key={i} fill={deviationColor(d.value)} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-[10px] text-slate-600 mt-2">Right = lighter load. Left = heavier burden.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SortHeader({ label, sortId, className, title, sortKey, sortAsc, onSort }: { label: string; sortId: SortKey; className?: string; title?: string; sortKey: SortKey; sortAsc: boolean; onSort: (key: SortKey) => void }) {
  const active = sortKey === sortId;
  return (
    <th
      className={`py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors select-none whitespace-nowrap ${active ? "text-slate-200" : "text-slate-500"} ${className || ""}`}
      onClick={() => onSort(sortId)}
      title={title}
    >
      {label}{active ? (sortAsc ? " ▲" : " ▼") : ""}
    </th>
  );
}

export function EquityPage({ data, averages, trackedShiftCodes, dateRange, shiftCodes, equityThresholds }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortAsc, setSortAsc] = useState(false);
  const [showTallies, setShowTallies] = useState(false);
  const [showCharts, setShowCharts] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [minFte, setMinFte] = useState(0);

  const filteredData = useMemo(() =>
    minFte > 0 ? data.filter((d) => d.ftePercentage >= minFte) : data,
    [data, minFte],
  );

  const selectedRow = selectedProvider ? filteredData.find((d) => d.providerId === selectedProvider) : null;

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "initials"); }
  }

  const sorted = [...filteredData].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "initials") cmp = a.initials.localeCompare(b.initials);
    else if (sortKey === "overall") cmp = a.deviation.overall - b.deviation.overall;
    else if (sortKey === "desirability") cmp = a.desirabilityScore - b.desirabilityScore;
    else if (sortKey === "holiday") cmp = a.holidayWorkCount - b.holidayWorkCount;
    else if (sortKey === "hours") cmp = a.totalHours - b.totalHours;
    else if (sortKey === "workDays") cmp = a.totalWorkDays - b.totalWorkDays;
    else if (sortKey === "leaveDays") cmp = a.totalLeaveDays - b.totalLeaveDays;
    else if (sortKey.startsWith("shift:")) {
      const code = sortKey.slice(6);
      cmp = (a.shiftCounts[code] || 0) - (b.shiftCounts[code] || 0);
    }
    return sortAsc ? cmp : -cmp;
  });

  const shiftAvgs: Record<string, number> = {};
  for (const code of trackedShiftCodes) {
    const vals = filteredData.map((d) => d.shiftCounts[code] || 0);
    shiftAvgs[code] = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Statistics</h2>
            <p className="text-sm text-slate-400 mt-1">
              {dateRange.min} to {dateRange.max} — {minFte > 0 ? `${filteredData.length} of ${data.length}` : data.length} providers
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCharts(!showCharts)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${showCharts ? "bg-blue-600/20 text-blue-400 border border-blue-500/30" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}
            >
              {showCharts ? "Hide" : "Show"} Charts
            </button>
            <button
              onClick={() => setShowTallies(!showTallies)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${showTallies ? "bg-slate-600 text-slate-200" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}
            >
              {showTallies ? "Hide" : "Show"} Tallies
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-5">
          <label className="text-xs text-slate-500">Min FTE</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="9.999"
            className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-300"
            value={minFte || ""}
            onChange={(e) => setMinFte(parseFloat(e.target.value) || 0)}
            placeholder="0"
          />
          {minFte > 0 && (
            <span className="text-xs text-slate-500">{filteredData.length} of {data.length} providers</span>
          )}
        </div>

        <div className="flex flex-wrap gap-3 mb-5">
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3 min-w-[140px]">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Avg Shift Desirability</div>
            <div className={`text-lg font-semibold tabular-nums ${averages.desirabilityScore < 0 ? "text-red-400" : "text-emerald-400"}`}>
              {averages.desirabilityScore > 0 ? "+" : ""}{averages.desirabilityScore.toFixed(1)}
            </div>
            <div className="text-[10px] text-slate-600">per 1.0 FTE</div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3 min-w-[140px]">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Avg Holidays</div>
            <div className="text-lg font-semibold tabular-nums text-amber-400">
              {averages.holidayWorkCount.toFixed(1)}
            </div>
            <div className="text-[10px] text-slate-600">per 1.0 FTE</div>
          </div>
          {Object.entries(averages.perShift).map(([code, avg]) => (
            <div key={code} className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3 min-w-[140px]">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Avg {code}</div>
              <div className="text-lg font-semibold tabular-nums text-slate-300">
                {avg.toFixed(1)}
              </div>
              <div className="text-[10px] text-slate-600">per 1.0 FTE</div>
            </div>
          ))}
        </div>

        {showCharts && (
          <OverviewCharts
            data={filteredData}
            trackedShiftCodes={trackedShiftCodes}
          />
        )}

        <div className="bg-slate-800/30 border border-slate-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/80 border-b border-slate-700">
                  <SortHeader label="Provider" sortId="initials" className="text-left w-44" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                  <SortHeader label="Equity" sortId="overall" className="text-center w-28" title="Overall workload balance" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                  <SortHeader label="Shift Desirability" sortId="desirability" className="text-right w-28" title="Cumulative shift desirability score" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                  <SortHeader label="Holidays" sortId="holiday" className="text-right w-20" title="Number of holidays worked" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                  {trackedShiftCodes.map((code) => (
                    <SortHeader key={code} label={code} sortId={`shift:${code}`} className="text-right w-16" title={`Total ${code} shifts`} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                  ))}
                  <SortHeader label="Hours" sortId="hours" className="text-right w-20" title="Total FTE-counted hours" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                  <SortHeader label="Work Days" sortId="workDays" className="text-right w-20" title="Total work days" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                  <SortHeader label="Leave Days" sortId="leaveDays" className="text-right w-20" title="Total leave days" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                  {showTallies && shiftCodes.map((code) => (
                    <th key={code} className="px-2 py-2.5 text-[11px] font-medium text-slate-600 text-right whitespace-nowrap">{code}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const eqColor = equityColor(row.deviation.overall, equityThresholds);
                  const eqText = equityLabel(row.deviation.overall, equityThresholds);
                  return (
                    <tr
                      key={row.providerId}
                      className={`border-b border-slate-700/20 hover:bg-slate-800/40 transition-colors cursor-pointer ${selectedProvider === row.providerId ? "bg-blue-900/20" : ""}`}
                      onClick={() => setSelectedProvider(row.providerId)}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-bold text-sm w-9 ${!row.isAutoScheduled ? "text-amber-400" : "text-slate-200"}`}>{row.initials}</span>
                          <span className="text-xs text-slate-500 truncate max-w-[60px]">{row.name}</span>
                          {row.ftePercentage < 1 && (
                            <span className="text-[10px] px-1 py-px rounded bg-amber-900/30 text-amber-400/80 font-mono">{(row.ftePercentage * 100).toFixed(0)}%</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ backgroundColor: eqColor + "15" }}>
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: eqColor }} />
                          <span className="text-[11px] font-medium whitespace-nowrap" style={{ color: eqColor }}>{eqText}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`text-sm font-medium tabular-nums ${row.desirabilityScore > 0 ? "text-emerald-400" : row.desirabilityScore < 0 ? "text-red-400" : "text-slate-600"}`}>
                          {row.desirabilityScore > 0 ? "+" : ""}{row.desirabilityScore}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`text-sm tabular-nums ${row.holidayWorkCount > 0 ? "text-amber-400" : "text-slate-600"}`}>
                          {row.holidayWorkCount}
                        </span>
                      </td>
                      {trackedShiftCodes.map((code) => {
                        const val = row.shiftCounts[code] || 0;
                        const avg = shiftAvgs[code] || 0;
                        const diff = val - avg;
                        return (
                          <td key={code} className="px-3 py-2.5 text-right">
                            <span className={`text-sm tabular-nums ${Math.abs(diff) > avg * 0.3 ? (diff > 0 ? "text-red-400" : "text-blue-400") : "text-slate-400"}`}>
                              {val}
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-sm tabular-nums text-blue-300 font-medium">
                          {row.totalHours.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-sm tabular-nums text-slate-300">{row.totalWorkDays}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`text-sm tabular-nums ${row.totalLeaveDays > 0 ? "text-slate-400" : "text-slate-600"}`}>{row.totalLeaveDays}</span>
                      </td>
                      {showTallies && shiftCodes.map((code) => (
                        <td key={code} className="px-2 py-2.5 text-right">
                          <span className={`text-[11px] tabular-nums ${row.shiftTally[code] ? "text-slate-500" : "text-slate-700"}`}>
                            {row.shiftTally[code] || "—"}
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedRow && (
        <StaffDetailPanel
          row={selectedRow}
          averages={averages}
          trackedShiftCodes={trackedShiftCodes}
          equityThresholds={equityThresholds}
          onClose={() => setSelectedProvider(null)}
        />
      )}
    </div>
  );
}
