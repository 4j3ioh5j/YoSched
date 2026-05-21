"use client";

import { useState } from "react";

type Deviation = {
  desirability: number;
  holidayWork: number;
  overall: number;
};

type EquityRow = {
  providerId: string;
  initials: string;
  name: string;
  isAutoScheduled: boolean;
  ftePercentage: number;
  takesCall: boolean;
  takesLate: boolean;
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

type Props = {
  data: EquityRow[];
  averages: {
    desirabilityScore: number;
    holidayWorkCount: number;
  };
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
  if (burden > t.high) return "Low";
  if (burden > t.med) return "Below Avg";
  if (burden > t.low) return "Slight -";
  if (burden < -t.high) return "High";
  if (burden < -t.med) return "Above Avg";
  if (burden < -t.low) return "Slight +";
  return "Balanced";
}

export function EquityPage({ data, averages, trackedShiftCodes, dateRange, shiftCodes, equityThresholds }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortAsc, setSortAsc] = useState(false);
  const [showTallies, setShowTallies] = useState(false);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "initials"); }
  }

  const sorted = [...data].sort((a, b) => {
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

  function SortHeader({ label, sortId, className }: { label: string; sortId: SortKey; className?: string }) {
    const active = sortKey === sortId;
    return (
      <th
        className={`py-2 px-3 text-[11px] font-medium uppercase tracking-wider text-slate-500 cursor-pointer hover:text-slate-300 transition-colors select-none ${className || ""}`}
        onClick={() => handleSort(sortId)}
      >
        {label}{active ? (sortAsc ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  function Num({ value, color, dim }: { value: number; color?: string; dim?: boolean }) {
    return (
      <span className={`text-xs tabular-nums ${dim ? "text-slate-600" : ""}`} style={dim ? undefined : { color }}>
        {value}
      </span>
    );
  }

  const shiftAvgs: Record<string, number> = {};
  for (const code of trackedShiftCodes) {
    const vals = data.map((d) => d.shiftCounts[code] || 0);
    shiftAvgs[code] = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-4 max-w-[1200px]">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-200">Provider Statistics</h2>
            <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
              <span>{dateRange.min} to {dateRange.max}</span>
              <span>{data.length} providers</span>
              <span>
                Avg desirability: {averages.desirabilityScore > 0 ? "+" : ""}{averages.desirabilityScore.toFixed(1)}
                {" | "}Holiday: {averages.holidayWorkCount.toFixed(1)}
                {trackedShiftCodes.length > 0 && (
                  <> | {trackedShiftCodes.map((c) => `${c} ${shiftAvgs[c]?.toFixed(1)}`).join(" | ")}</>
                )}
              </span>
            </div>
          </div>
          <button
            onClick={() => setShowTallies(!showTallies)}
            className={`px-3 py-1.5 text-xs rounded transition-colors ${showTallies ? "bg-slate-600 text-slate-200" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}
          >
            {showTallies ? "Hide" : "Show"} Tallies
          </button>
        </div>

        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-800/80 border-b border-slate-700">
                <SortHeader label="Provider" sortId="initials" className="text-left" />
                <SortHeader label="Equity" sortId="overall" className="text-center" />
                <SortHeader label="Desir" sortId="desirability" className="text-right" />
                <SortHeader label="Hol" sortId="holiday" className="text-right" />
                {trackedShiftCodes.map((code) => (
                  <SortHeader key={code} label={code} sortId={`shift:${code}`} className="text-right" />
                ))}
                <SortHeader label="Hours" sortId="hours" className="text-right" />
                <SortHeader label="Work" sortId="workDays" className="text-right" />
                <SortHeader label="Leave" sortId="leaveDays" className="text-right" />
                {showTallies && shiftCodes.map((code) => (
                  <th key={code} className="px-2 py-2 text-[11px] font-medium text-slate-600 text-right">{code}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const eqColor = equityColor(row.deviation.overall, equityThresholds);
                return (
                  <tr key={row.providerId} className="border-b border-slate-700/30 hover:bg-slate-800/40 transition-colors">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-200 w-8">{row.initials}</span>
                        <span className="text-xs text-slate-500">{row.name}</span>
                        {row.ftePercentage < 1 && (
                          <span className="text-[10px] text-amber-400/70">{(row.ftePercentage * 100).toFixed(0)}%</span>
                        )}
                        {!row.takesCall && <span className="text-[10px] text-slate-600">no call</span>}
                        {!row.takesLate && <span className="text-[10px] text-slate-600">no late</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{ backgroundColor: eqColor + "18" }}>
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: eqColor }} />
                        <span className="text-[11px] font-medium" style={{ color: eqColor }}>{equityLabel(row.deviation.overall, equityThresholds)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={`text-xs font-medium tabular-nums ${row.desirabilityScore > 0 ? "text-emerald-400" : row.desirabilityScore < 0 ? "text-red-400" : "text-slate-600"}`}>
                        {row.desirabilityScore > 0 ? "+" : ""}{row.desirabilityScore}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Num value={row.holidayWorkCount} color="#facc15" />
                    </td>
                    {trackedShiftCodes.map((code) => (
                      <td key={code} className="px-3 py-2 text-right">
                        <Num value={row.shiftCounts[code] || 0} color="#94a3b8" />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right">
                      <Num value={row.totalHours} color="#93c5fd" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Num value={row.totalWorkDays} color="#cbd5e1" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Num value={row.totalLeaveDays} color="#94a3b8" />
                    </td>
                    {showTallies && shiftCodes.map((code) => (
                      <td key={code} className="px-2 py-2 text-right">
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {row.shiftTally[code] || ""}
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
  );
}
