"use client";

import { useState } from "react";
import type { GraphDateRange } from "@/lib/graph/spec";
import type { PayPeriodRef } from "@/lib/graph/filter";

type Mode = "all" | "periods" | "custom";

/**
 * Initial display mode from the value. Note "all" and an empty custom range
 * encode identically (`{kind:"custom", start:"", end:""}`), so once mounted the
 * segmented mode is tracked as local UI state — otherwise selecting "Custom"
 * (which starts empty) would be indistinguishable from "All dates" and the
 * date inputs would never appear.
 */
function modeOf(range: GraphDateRange): Mode {
  if (range.kind === "payPeriods") return "periods";
  if (!range.start && !range.end) return "all";
  return "custom";
}

/** "6/1 – 6/14" from two ISO YYYY-MM-DD strings (no Date, timezone-free). */
function ppLabel(startDate: string, endDate: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${Number(m)}/${Number(d)}`;
  };
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}

const SEG: { mode: Mode; label: string }[] = [
  { mode: "all", label: "All dates" },
  { mode: "periods", label: "Pay periods" },
  { mode: "custom", label: "Custom" },
];

export function DateRangePicker({
  value,
  payPeriods,
  onChange,
}: {
  value: GraphDateRange;
  payPeriods: PayPeriodRef[];
  onChange: (r: GraphDateRange) => void;
}) {
  const [mode, setMode] = useState<Mode>(() => modeOf(value));

  function selectMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    if (next === "all") onChange({ kind: "custom", start: "", end: "" });
    else if (next === "periods") onChange({ kind: "payPeriods", payPeriodIds: [] });
    // "custom": start an empty custom range for the user to fill (only needed
    // when coming from "periods"; an existing custom value is left intact).
    else if (value.kind !== "custom") onChange({ kind: "custom", start: "", end: "" });
  }

  function togglePeriod(id: string) {
    if (value.kind !== "payPeriods") return;
    const set = new Set(value.payPeriodIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange({ kind: "payPeriods", payPeriodIds: [...set] });
  }

  const selected = value.kind === "payPeriods" ? new Set(value.payPeriodIds) : new Set<string>();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 w-16">Dates</span>
        <div className="flex rounded overflow-hidden border border-slate-700">
          {SEG.map((s) => (
            <button
              key={s.mode}
              onClick={() => selectMode(s.mode)}
              className={`px-2.5 py-1 text-[11px] transition-colors ${mode === s.mode ? "bg-blue-600/30 text-blue-300" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {mode === "periods" && (
        <div className="flex flex-wrap gap-1.5 pl-[72px]">
          {payPeriods.length === 0 && <span className="text-[11px] text-slate-600">No pay periods defined</span>}
          {payPeriods.map((pp) => {
            const active = selected.has(pp.id);
            return (
              <button
                key={pp.id}
                onClick={() => togglePeriod(pp.id)}
                className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${active ? "bg-blue-600/20 text-blue-300 border-blue-500/40" : "bg-slate-800 text-slate-500 border-slate-700 hover:bg-slate-700"}`}
              >
                {ppLabel(pp.startDate, pp.endDate)}
              </button>
            );
          })}
        </div>
      )}

      {mode === "custom" && value.kind === "custom" && (
        <div className="flex items-center gap-2 pl-[72px]">
          <input
            type="date"
            value={value.start}
            onChange={(e) => onChange({ kind: "custom", start: e.target.value, end: value.end })}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
          />
          <span className="text-xs text-slate-500">to</span>
          <input
            type="date"
            value={value.end}
            onChange={(e) => onChange({ kind: "custom", start: value.start, end: e.target.value })}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
          />
        </div>
      )}
    </div>
  );
}
