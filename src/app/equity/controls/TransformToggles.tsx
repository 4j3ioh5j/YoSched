"use client";

import type { GraphSpec } from "@/lib/graph/spec";

/**
 * Global transform toggles, promoted from the radar panel's old local toggles
 * so every chart honors them:
 *  - normalize: "raw" actual counts vs "fte" per-1.0-FTE rates / z-scores
 *  - weighting: "none" plain vs "opportunity" eligibility-adjusted desirability
 *
 * Weighting only changes opportunity-aware metrics (desirability), and only
 * makes sense under FTE normalization, so it is disabled when normalize="raw".
 * (compat.ts will formalize the grey-out rules in a later slice.)
 */
export function TransformToggles({
  spec,
  onChange,
}: {
  spec: GraphSpec;
  onChange: (patch: Partial<GraphSpec>) => void;
}) {
  const fte = spec.normalize === "fte";
  const opp = spec.weighting === "opportunity";

  const btn = (active: boolean) =>
    `px-2.5 py-1 text-[11px] rounded transition-colors border ${
      active
        ? "bg-blue-600/20 text-blue-300 border-blue-500/40"
        : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700"
    }`;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-slate-500 w-16">Transform</span>

      <button
        onClick={() => onChange({ normalize: fte ? "raw" : "fte" })}
        className={btn(fte)}
        title="Divide counts by each provider's FTE so part-time and full-time loads are comparable"
      >
        {fte ? "Per-FTE" : "Actual counts"}
      </button>

      <button
        onClick={() => onChange({ weighting: opp ? "none" : "opportunity" })}
        disabled={!fte}
        className={`${btn(opp)} ${!fte ? "opacity-40 cursor-not-allowed" : ""}`}
        title="Adjust desirability for the shifts each provider is actually eligible to work"
      >
        {opp ? "Opportunity-adjusted" : "Unweighted"}
      </button>
    </div>
  );
}
