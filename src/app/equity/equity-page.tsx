"use client";

import { useState } from "react";

type Deviation = {
  weekendCall: number;
  weekdayOrc: number;
  weekdayOrl: number;
  holidayWork: number;
  desirability: number;
  overall: number;
};

type EquityRow = {
  providerId: string;
  initials: string;
  name: string;
  employmentType: string;
  ftePercentage: number;
  takesCall: boolean;
  takesLate: boolean;
  weekendCallCount: number;
  weekdayOrcCount: number;
  weekdayOrlCount: number;
  holidayWorkCount: number;
  desirabilityScore: number;
  undesirableShiftCount: number;
  desirableShiftCount: number;
  totalWorkDays: number;
  totalLeaveDays: number;
  totalHours: number;
  deviation: Deviation;
  shiftTally: Record<string, number>;
};

type Props = {
  data: EquityRow[];
  averages: {
    weekendCallCount: number;
    weekdayOrcCount: number;
    weekdayOrlCount: number;
    holidayWorkCount: number;
    desirabilityScore: number;
  };
  dateRange: { min: string; max: string };
  shiftCodes: string[];
};

type SortKey = "initials" | "overall" | "weekendCall" | "orc" | "orl" | "holiday" | "desirability" | "hours" | "workDays" | "leaveDays";

// Equity: high = good deal (fewer undesirable shifts), low = overworked
// The underlying deviation is burden-based (positive = more burden), so we negate for equity display
function equityColor(burden: number): string {
  if (burden > 1.5) return "#ef4444";   // low equity (heavy burden)
  if (burden > 0.75) return "#f97316";
  if (burden > 0.25) return "#eab308";
  if (burden < -1.5) return "#22c55e";  // high equity (light burden)
  if (burden < -0.75) return "#3b82f6";
  if (burden < -0.25) return "#6366f1";
  return "#6b7280";
}

function equityLabel(burden: number): string {
  if (burden > 1.5) return "Low";
  if (burden > 0.75) return "Below Avg";
  if (burden > 0.25) return "Slight -";
  if (burden < -1.5) return "High";
  if (burden < -0.75) return "Above Avg";
  if (burden < -0.25) return "Slight +";
  return "Balanced";
}

function EquityCell({ burden, showLabel }: { burden: number; showLabel?: boolean }) {
  const color = equityColor(burden);
  const label = equityLabel(burden);
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {showLabel && (
        <span className="text-xs" style={{ color }}>{label}</span>
      )}
    </div>
  );
}

function StatBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-slate-300 tabular-nums">{value}</span>
    </div>
  );
}

export function EquityPage({ data, averages, dateRange, shiftCodes }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortAsc, setSortAsc] = useState(false);
  const [showTallies, setShowTallies] = useState(false);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "initials");
    }
  }

  const sorted = [...data].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "initials": cmp = a.initials.localeCompare(b.initials); break;
      case "overall": cmp = a.deviation.overall - b.deviation.overall; break;
      case "weekendCall": cmp = a.weekendCallCount - b.weekendCallCount; break;
      case "orc": cmp = a.weekdayOrcCount - b.weekdayOrcCount; break;
      case "orl": cmp = a.weekdayOrlCount - b.weekdayOrlCount; break;
      case "holiday": cmp = a.holidayWorkCount - b.holidayWorkCount; break;
      case "desirability": cmp = a.desirabilityScore - b.desirabilityScore; break;
      case "hours": cmp = a.totalHours - b.totalHours; break;
      case "workDays": cmp = a.totalWorkDays - b.totalWorkDays; break;
      case "leaveDays": cmp = a.totalLeaveDays - b.totalLeaveDays; break;
    }
    return sortAsc ? cmp : -cmp;
  });

  const maxCall = Math.max(...data.map((d) => d.weekendCallCount), 1);
  const maxOrc = Math.max(...data.map((d) => d.weekdayOrcCount), 1);
  const maxOrl = Math.max(...data.map((d) => d.weekdayOrlCount), 1);
  const maxHol = Math.max(...data.map((d) => d.holidayWorkCount), 1);
  const maxHours = Math.max(...data.map((d) => d.totalHours), 1);

  function SortHeader({ label, sortId, className }: { label: string; sortId: SortKey; className?: string }) {
    const active = sortKey === sortId;
    return (
      <th
        className={`px-3 py-2 text-xs font-medium text-slate-400 cursor-pointer hover:text-slate-200 transition-colors select-none ${className || ""}`}
        onClick={() => handleSort(sortId)}
      >
        {label} {active ? (sortAsc ? "↑" : "↓") : ""}
      </th>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-200">Provider Statistics</h2>
            <p className="text-sm text-slate-500">
              {dateRange.min} to {dateRange.max} — {data.length} providers
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowTallies(!showTallies)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${showTallies ? "bg-slate-600 text-slate-200" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}
            >
              {showTallies ? "Hide" : "Show"} Shift Tallies
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">Avg Wknd CALL</div>
            <div className="text-lg font-semibold text-slate-200">{averages.weekendCallCount.toFixed(1)}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">Avg ORC</div>
            <div className="text-lg font-semibold text-slate-200">{averages.weekdayOrcCount.toFixed(1)}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">Avg ORL</div>
            <div className="text-lg font-semibold text-slate-200">{averages.weekdayOrlCount.toFixed(1)}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">Avg Holiday Work</div>
            <div className="text-lg font-semibold text-slate-200">{averages.holidayWorkCount.toFixed(1)}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">Avg Desirability</div>
            <div className="text-lg font-semibold text-slate-200">
              {averages.desirabilityScore > 0 ? "+" : ""}{averages.desirabilityScore.toFixed(1)}
            </div>
          </div>
        </div>

        {/* Main table */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-800 border-b border-slate-700">
                <SortHeader label="Provider" sortId="initials" className="text-left w-[140px]" />
                <SortHeader label="Equity" sortId="overall" className="text-center w-[100px]" />
                <SortHeader label="Wknd CALL" sortId="weekendCall" className="text-left" />
                <SortHeader label="ORC" sortId="orc" className="text-left" />
                <SortHeader label="ORL" sortId="orl" className="text-left" />
                <SortHeader label="Holiday" sortId="holiday" className="text-left" />
                <SortHeader label="Desirability" sortId="desirability" className="text-center" />
                <SortHeader label="Hours" sortId="hours" className="text-left" />
                <SortHeader label="Work Days" sortId="workDays" className="text-center" />
                <SortHeader label="Leave" sortId="leaveDays" className="text-center" />
                {showTallies && shiftCodes.map((code) => (
                  <th key={code} className="px-2 py-2 text-xs font-medium text-slate-500 text-center">{code}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.providerId} className="border-b border-slate-700/50 hover:bg-slate-800/30 transition-colors">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-200">{row.initials}</span>
                      <span className="text-xs text-slate-500">{row.name}</span>
                      {row.ftePercentage < 1 && (
                        <span className="text-[10px] text-amber-400">{(row.ftePercentage * 100).toFixed(0)}%</span>
                      )}
                    </div>
                    <div className="flex gap-2 mt-0.5">
                      {!row.takesCall && <span className="text-[10px] text-slate-600">no call</span>}
                      {!row.takesLate && <span className="text-[10px] text-slate-600">no late</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <EquityCell burden={row.deviation.overall} showLabel />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {row.takesCall ? (
                      <StatBar value={row.weekendCallCount} max={maxCall} color="#8b5cf6" />
                    ) : (
                      <span className="text-xs text-slate-600">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {row.takesCall ? (
                      <StatBar value={row.weekdayOrcCount} max={maxOrc} color="#f97316" />
                    ) : (
                      <span className="text-xs text-slate-600">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {row.takesLate ? (
                      <StatBar value={row.weekdayOrlCount} max={maxOrl} color="#06b6d4" />
                    ) : (
                      <span className="text-xs text-slate-600">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatBar value={row.holidayWorkCount} max={maxHol} color="#eab308" />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-xs font-medium tabular-nums ${row.desirabilityScore > 0 ? "text-emerald-400" : row.desirabilityScore < 0 ? "text-red-400" : "text-slate-500"}`}>
                      {row.desirabilityScore > 0 ? "+" : ""}{row.desirabilityScore}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatBar value={row.totalHours} max={maxHours} color="#3b82f6" />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="text-xs text-slate-300 tabular-nums">{row.totalWorkDays}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="text-xs text-slate-400 tabular-nums">{row.totalLeaveDays}</span>
                  </td>
                  {showTallies && shiftCodes.map((code) => (
                    <td key={code} className="px-2 py-2.5 text-center">
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        {row.shiftTally[code] || ""}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
