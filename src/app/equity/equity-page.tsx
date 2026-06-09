"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { useEscape } from "@/lib/use-escape";
import { filterStaff, filterAssignmentsByDate, type PayPeriodRef } from "@/lib/graph/filter";
import { shapeBarSeries } from "@/lib/graph/series";
import { encodeSpec, type GraphSpec } from "@/lib/graph/spec";
import { DateRangePicker } from "./controls/DateRangePicker";
import { StaffPicker } from "./controls/StaffPicker";
import { ChartTypePicker } from "./controls/ChartTypePicker";
import { MetricPicker } from "./controls/MetricPicker";
import { SavedViews } from "./saved/SavedViews";
import { toCsvText, buildEquityCsvRows } from "@/lib/graph/export-csv";
import { toPng } from "html-to-image";
import { coerceChart } from "@/lib/graph/compat";
import { HeatmapView } from "./charts/HeatmapView";
import { MetricBarView } from "./charts/MetricBarView";
import { PieView } from "./charts/PieView";
import { formatDate, type DateFormatKey, DEFAULT_DATE_FORMAT } from "@/lib/date-format";
import { computeStatsModel, type RawStatsData } from "@/lib/graph/model";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
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
  employmentTypeName: string;
  desirabilityScore: number;
  undesirableShiftCount: number;
  desirableShiftCount: number;
  holidayWorkCount: number;
  totalWorkDays: number;
  totalLeaveDays: number;
  totalHours: number;
  deviation: Deviation;
  displayDeviation: Deviation;
  shiftCounts: Record<string, number>;
  shiftTally: Record<string, number>;
};

type EquityThresholds = { low: number; med: number; high: number };

type Props = {
  raw: RawStatsData;
  equityThresholds: EquityThresholds;
  payPeriods: PayPeriodRef[];
  initialSpec: GraphSpec;
  dateFormat: string;
  canManageViews: boolean;
};

/** Format an ISO YYYY-MM-DD string with the user's configured date format.
 *  Parses at local noon so the calendar date is never shifted by timezone. */
function formatIsoDate(iso: string, fmt: DateFormatKey): string {
  if (!iso) return "—";
  return formatDate(new Date(`${iso}T12:00:00`), fmt);
}

type SortKey = "initials" | "desirability" | "oppAdj" | "holiday" | "hours" | "workDays" | "leaveDays" | string;

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

/** Radar hover tooltip — shows the real z-score for the hovered axis (the
 *  radar plots a baseline-offset value for layout, so we read the stored `z`
 *  off the data row rather than the rendered radius). */
function RadarTooltipContent({ active, payload, initials }: { active?: boolean; payload?: Array<{ payload: { label: string; z: number } }>; initials?: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs shadow-lg">
      <div className="text-slate-300 font-medium mb-1">{d.label}</div>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-blue-500" />
        <span className="text-slate-400">{initials}:</span>
        <span className="text-slate-200 font-mono">{d.z > 0 ? "+" : ""}{d.z.toFixed(2)}σ</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-slate-500" />
        <span className="text-slate-400">Dept avg:</span>
        <span className="text-slate-200 font-mono">0.00σ</span>
      </div>
    </div>
  );
}

function shiftColor(code: string, allCodes: string[]): string {
  return CHART_COLORS[allCodes.indexOf(code) % CHART_COLORS.length];
}

const HOLIDAY_COLOR = "#ef4444";

function OverviewCharts({ data, trackedShiftCodes, allShiftCodes, showHoliday, perFte }: {
  data: EquityRow[];
  trackedShiftCodes: string[];
  allShiftCodes: string[];
  showHoliday: boolean;
  perFte: boolean;
}) {
  const allToggleCodes = [...(showHoliday ? ["Holidays"] : []), ...trackedShiftCodes];
  const [visibleShifts, setVisibleShifts] = useState<Set<string>>(() => new Set(allToggleCodes));

  const toggleShift = (code: string) => {
    setVisibleShifts((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const visibleCodes = trackedShiftCodes.filter((c) => visibleShifts.has(c));
  const holidayVisible = showHoliday && visibleShifts.has("Holidays");
  const anyVisible = visibleCodes.length > 0 || holidayVisible;

  const shiftData = useMemo(
    () => shapeBarSeries(data, visibleCodes, holidayVisible, perFte),
    [data, visibleCodes, holidayVisible, perFte],
  );

  return (
    <div className="mb-6">
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
          Shift Distribution{perFte ? " — per 1.0 FTE" : ""}
        </h3>
        <div className="flex items-center gap-1.5 mb-3">
          {allToggleCodes.map((code) => {
            const color = code === "Holidays" ? HOLIDAY_COLOR : shiftColor(code, allShiftCodes);
            const active = visibleShifts.has(code);
            return (
              <button
                key={code}
                onClick={() => toggleShift(code)}
                className={`px-2.5 py-1 text-[10px] font-medium rounded transition-colors border ${active ? "border-opacity-50" : "border-transparent bg-slate-700/50 text-slate-600"}`}
                style={active ? { backgroundColor: color + "20", color, borderColor: color + "50" } : undefined}
              >
                {code}
              </button>
            );
          })}
        </div>
        {anyVisible && (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={shiftData} margin={{ left: -10, right: 10, top: 5, bottom: 5 }} barGap={1} barCategoryGap="15%">
              <XAxis dataKey="initials" tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "monospace" }} axisLine={{ stroke: "#334155" }} tickLine={false} interval={0} />
              <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltipContent />} />
              {holidayVisible && (
                <Bar dataKey="Holidays" name="Holidays" fill={HOLIDAY_COLOR} fillOpacity={0.75} radius={[2, 2, 0, 0]} minPointSize={3} />
              )}
              {visibleCodes.map((code) => (
                <Bar key={code} dataKey={code} name={code} fill={shiftColor(code, allShiftCodes)} fillOpacity={0.75} radius={[2, 2, 0, 0]} minPointSize={3} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          )}
        </div>
    </div>
  );
}

const RADAR_PARAM_TIPS: Record<string, string> = {
  "Undesirable": "Desirability burden score. Counts shifts weighted by how undesirable they are. Higher = more undesirable shifts worked.",
  "Holidays": "Number of holidays worked. Holidays are high-burden dates shared equitably across staff.",
};

function radarParamTip(label: string): string {
  return RADAR_PARAM_TIPS[label] ?? `Count of ${label} shifts assigned. Tracked as an equity factor for fair distribution.`;
}

const RADAR_INFO = "This radar chart compares one staff member (blue) against the department average (dashed gray) across all tracked equity factors.\n\nValues are FTE-normalized z-scores: standard deviations from the department mean, adjusted for each person's FTE percentage. The dashed ring is 0σ (the department average); points outward from it = more burden than average. Hover any axis to read the exact z-score.";

function StaffDetailPanel({ row, globalMaxDev, onClose, setTip }: {
  row: EquityRow;
  globalMaxDev: number;
  onClose: () => void;
  setTip: SetTip;
}) {
  useEscape(onClose);

  // The radar always shows plain FTE-normalized z-scores (displayDeviation):
  // each axis is the provider's deviation from the department average, in SDs.
  // We plot a baseline-offset value so the whole chart stays positive for the
  // radial axis, and stash the real z-score (`z`) for the hover tooltip.
  const baseline = globalMaxDev + 0.5;
  const radarData = useMemo(() => {
    const src = row.displayDeviation;
    const items = [
      { label: "Undesirable", z: src.desirability },
      { label: "Holidays", z: src.holidayWork },
      ...Object.entries(src.perShift).map(([code, dev]) => ({ label: code, z: dev })),
    ];
    return items.map((d) => ({
      label: d.label,
      z: parseFloat(d.z.toFixed(2)),
      provider: parseFloat((baseline + d.z).toFixed(2)),
      average: parseFloat(baseline.toFixed(2)),
    }));
  }, [row, baseline]);

  const radarDomain: [number, number] = [0, baseline * 2];

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
            {row.employmentTypeName === "FTE" && row.ftePercentage < 1 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400/80 font-mono">{(row.ftePercentage * 100).toFixed(0)}% FTE</span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors text-lg px-2">&times;</button>
        </div>

        <div className="p-5 space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Profile vs Department Average
                <InfoTip text={RADAR_INFO} setTip={setTip} />
              </h3>
            </div>
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4 flex flex-col" style={{ height: "calc(100vh - 240px)", minHeight: 500 }}>
              <ResponsiveContainer width="100%" className="flex-1 min-h-0">
                <RadarChart data={radarData} cx="50%" cy="46%">
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis
                    dataKey="label"
                    tick={(props: Record<string, unknown>) => {
                      const x = Number(props.x);
                      const y = Number(props.y);
                      const anchor = String(props.textAnchor) as "start" | "middle" | "end";
                      const label = (props.payload as { value: string })?.value ?? "";
                      return (
                        <text
                          x={x} y={y}
                          textAnchor={anchor}
                          fill="#94a3b8"
                          fontSize={13}
                          fontWeight={500}
                          className="cursor-help"
                          onMouseEnter={(e) => showTip(setTip, radarParamTip(label), e)}
                          onMouseLeave={() => setTip(null)}
                        >
                          {label}
                        </text>
                      );
                    }}
                  />
                  <PolarRadiusAxis tick={false} axisLine={false} domain={radarDomain} />
                  <Tooltip content={<RadarTooltipContent initials={row.initials} />} />
                  <Radar name="Dept Avg (0σ)" dataKey="average" stroke="#475569" fill="#475569" fillOpacity={0.1} strokeWidth={1.5} strokeDasharray="4 4" />
                  <Radar name={row.initials} dataKey="provider" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={2} />
                  <Legend wrapperStyle={{ fontSize: 14 }} iconType="circle" iconSize={10} />
                </RadarChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-between mt-3">
                <span className="text-sm font-medium text-slate-300">Raw Z-Scores (FTE-normalized)</span>
                <span className="text-xs text-slate-500">Dashed = dept average (0σ). Outward = more burden.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type TipState = { text: string; x: number; y: number } | null;
type SetTip = (t: TipState) => void;

function showTip(set: SetTip, text: string, e: React.MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  set({ text, x: r.left + r.width / 2, y: r.bottom + 4 });
}

function InfoTip({ text, setTip }: { text: string; setTip: SetTip }) {
  return (
    <span
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-slate-600 text-[9px] text-slate-500 hover:text-slate-300 hover:border-slate-400 cursor-help ml-1 align-middle transition-colors"
      onMouseEnter={(e) => showTip(setTip, text, e)}
      onMouseLeave={() => setTip(null)}
    >
      i
    </span>
  );
}

function TipOverlay({ tip }: { tip: TipState }) {
  if (!tip) return null;
  return (
    <div
      ref={(el) => {
        if (!el) return;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const pad = 8;
        let left = tip.x - w / 2;
        let top = tip.y;
        if (left + w + pad > window.innerWidth) left = window.innerWidth - w - pad;
        if (left < pad) left = pad;
        if (top + h + pad > window.innerHeight) top = tip.y - h - 8;
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
      }}
      className="fixed z-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-200 bg-slate-800 border border-slate-600 rounded shadow-xl whitespace-pre-wrap pointer-events-none w-max max-w-xs"
      style={{ left: -9999, top: -9999 }}
    >
      {tip.text}
    </div>
  );
}

function SortHeader({ label, sortId, className, title, sortKey, sortAsc, onSort, setTip }: { label: string; sortId: SortKey; className?: string; title?: string; sortKey: SortKey; sortAsc: boolean; onSort: (key: SortKey) => void; setTip?: SetTip }) {
  const active = sortKey === sortId;
  return (
    <th
      className={`py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors select-none whitespace-nowrap ${active ? "text-slate-200" : "text-slate-500"} ${className || ""}`}
      onClick={() => onSort(sortId)}
      onMouseEnter={setTip && title ? (e) => showTip(setTip, title, e) : undefined}
      onMouseLeave={setTip ? () => setTip(null) : undefined}
    >
      {label}{active ? (sortAsc ? " ▲" : " ▼") : ""}
    </th>
  );
}

const COLUMN_FORMULAS: Record<string, string> = {
  desirability: "FTE-normalized z-score of undesirable shift burden.\n\nFormula: -(count / FTE - dept_mean) / std_dev\n\nPositive = fewer undesirable shifts than average.",
  oppAdj: "Opportunity-adjusted desirability z-score. Only counts shift types the provider is eligible for.\n\nFormula: -(count / FTE - expected) / std_dev\n\nControls for providers who can't work certain shifts.",
  holiday: "Holidays worked",
  hours: "Total FTE-counted hours",
  workDays: "Total work days",
  leaveDays: "Total leave days",
};

export function EquityPage({ raw, equityThresholds, payPeriods, initialSpec, dateFormat, canManageViews }: Props) {
  const [tip, setTip] = useState<TipState>(null);
  const dateFmt = (dateFormat || DEFAULT_DATE_FORMAT) as DateFormatKey;

  // The active GraphSpec drives the whole pipeline. It is decoded from ?g= on
  // the server (initialSpec) so the first render is the requested view, and we
  // mirror every later change back into the URL for shareable/bookmarkable
  // links. The first render is skipped so an untouched page keeps a clean URL.
  const [spec, setSpec] = useState<GraphSpec>(initialSpec);
  const firstRender = useRef(true);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.set("g", encodeSpec(spec));
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [spec]);

  // Date range scopes the raw assignments BEFORE compute, so metrics genuinely
  // recompute over the chosen time subset.
  const scopedRaw = useMemo<RawStatsData>(() => {
    const assignments = filterAssignmentsByDate(raw.assignments, spec.dateRange, payPeriods);
    return assignments === raw.assignments ? raw : { ...raw, assignments };
  }, [raw, spec.dateRange, payPeriods]);

  // Whole Statistics computation runs in-browser from the (scoped) raw payload.
  const { data, averages, trackedShiftCodes, dateRange, shiftCodes } = useMemo(
    () => computeStatsModel(scopedRaw),
    [scopedRaw],
  );
  const activeFactors = useMemo(
    () => raw.equityFactors.map((f) => ({ factorType: f.factorType, shiftCode: f.shiftCode, enabled: f.enabled })),
    [raw.equityFactors],
  );

  const showDesirability = activeFactors.some((f) => f.factorType === "desirability" && f.enabled);
  const showHoliday = activeFactors.some((f) => f.factorType === "holiday" && f.enabled);
  const activeShiftCodes = activeFactors
    .filter((f) => f.factorType === "shift" && f.enabled && f.shiftCode)
    .map((f) => f.shiftCode!);

  const [sortKey, setSortKey] = useState<SortKey>(showDesirability ? "desirability" : "initials");
  const [sortAsc, setSortAsc] = useState(!showDesirability);
  const [showTallies, setShowTallies] = useState(false);
  const [showCharts, setShowCharts] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const filteredData = useMemo(() => filterStaff(data, spec.staff), [data, spec.staff]);
  const isFiltered = filteredData.length !== data.length;
  const chartCodes = useMemo(
    () => activeShiftCodes.filter((c) => trackedShiftCodes.includes(c)),
    [activeShiftCodes, trackedShiftCodes],
  );

  const selectedRow = selectedProvider ? filteredData.find((d) => d.providerId === selectedProvider) : null;

  const globalMaxDev = useMemo(() => {
    let max = 0.5;
    for (const d of data) {
      max = Math.max(max, Math.abs(d.displayDeviation.desirability), Math.abs(d.displayDeviation.holidayWork));
      for (const v of Object.values(d.displayDeviation.perShift)) max = Math.max(max, Math.abs(v));
    }
    return max;
  }, [data]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "initials"); }
  }

  const sorted = [...filteredData].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "initials") cmp = a.initials.localeCompare(b.initials);
    else if (sortKey === "desirability") cmp = b.displayDeviation.desirability - a.displayDeviation.desirability;
    else if (sortKey === "oppAdj") cmp = b.deviation.desirability - a.deviation.desirability;
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

  // Export the visible data table to CSV (mirrors the on-screen columns).
  const downloadCsv = () => {
    const csv = toCsvText(
      buildEquityCsvRows(sorted, {
        showDesirability,
        showHoliday,
        activeShiftCodes,
        showTallies,
        tallyCodes: shiftCodes,
      }),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `statistics-${dateRange.min}_to_${dateRange.max}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // The active chart, computed once so we can both render it and know whether a
  // chart exists (drives the Export PNG button's enabled state).
  const chartNode = (() => {
    const perFte = spec.normalize === "fte";
    const oppAdj = spec.weighting === "opportunity";
    const codes = chartCodes;
    const metric = spec.metric;
    const isCode = metric.startsWith("shift:");

    // Heatmap — the all-codes equity grid; valid for "all shifts" or a
    // specific code (it shows the chosen code in context of the others).
    if (spec.chart === "heatmap" && (metric === "shiftCount" || isCode)) {
      if (codes.length === 0 && !showHoliday) return null;
      return (
        <HeatmapView
          data={filteredData}
          codes={codes}
          opportunityAdjusted={oppAdj}
          includeHolidays={showHoliday}
          thresholds={equityThresholds}
          onSelect={(initials) => {
            const match = filteredData.find((d) => d.initials === initials);
            if (match) setSelectedProvider(match.providerId);
          }}
          setTip={setTip}
        />
      );
    }

    // Pie — department share by provider; valid for the count metrics.
    if (spec.chart === "pie" && (metric === "shiftCount" || isCode || metric === "holidays" || metric === "hours")) {
      return <PieView data={filteredData} metric={metric} codes={codes} perFte={perFte} />;
    }

    // Bar / fallback. "All shifts" keeps the stacked-by-code distribution;
    // every other metric is one value per provider.
    if (metric === "shiftCount") {
      if (!(codes.length > 0 || showHoliday)) return null;
      return (
        <OverviewCharts
          data={filteredData}
          trackedShiftCodes={codes}
          allShiftCodes={trackedShiftCodes}
          showHoliday={showHoliday}
          perFte={perFte}
        />
      );
    }
    return <MetricBarView data={filteredData} metric={metric} perFte={perFte} opportunityAdjusted={oppAdj} />;
  })();

  // Rasterize the rendered chart (SVG recharts + the div-grid heatmap) to PNG.
  const downloadPng = async () => {
    const node = chartRef.current;
    if (!node) return;
    const dataUrl = await toPng(node, { backgroundColor: "#0f172a", pixelRatio: 2 });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `statistics-${dateRange.min}_to_${dateRange.max}.png`;
    a.click();
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Statistics</h2>
            <p className="text-sm text-slate-400 mt-1">
              {formatIsoDate(dateRange.min, dateFmt)} to {formatIsoDate(dateRange.max, dateFmt)} — {isFiltered ? `${filteredData.length} of ${data.length}` : data.length} providers
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadCsv}
              disabled={sorted.length === 0}
              className="px-3 py-1.5 text-xs rounded transition-colors bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download the table as CSV"
            >
              Export CSV
            </button>
            <button
              onClick={downloadPng}
              disabled={!showCharts || !chartNode}
              className="px-3 py-1.5 text-xs rounded transition-colors bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download the current chart as a PNG image"
            >
              Export PNG
            </button>
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

        <div className="flex flex-col gap-3 mb-5 bg-slate-800/30 border border-slate-700/50 rounded-lg px-4 py-3">
          <SavedViews currentSpec={spec} onSelect={setSpec} canManage={canManageViews} />
          <DateRangePicker
            value={spec.dateRange}
            payPeriods={payPeriods}
            onChange={(dateRange) => setSpec((s) => ({ ...s, dateRange }))}
          />
          <StaffPicker
            value={spec.staff}
            providers={raw.providers.map((p) => ({
              id: p.id,
              initials: p.initials,
              name: p.name,
              employmentTypeName: p.employmentTypeName,
              ftePercentage: p.ftePercentage ?? 1.0,
            }))}
            onChange={(staff) => setSpec((s) => ({ ...s, staff }))}
          />
          <MetricPicker
            value={spec.metric}
            shiftCodes={activeShiftCodes.filter((c) => trackedShiftCodes.includes(c))}
            showHoliday={showHoliday}
            showDesirability={showDesirability}
            onChange={(metric) => setSpec((s) => ({ ...s, metric, chart: coerceChart(metric, s.chart) }))}
          />
          <ChartTypePicker value={spec.chart} metric={spec.metric} onChange={(chart) => setSpec((s) => ({ ...s, chart }))} />
          {isFiltered && (
            <span className="text-xs text-slate-500 pl-[72px]">{filteredData.length} of {data.length} providers shown</span>
          )}
        </div>

        {(showHoliday || activeShiftCodes.length > 0) && (
          <div className="flex flex-wrap gap-3 mb-5">
            {showHoliday && (
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3 min-w-[140px]">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Avg Holidays</div>
                <div className="text-lg font-semibold tabular-nums text-red-400">
                  {averages.holidayWorkCount.toFixed(1)}
                </div>
                <div className="text-[10px] text-slate-600">per 1.0 FTE</div>
              </div>
            )}
            {activeShiftCodes.filter((code) => code in averages.perShift).map((code) => (
              <div key={code} className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3 min-w-[140px]">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Avg {code}</div>
                <div className="text-lg font-semibold tabular-nums" style={{ color: shiftColor(code, trackedShiftCodes) }}>
                  {averages.perShift[code].toFixed(1)}
                </div>
                <div className="text-[10px] text-slate-600">per 1.0 FTE</div>
              </div>
            ))}
          </div>
        )}

        {showCharts && (
          <div ref={chartRef}>
            {chartNode ?? (
              <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg px-4 py-10 mb-5 text-center text-sm text-slate-500">
                No chart for this metric and filter combination.
              </div>
            )}
          </div>
        )}

        <div className="bg-slate-800/30 border border-slate-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/80 border-b border-slate-700">
                  <SortHeader label="Staff Member" sortId="initials" className="text-left w-56" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} setTip={setTip} />
                  {showDesirability && <SortHeader label="Desirability" sortId="desirability" className="text-right w-24" title={COLUMN_FORMULAS.desirability} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} setTip={setTip} />}
                  {showDesirability && <SortHeader label="Opp. Adj." sortId="oppAdj" className="text-right w-20" title={COLUMN_FORMULAS.oppAdj} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} setTip={setTip} />}
                  {showHoliday && <SortHeader label="Holidays" sortId="holiday" className="text-right w-20" title={COLUMN_FORMULAS.holiday} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} setTip={setTip} />}
                  {activeShiftCodes.map((code) => (
                    <SortHeader key={code} label={code} sortId={`shift:${code}`} className="text-right w-16" title={`Total ${code} shifts`} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} setTip={setTip} />
                  ))}
                  <SortHeader label="Hours" sortId="hours" className="text-right w-20" title={COLUMN_FORMULAS.hours} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} setTip={setTip} />
                  <SortHeader label="Work Days" sortId="workDays" className="text-right w-20" title={COLUMN_FORMULAS.workDays} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} setTip={setTip} />
                  <SortHeader label="Leave Days" sortId="leaveDays" className="text-right w-20" title={COLUMN_FORMULAS.leaveDays} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} setTip={setTip} />
                  {showTallies && shiftCodes.map((code) => (
                    <th key={code} className="px-2 py-2.5 text-[11px] font-medium text-slate-600 text-right whitespace-nowrap">{code}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  return (
                    <tr
                      key={row.providerId}
                      className={`border-b border-slate-700/20 hover:bg-slate-800/40 transition-colors cursor-pointer ${selectedProvider === row.providerId ? "bg-blue-900/20" : ""}`}
                      onClick={() => setSelectedProvider(row.providerId)}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-bold text-sm w-9 ${!row.isAutoScheduled ? "text-amber-400" : "text-slate-200"}`}>{row.initials}</span>
                          <span className="text-xs text-slate-500 whitespace-nowrap">{row.name}</span>
                          {row.employmentTypeName === "FTE" && row.ftePercentage < 1 && (
                            <span className="text-[10px] px-1 py-px rounded bg-amber-900/30 text-amber-400/80 font-mono">{(row.ftePercentage * 100).toFixed(0)}%</span>
                          )}
                        </div>
                      </td>
                      {showDesirability && (
                        <td className="px-3 py-2.5 text-right">
                          <span className={`text-sm tabular-nums ${-row.displayDeviation.desirability > 0.3 ? "text-emerald-400" : -row.displayDeviation.desirability < -0.3 ? "text-red-400" : "text-slate-400"}`}>
                            {-row.displayDeviation.desirability > 0 ? "+" : ""}{(-row.displayDeviation.desirability).toFixed(2)}
                          </span>
                        </td>
                      )}
                      {showDesirability && (
                        <td className="px-3 py-2.5 text-right">
                          <span className={`text-sm tabular-nums ${-row.deviation.desirability > 0.3 ? "text-emerald-400" : -row.deviation.desirability < -0.3 ? "text-red-400" : "text-slate-400"}`}>
                            {-row.deviation.desirability > 0 ? "+" : ""}{(-row.deviation.desirability).toFixed(2)}
                          </span>
                        </td>
                      )}
                      {showHoliday && (
                        <td className="px-3 py-2.5 text-right">
                          <span className={`text-sm tabular-nums ${row.holidayWorkCount > 0 ? "text-red-400" : "text-slate-600"}`}>
                            {row.holidayWorkCount}
                          </span>
                        </td>
                      )}
                      {activeShiftCodes.map((code) => {
                        const val = row.shiftCounts[code] || 0;
                        return (
                          <td key={code} className="px-3 py-2.5 text-right">
                            <span className="text-sm tabular-nums" style={{ color: shiftColor(code, trackedShiftCodes) }}>
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
          globalMaxDev={globalMaxDev}
          onClose={() => setSelectedProvider(null)}
          setTip={setTip}
        />
      )}
      <TipOverlay tip={tip} />
    </div>
  );
}
