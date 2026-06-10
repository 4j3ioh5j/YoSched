"use client";

import { useMemo } from "react";
import { shapeHeatmap, type HeatmapInput } from "@/lib/graph/series";
import { heatmapTempColor, type EquityThresholds } from "@/lib/fairness";

/**
 * Shift-codes × staff equity heatmap. Rows (y-axis) are the tracked shift
 * codes plus an optional "Holidays" row; columns (x-axis) are the staff. Each
 * cell shows the raw count, tinted by the staff's FTE-normalized per-shift
 * z-score via `heatmapTempColor()` — a yellow→red temperature ramp (yellow =
 * below average burden, red = above). The shaping/selection logic is the pure
 * `shapeHeatmap`; this component is the thin view + color mapping.
 */
export function HeatmapView({
  data,
  codes,
  opportunityAdjusted,
  includeHolidays = false,
  thresholds,
  onSelect,
  setTip,
}: {
  data: HeatmapInput[];
  codes: string[];
  opportunityAdjusted: boolean;
  includeHolidays?: boolean;
  thresholds: EquityThresholds;
  onSelect?: (initials: string) => void;
  setTip?: (t: { text: string; x: number; y: number } | null) => void;
}) {
  const rows = useMemo(
    () => shapeHeatmap(data, codes, opportunityAdjusted, includeHolidays),
    [data, codes, opportunityAdjusted, includeHolidays],
  );

  // y-axis categories: shift codes, then Holidays (mirrors shapeHeatmap's cell order).
  const categories = useMemo(
    () => (includeHolidays ? [...codes, "Holidays"] : codes),
    [codes, includeHolidays],
  );

  if (categories.length === 0 || rows.length === 0) return null;

  // First column holds the category label; one 3rem column per staff.
  const gridTemplateColumns = `5rem repeat(${rows.length}, 3rem)`;

  return (
    <div className="mb-6">
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Equity Heatmap{opportunityAdjusted ? " — opportunity-adjusted" : ""}
        </h3>

        <div className="overflow-x-auto">
          <div className="inline-grid gap-px" style={{ gridTemplateColumns }}>
            {/* header row — staff initials across the top */}
            <div className="h-8" />
            {rows.map((r) => (
              <div
                key={r.initials}
                className="h-8 text-[11px] font-mono font-bold text-slate-300 flex items-end justify-center pb-1 cursor-pointer hover:text-slate-100 truncate"
                onClick={() => onSelect?.(r.initials)}
              >
                {r.initials}
              </div>
            ))}

            {/* one row per category (shift code / Holidays) */}
            {categories.map((category, ci) => (
              <div key={category} className="contents">
                <div className="h-[2.7rem] text-[11px] font-mono font-bold text-slate-300 flex items-center pr-2 truncate">
                  {category}
                </div>
                {rows.map((r) => {
                  const cell = r.cells[ci];
                  const color = heatmapTempColor(cell.deviation, thresholds);
                  return (
                    <div
                      key={r.initials}
                      className="h-[2.7rem] w-12 flex items-center justify-center text-[11px] font-semibold tabular-nums rounded-sm cursor-default"
                      style={{ backgroundColor: color, color: "#0f172a" }}
                      onMouseEnter={
                        setTip
                          ? (e) => {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setTip({
                                text: `${r.initials} · ${cell.code}\nCount ${cell.count} · z ${cell.deviation >= 0 ? "+" : ""}${cell.deviation.toFixed(2)}`,
                                x: rect.left + rect.width / 2,
                                y: rect.bottom + 4,
                              });
                            }
                          : undefined
                      }
                      onMouseLeave={setTip ? () => setTip(null) : undefined}
                    >
                      {cell.count || ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <p className="text-[10px] text-slate-600 mt-3">
          Cell color = FTE-normalized z-score (yellow = below average, red = well above). Number = raw count.
        </p>
      </div>
    </div>
  );
}
