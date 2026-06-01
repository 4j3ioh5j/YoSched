"use client";

import { useMemo } from "react";
import { shapeHeatmap, type HeatmapInput } from "@/lib/graph/series";
import { fairnessColor, type EquityThresholds } from "@/lib/fairness";

/**
 * Providers × shift-codes equity heatmap. Each cell shows the raw count, tinted
 * by the provider's FTE-normalized per-shift z-score via `fairnessColor()`
 * (warm = above-average burden, cool = below). The shaping/selection logic is
 * the pure `shapeHeatmap`; this component is the thin view + color mapping.
 */
export function HeatmapView({
  data,
  codes,
  opportunityAdjusted,
  thresholds,
  onSelect,
  setTip,
}: {
  data: HeatmapInput[];
  codes: string[];
  opportunityAdjusted: boolean;
  thresholds: EquityThresholds;
  onSelect?: (initials: string) => void;
  setTip?: (t: { text: string; x: number; y: number } | null) => void;
}) {
  const rows = useMemo(() => shapeHeatmap(data, codes, opportunityAdjusted), [data, codes, opportunityAdjusted]);

  if (codes.length === 0 || rows.length === 0) return null;

  const gridTemplateColumns = `2.75rem repeat(${codes.length}, minmax(2rem, 1fr))`;

  return (
    <div className="mb-6">
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Equity Heatmap{opportunityAdjusted ? " — opportunity-adjusted" : ""}
        </h3>

        <div className="overflow-x-auto">
          <div className="inline-grid gap-px min-w-full" style={{ gridTemplateColumns }}>
            {/* header row */}
            <div />
            {codes.map((code) => (
              <div key={code} className="text-[10px] font-mono text-slate-400 text-center pb-1 truncate">
                {code}
              </div>
            ))}

            {/* provider rows */}
            {rows.map((r) => (
              <div key={r.initials} className="contents">
                <div
                  className="text-[11px] font-mono font-bold text-slate-300 flex items-center pr-1.5 cursor-pointer hover:text-slate-100"
                  onClick={() => onSelect?.(r.initials)}
                >
                  {r.initials}
                </div>
                {r.cells.map((cell) => {
                  const color = fairnessColor(cell.deviation, thresholds);
                  return (
                    <div
                      key={cell.code}
                      className="aspect-square min-h-[1.75rem] flex items-center justify-center text-[11px] tabular-nums rounded-sm cursor-default"
                      style={{ backgroundColor: color + "33", color }}
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
          Cell color = FTE-normalized z-score (warm = more than average, cool = less). Number = raw count.
        </p>
      </div>
    </div>
  );
}
