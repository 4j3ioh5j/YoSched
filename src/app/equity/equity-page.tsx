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
  takesWeekendCall: boolean;
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
  if (burden > t.high) return "Overworked";
  if (burden > t.med) return "Heavy";
  if (burden > t.low) return "Slightly Heavy";
  if (burden < -t.high) return "Light";
  if (burden < -t.med) return "Easy";
  if (burden < -t.low) return "Slightly Easy";
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

  const shiftAvgs: Record<string, number> = {};
  for (const code of trackedShiftCodes) {
    const vals = data.map((d) => d.shiftCounts[code] || 0);
    shiftAvgs[code] = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  }

  function SortHeader({ label, sortId, className, title }: { label: string; sortId: SortKey; className?: string; title?: string }) {
    const active = sortKey === sortId;
    return (
      <th
        className={`py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors select-none whitespace-nowrap ${active ? "text-slate-200" : "text-slate-500"} ${className || ""}`}
        onClick={() => handleSort(sortId)}
        title={title}
      >
        {label}{active ? (sortAsc ? " ▲" : " ▼") : ""}
      </th>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Workload Equity</h2>
            <p className="text-sm text-slate-400 mt-1">
              {dateRange.min} to {dateRange.max} — {data.length} providers
            </p>
          </div>
          <button
            onClick={() => setShowTallies(!showTallies)}
            className={`px-3 py-1.5 text-xs rounded transition-colors ${showTallies ? "bg-slate-600 text-slate-200" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}
          >
            {showTallies ? "Hide" : "Show"} Tallies
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Avg Desirability</div>
            <div className={`text-lg font-semibold tabular-nums ${averages.desirabilityScore < 0 ? "text-red-400" : "text-emerald-400"}`}>
              {averages.desirabilityScore > 0 ? "+" : ""}{averages.desirabilityScore.toFixed(1)}
            </div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Avg Holidays</div>
            <div className="text-lg font-semibold tabular-nums text-amber-400">
              {averages.holidayWorkCount.toFixed(1)}
            </div>
          </div>
          {trackedShiftCodes.slice(0, 2).map((code) => (
            <div key={code} className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Avg {code}</div>
              <div className="text-lg font-semibold tabular-nums text-slate-300">
                {shiftAvgs[code]?.toFixed(1)}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-slate-800/30 border border-slate-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/80 border-b border-slate-700">
                  <SortHeader label="Provider" sortId="initials" className="text-left w-44" />
                  <SortHeader label="Equity" sortId="overall" className="text-center w-28" title="Overall workload balance" />
                  <SortHeader label="Desirability" sortId="desirability" className="text-right w-24" title="Cumulative shift desirability score" />
                  <SortHeader label="Holidays" sortId="holiday" className="text-right w-20" title="Number of holidays worked" />
                  {trackedShiftCodes.map((code) => (
                    <SortHeader key={code} label={code} sortId={`shift:${code}`} className="text-right w-16" title={`Total ${code} shifts`} />
                  ))}
                  <SortHeader label="Hours" sortId="hours" className="text-right w-20" title="Total FTE-counted hours" />
                  <SortHeader label="Work Days" sortId="workDays" className="text-right w-20" title="Total work days" />
                  <SortHeader label="Leave Days" sortId="leaveDays" className="text-right w-20" title="Total leave days" />
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
                    <tr key={row.providerId} className="border-b border-slate-700/20 hover:bg-slate-800/40 transition-colors">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-bold text-sm w-9 ${!row.isAutoScheduled ? "text-amber-400" : "text-slate-200"}`}>{row.initials}</span>
                          <span className="text-xs text-slate-500 truncate max-w-[60px]">{row.name}</span>
                          {row.ftePercentage < 1 && (
                            <span className="text-[10px] px-1 py-px rounded bg-amber-900/30 text-amber-400/80 font-mono">{(row.ftePercentage * 100).toFixed(0)}%</span>
                          )}
                          {!row.takesCall && <span className="text-[10px] px-1 py-px rounded bg-slate-700/50 text-slate-500">no ORC</span>}
                          {!row.takesWeekendCall && <span className="text-[10px] px-1 py-px rounded bg-slate-700/50 text-slate-500">no wknd</span>}
                          {!row.takesLate && <span className="text-[10px] px-1 py-px rounded bg-slate-700/50 text-slate-500">no late</span>}
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
    </div>
  );
}
