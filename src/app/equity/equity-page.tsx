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

function equityColor(burden: number): string {
  if (burden > 1.5) return "#ef4444";
  if (burden > 0.75) return "#f97316";
  if (burden > 0.25) return "#eab308";
  if (burden < -1.5) return "#22c55e";
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

export function EquityPage({ data, averages, dateRange, shiftCodes }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortAsc, setSortAsc] = useState(false);
  const [showTallies, setShowTallies] = useState(false);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "initials"); }
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

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-4 max-w-[1200px]">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-200">Provider Statistics</h2>
            <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
              <span>{dateRange.min} to {dateRange.max}</span>
              <span>{data.length} providers</span>
              <span>Avg: CALL {averages.weekendCallCount.toFixed(1)} | ORC {averages.weekdayOrcCount.toFixed(1)} | ORL {averages.weekdayOrlCount.toFixed(1)} | Holiday {averages.holidayWorkCount.toFixed(1)}</span>
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
                <SortHeader label="CALL" sortId="weekendCall" className="text-right" />
                <SortHeader label="ORC" sortId="orc" className="text-right" />
                <SortHeader label="ORL" sortId="orl" className="text-right" />
                <SortHeader label="Hol" sortId="holiday" className="text-right" />
                <SortHeader label="Desir" sortId="desirability" className="text-right" />
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
                const eqColor = equityColor(row.deviation.overall);
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
                        <span className="text-[11px] font-medium" style={{ color: eqColor }}>{equityLabel(row.deviation.overall)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.takesCall ? <Num value={row.weekendCallCount} color="#a78bfa" /> : <Num value={0} dim />}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.takesCall ? <Num value={row.weekdayOrcCount} color="#fb923c" /> : <Num value={0} dim />}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.takesLate ? <Num value={row.weekdayOrlCount} color="#22d3ee" /> : <Num value={0} dim />}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Num value={row.holidayWorkCount} color="#facc15" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={`text-xs font-medium tabular-nums ${row.desirabilityScore > 0 ? "text-emerald-400" : row.desirabilityScore < 0 ? "text-red-400" : "text-slate-600"}`}>
                        {row.desirabilityScore > 0 ? "+" : ""}{row.desirabilityScore}
                      </span>
                    </td>
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
