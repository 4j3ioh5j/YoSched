"use client";

import { type WhenPattern, describeWhen } from "@/lib/recurrence";

// Sentence-builder for the unified WHEN axis (which occurrences a rule lands on).
// Owns the weekday set + the occurrence qualifier; the parent owns persistence
// (it derives when*/legacy columns from the WhenPattern via whenToColumns /
// whenToLegacy) and the orthogonal type/strength/condition fields.

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_INDICES = [0, 1, 2, 3, 4, 5, 6];

const ORDINALS: { value: number; label: string }[] = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: 5, label: "5th" },
  { value: -1, label: "Last" },
];

type KindOption =
  | "every"
  | "pp_week_1"
  | "pp_week_2"
  | "ordinalMonth"
  | "ordinalPayPeriod"
  | "cycle_week"
  | "cycle_pp";

const KIND_OPTIONS: { value: KindOption; label: string }[] = [
  { value: "every", label: "Every week" },
  { value: "pp_week_1", label: "Pay-period week 1 only" },
  { value: "pp_week_2", label: "Pay-period week 2 only" },
  { value: "ordinalMonth", label: "Specific weeks of the month…" },
  { value: "ordinalPayPeriod", label: "Specific weeks of the pay period…" },
  { value: "cycle_week", label: "Every N weeks…" },
  { value: "cycle_pp", label: "Every N pay periods…" },
];

function kindOptionOf(w: WhenPattern): KindOption {
  switch (w.kind) {
    case "ppWeek":
      return w.ppWeek === 2 ? "pp_week_2" : "pp_week_1";
    case "ordinalMonth":
      return "ordinalMonth";
    case "ordinalPayPeriod":
      return "ordinalPayPeriod";
    case "cycle":
      return w.cycleUnit === "payPeriod" ? "cycle_pp" : "cycle_week";
    default:
      return "every";
  }
}

// Switch the occurrence qualifier while preserving the chosen weekdays and any
// reusable sub-values (ordinals, cycle N/offset), so toggling between modes is
// non-destructive.
function applyKindOption(w: WhenPattern, opt: KindOption): WhenPattern {
  const daysOfWeek = w.daysOfWeek ?? [];
  const ords = w.ords && w.ords.length > 0 ? w.ords : [1];
  const cycleN = w.cycleN && w.cycleN >= 1 ? w.cycleN : 2;
  const cycleOffset = w.cycleOffset ?? 0;
  switch (opt) {
    case "every":
      return { daysOfWeek, kind: "every" };
    case "pp_week_1":
      return { daysOfWeek, kind: "ppWeek", ppWeek: 1 };
    case "pp_week_2":
      return { daysOfWeek, kind: "ppWeek", ppWeek: 2 };
    case "ordinalMonth":
      return { daysOfWeek, kind: "ordinalMonth", ords };
    case "ordinalPayPeriod":
      return { daysOfWeek, kind: "ordinalPayPeriod", ords };
    case "cycle_week":
      return { daysOfWeek, kind: "cycle", cycleUnit: "week", cycleN, cycleOffset: Math.min(cycleOffset, cycleN - 1) };
    case "cycle_pp":
      return { daysOfWeek, kind: "cycle", cycleUnit: "payPeriod", cycleN, cycleOffset: Math.min(cycleOffset, cycleN - 1) };
  }
}

export function RecurrencePicker({
  value,
  onChange,
}: {
  value: WhenPattern;
  onChange: (w: WhenPattern) => void;
}) {
  const days = value.daysOfWeek ?? [];
  const kindOpt = kindOptionOf(value);
  const isOrdinal = value.kind === "ordinalMonth" || value.kind === "ordinalPayPeriod";
  const isCycle = value.kind === "cycle";
  const cycleN = Math.max(1, Math.floor(value.cycleN ?? 2));

  function toggleDay(d: number) {
    if (days.includes(d)) {
      // Keep at least one weekday — an empty set means "any day" in the model,
      // which would silently fire the rule every day. The user swaps by adding
      // the new day first, then removing the old.
      if (days.length === 1) return;
      onChange({ ...value, daysOfWeek: days.filter((x) => x !== d) });
    } else {
      onChange({ ...value, daysOfWeek: [...days, d].sort((a, b) => a - b) });
    }
  }

  function toggleOrd(ord: number) {
    const cur = value.ords ?? [];
    const next = cur.includes(ord) ? cur.filter((x) => x !== ord) : [...cur, ord];
    // Keep at least one ordinal selected so the rule stays meaningful.
    onChange({ ...value, ords: next.length > 0 ? next : cur });
  }

  return (
    <div className="space-y-2">
      {/* Weekday chips */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-slate-500 text-xs mr-0.5">On</span>
        {DAY_INDICES.map((d) => {
          const on = days.includes(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={[
                "w-9 h-7 text-xs rounded font-medium transition-colors border",
                on
                  ? "bg-blue-600/50 text-blue-200 border-blue-500/50"
                  : "bg-slate-700 text-slate-500 border-slate-600 hover:brightness-125",
              ].join(" ")}
            >
              {DAY_LABELS[d]}
            </button>
          );
        })}
      </div>
      {days.length === 0 && (
        <div className="text-[10px] text-amber-400/80 pl-1">Pick at least one weekday.</div>
      )}

      {/* Occurrence qualifier */}
      <div className="flex items-center gap-1.5 text-xs flex-wrap">
        <select
          className="bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-xs text-slate-200"
          value={kindOpt}
          onChange={(e) => onChange(applyKindOption(value, e.target.value as KindOption))}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Cycle N + offset */}
        {isCycle && (
          <>
            <span className="text-slate-500">repeat every</span>
            <input
              type="number"
              min={1}
              max={12}
              value={cycleN}
              onChange={(e) => {
                const n = Math.max(1, parseInt(e.target.value) || 1);
                onChange({ ...value, cycleN: n, cycleOffset: Math.min(value.cycleOffset ?? 0, n - 1) });
              }}
              className="w-12 bg-slate-700 border border-slate-600 rounded px-1 py-1 text-xs text-center text-slate-200"
            />
            <span className="text-slate-500">{value.cycleUnit === "payPeriod" ? "pay periods, slot" : "weeks, slot"}</span>
            <select
              className="bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-xs text-slate-200"
              value={value.cycleOffset ?? 0}
              onChange={(e) => onChange({ ...value, cycleOffset: parseInt(e.target.value) })}
            >
              {Array.from({ length: cycleN }, (_, i) => (
                <option key={i} value={i}>{i + 1}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Ordinal chips */}
      {isOrdinal && (
        <div className="flex items-center gap-1 flex-wrap pl-1">
          <span className="text-slate-500 text-xs mr-0.5">Which:</span>
          {ORDINALS.map((o) => {
            const on = (value.ords ?? []).includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggleOrd(o.value)}
                className={[
                  "px-2 h-7 text-xs rounded font-medium transition-colors border",
                  on
                    ? "bg-blue-600/50 text-blue-200 border-blue-500/50"
                    : "bg-slate-700 text-slate-500 border-slate-600 hover:brightness-125",
                ].join(" ")}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Live sentence */}
      <div className="text-[10px] text-slate-400 italic pl-1">{describeWhen(value)}</div>
    </div>
  );
}
