"use client";

import { useCallback, useMemo, useState } from "react";
import { ShiftPicker } from "./shift-picker";
import { checkCellWarnings, checkDayStaffing, type Warning } from "@/lib/constraints";

type Provider = {
  id: string;
  initials: string;
  name: string;
  employmentType: string;
  ftePercentage: number;
  workingDays: number[];
  takesCall: boolean;
  takesLate: boolean;
};

type AssignmentData = {
  id: string;
  providerId: string;
  date: string;
  shiftTypeId: string;
  isLocked: boolean;
  code: string;
  color: string;
};

type ShiftType = {
  id: string;
  code: string;
  name: string;
  color: string;
  category: string;
  isLeave: boolean;
  defaultHours: number;
  countsTowardFte: boolean;
  postShiftRule: string | null;
};

type PayPeriod = {
  startDate: string;
  endDate: string;
  targetHours: number;
};

type Holiday = {
  date: string;
  name: string;
};

type ProviderOverride = {
  providerId: string;
  shiftTypeId: string;
  durationHrs: number;
};

type StaffingMin = {
  role: string;
  dayType: string;
  minimumCount: number;
};

type Props = {
  providers: Provider[];
  assignments: AssignmentData[];
  shiftTypes: ShiftType[];
  payPeriods: PayPeriod[];
  holidays: Holiday[];
  providerOverrides: ProviderOverride[];
  staffingMins: StaffingMin[];
};

type PickerState = {
  providerId: string;
  date: string;
  x: number;
  y: number;
} | null;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function parseDate(s: string): Date {
  return new Date(s + "T12:00:00");
}

function getMonthDateRange(year: number, month: number, payPeriods: PayPeriod[]) {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);

  let start = new Date(firstOfMonth);
  let end = new Date(lastOfMonth);

  for (const pp of payPeriods) {
    const ppStart = parseDate(pp.startDate);
    const ppEnd = parseDate(pp.endDate);
    if (ppStart < firstOfMonth && ppEnd >= firstOfMonth) {
      if (ppStart < start) start = ppStart;
    }
    if (ppEnd > lastOfMonth && ppStart <= lastOfMonth) {
      if (ppEnd > end) end = ppEnd;
    }
  }

  const startDow = start.getDay();
  if (startDow !== 0) {
    start = new Date(start);
    start.setDate(start.getDate() - startDow);
  }

  const endDow = end.getDay();
  if (endDow !== 6) {
    end = new Date(end);
    end.setDate(end.getDate() + (6 - endDow));
  }

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(toDateStr(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function formatDateLabel(dateStr: string): { day: string; date: string; dow: number; dayNum: number; month: number } {
  const d = parseDate(dateStr);
  const dow = d.getDay();
  return {
    day: DAY_NAMES[dow],
    date: `${d.getMonth() + 1}/${d.getDate()}`,
    dow,
    dayNum: d.getDate(),
    month: d.getMonth(),
  };
}

function findPayPeriod(dateStr: string, payPeriods: PayPeriod[]): PayPeriod | null {
  for (const pp of payPeriods) {
    if (dateStr >= pp.startDate && dateStr <= pp.endDate) return pp;
  }
  return null;
}

type RowItem =
  | { type: "date"; date: string }
  | { type: "pp-summary"; pp: PayPeriod; ppIndex: number };

function buildRowItems(dates: string[], payPeriods: PayPeriod[]): RowItem[] {
  const items: RowItem[] = [];
  const sortedPPs = [...payPeriods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const endedPPs = new Set<string>();

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    items.push({ type: "date", date });

    const nextDate = dates[i + 1];
    for (let ppIdx = 0; ppIdx < sortedPPs.length; ppIdx++) {
      const pp = sortedPPs[ppIdx];
      const ppKey = pp.startDate;
      if (endedPPs.has(ppKey)) continue;
      if (date === pp.endDate || (date <= pp.endDate && (!nextDate || nextDate > pp.endDate))) {
        items.push({ type: "pp-summary", pp, ppIndex: ppIdx });
        endedPPs.add(ppKey);
      }
    }
  }
  return items;
}

function WarningDot({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) return null;
  const hasError = warnings.some((w) => w.type === "post-shift" || w.type === "over-hours");
  return (
    <span
      className={`absolute top-0 right-0 w-1.5 h-1.5 rounded-full ${hasError ? "bg-red-500" : "bg-amber-500"}`}
      title={warnings.map((w) => w.message).join("\n")}
    />
  );
}

export function ScheduleGrid({
  providers,
  assignments: initialAssignments,
  shiftTypes,
  payPeriods,
  holidays,
  providerOverrides,
  staffingMins,
}: Props) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [localAssignments, setLocalAssignments] = useState(initialAssignments);
  const [picker, setPicker] = useState<PickerState>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<{ providerId: string; date: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const dates = useMemo(
    () => getMonthDateRange(viewYear, viewMonth, payPeriods),
    [viewYear, viewMonth, payPeriods],
  );

  const firstOfMonth = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
  const lastOfMonth = toDateStr(new Date(viewYear, viewMonth + 1, 0));

  const rowItems = useMemo(() => buildRowItems(dates, payPeriods), [dates, payPeriods]);

  const assignmentMap = useMemo(() => {
    const map = new Map<string, AssignmentData>();
    for (const a of localAssignments) {
      map.set(`${a.providerId}:${a.date}`, a);
    }
    return map;
  }, [localAssignments]);

  const shiftTypeMap = useMemo(() => {
    const map = new Map<string, ShiftType>();
    for (const st of shiftTypes) map.set(st.id, st);
    return map;
  }, [shiftTypes]);

  const providerMap = useMemo(() => {
    const map = new Map<string, Provider>();
    for (const p of providers) map.set(p.id, p);
    return map;
  }, [providers]);

  const overrideMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of providerOverrides) {
      map.set(`${o.providerId}:${o.shiftTypeId}`, o.durationHrs);
    }
    return map;
  }, [providerOverrides]);

  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays]);
  const holidayNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of holidays) map.set(h.date, h.name);
    return map;
  }, [holidays]);

  const sortedPPs = useMemo(
    () => [...payPeriods].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [payPeriods],
  );

  function getHoursForAssignment(providerId: string, shiftTypeId: string): number {
    const override = overrideMap.get(`${providerId}:${shiftTypeId}`);
    if (override !== undefined) return override;
    const st = shiftTypeMap.get(shiftTypeId);
    return st?.defaultHours ?? 0;
  }

  function shiftCountsTowardFte(shiftTypeId: string): boolean {
    const st = shiftTypeMap.get(shiftTypeId);
    return st?.countsTowardFte ?? false;
  }

  const ppHours = useMemo(() => {
    const result = new Map<string, Map<string, number>>();
    for (const pp of sortedPPs) {
      const providerHours = new Map<string, number>();
      for (const p of providers) {
        let hours = 0;
        const cursor = new Date(parseDate(pp.startDate));
        const end = parseDate(pp.endDate);
        while (cursor <= end) {
          const dateStr = toDateStr(cursor);
          const a = assignmentMap.get(`${p.id}:${dateStr}`);
          if (a && shiftCountsTowardFte(a.shiftTypeId)) {
            hours += getHoursForAssignment(p.id, a.shiftTypeId);
          }
          cursor.setDate(cursor.getDate() + 1);
        }
        providerHours.set(p.id, hours);
      }
      result.set(pp.startDate, providerHours);
    }
    return result;
  }, [sortedPPs, providers, assignmentMap, overrideMap, shiftTypeMap]);

  // Compute all cell warnings
  const cellWarnings = useMemo(() => {
    const map = new Map<string, Warning[]>();
    for (const date of dates) {
      for (const p of providers) {
        const a = assignmentMap.get(`${p.id}:${date}`);
        if (!a) continue;
        const warnings = checkCellWarnings({
          providerId: p.id,
          date,
          shiftTypeId: a.shiftTypeId,
          provider: p,
          shiftTypeMap,
          assignmentMap,
          providers,
          holidaySet,
          staffingMins,
        });
        if (warnings.length > 0) {
          map.set(`${p.id}:${date}`, warnings);
        }
      }
    }
    return map;
  }, [dates, providers, assignmentMap, shiftTypeMap, holidaySet, staffingMins]);

  // Compute per-day staffing warnings
  const dayWarnings = useMemo(() => {
    const map = new Map<string, Warning[]>();
    for (const date of dates) {
      const warnings = checkDayStaffing({
        date,
        providers,
        assignmentMap,
        holidaySet,
        staffingMins,
      });
      if (warnings.length > 0) {
        map.set(date, warnings);
      }
    }
    return map;
  }, [dates, providers, assignmentMap, holidaySet, staffingMins]);

  const OR_CODES = new Set(["OR", "ORC", "ORL"]);

  const staffingCounts = useMemo(() => {
    const counts: Record<string, number | null> = {};
    for (const date of dates) {
      const dow = parseDate(date).getDay();
      const isWeekend = dow === 0 || dow === 6;
      if (isWeekend || holidaySet.has(date)) {
        counts[date] = null;
        continue;
      }
      let count = 0;
      for (const p of providers) {
        const a = assignmentMap.get(`${p.id}:${date}`);
        if (a && OR_CODES.has(a.code)) count++;
      }
      counts[date] = count;
    }
    return counts;
  }, [dates, providers, assignmentMap, holidaySet]);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function goToday() {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  }

  function handleCellClick(providerId: string, date: string, e: React.MouseEvent) {
    const existing = assignmentMap.get(`${providerId}:${date}`);
    if (existing?.isLocked) return;
    setPicker({ providerId, date, x: e.clientX, y: e.clientY });
  }

  const handleSelect = useCallback(async (shiftTypeId: string) => {
    if (!picker) return;
    const { providerId, date } = picker;
    const key = `${providerId}:${date}`;
    const st = shiftTypeMap.get(shiftTypeId);
    if (!st) return;

    setPicker(null);
    setSaving(key);

    setLocalAssignments((prev) => {
      const filtered = prev.filter((a) => !(a.providerId === providerId && a.date === date));
      return [...filtered, {
        id: `temp-${key}`,
        providerId,
        date,
        shiftTypeId,
        isLocked: false,
        code: st.code,
        color: st.color,
      }];
    });

    try {
      const res = await fetch("/api/assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, date, shiftTypeId }),
      });
      const saved = await res.json();
      setLocalAssignments((prev) =>
        prev.map((a) => (a.providerId === providerId && a.date === date ? saved : a)),
      );
    } catch {
      setLocalAssignments((prev) => prev.filter((a) => a.id !== `temp-${key}`));
    } finally {
      setSaving(null);
    }
  }, [picker, shiftTypeMap]);

  const handleClear = useCallback(async () => {
    if (!picker) return;
    const { providerId, date } = picker;
    const key = `${providerId}:${date}`;

    setPicker(null);
    setSaving(key);

    setLocalAssignments((prev) =>
      prev.filter((a) => !(a.providerId === providerId && a.date === date)),
    );

    try {
      await fetch("/api/assignments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, date }),
      });
    } catch {
      window.location.reload();
    } finally {
      setSaving(null);
    }
  }, [picker]);

  const closePicker = useCallback(() => setPicker(null), []);

  function handleDragStart(providerId: string, date: string, e: React.DragEvent) {
    const a = assignmentMap.get(`${providerId}:${date}`);
    if (!a || a.isLocked) { e.preventDefault(); return; }
    setDragSource({ providerId, date });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${providerId}:${date}`);
  }

  function handleDragOver(providerId: string, date: string, e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const key = `${providerId}:${date}`;
    if (dragOver !== key) setDragOver(key);
  }

  function handleDragLeave() {
    setDragOver(null);
  }

  function handleDragEnd() {
    setDragSource(null);
    setDragOver(null);
  }

  const handleDrop = useCallback(async (toProviderId: string, toDate: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);

    if (!dragSource) return;
    const { providerId: fromProviderId, date: fromDate } = dragSource;
    setDragSource(null);

    if (fromProviderId === toProviderId && fromDate === toDate) return;

    const fromA = assignmentMap.get(`${fromProviderId}:${fromDate}`);
    const toA = assignmentMap.get(`${toProviderId}:${toDate}`);
    if (!fromA || fromA.isLocked || toA?.isLocked) return;

    const fromKey = `${fromProviderId}:${fromDate}`;
    const toKey = `${toProviderId}:${toDate}`;
    setSaving(fromKey);

    // Optimistic update
    setLocalAssignments((prev) => {
      let next = prev.filter(
        (a) => !(a.providerId === fromProviderId && a.date === fromDate) &&
               !(a.providerId === toProviderId && a.date === toDate)
      );
      // Move source to target
      next.push({ ...fromA, providerId: toProviderId, date: toDate, id: `temp-${toKey}` });
      // If target had assignment, move it to source (swap)
      if (toA) {
        next.push({ ...toA, providerId: fromProviderId, date: fromDate, id: `temp-${fromKey}` });
      }
      return next;
    });

    try {
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "swap",
          from: { providerId: fromProviderId, date: fromDate },
          to: { providerId: toProviderId, date: toDate },
        }),
      });
      if (!res.ok) throw new Error("Swap failed");
      const result = await res.json();

      setLocalAssignments((prev) => {
        let next = prev.filter(
          (a) => !a.id.startsWith("temp-")
            || (a.providerId !== fromProviderId && a.providerId !== toProviderId)
        );
        // Replace temps with server responses
        next = next.filter(
          (a) => !(a.providerId === toProviderId && a.date === toDate) &&
                 !(a.providerId === fromProviderId && a.date === fromDate)
        );
        if (result.moved) next.push(result.moved);
        if (result.swapped) next.push(result.swapped);
        return next;
      });
    } catch {
      window.location.reload();
    } finally {
      setSaving(null);
    }
  }, [dragSource, assignmentMap]);

  // Compute warnings for picker preview
  const pickerWarnings = useMemo(() => {
    if (!picker) return new Map<string, Warning[]>();
    const { providerId, date } = picker;
    const provider = providerMap.get(providerId);
    if (!provider) return new Map<string, Warning[]>();

    const result = new Map<string, Warning[]>();
    for (const st of shiftTypes) {
      if (st.category === "other") continue;
      const warnings = checkCellWarnings({
        providerId,
        date,
        shiftTypeId: st.id,
        provider,
        shiftTypeMap,
        assignmentMap,
        providers,
        holidaySet,
        staffingMins,
      });
      if (warnings.length > 0) {
        result.set(st.id, warnings);
      }
    }
    return result;
  }, [picker, providerMap, shiftTypes, shiftTypeMap, assignmentMap, providers, holidaySet, staffingMins]);

  let lastPPKey = "";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
        <button
          onClick={prevMonth}
          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
        >
          ←
        </button>
        <button
          onClick={goToday}
          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
        >
          Today
        </button>
        <button
          onClick={nextMonth}
          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
        >
          →
        </button>
        <span className="ml-4 text-base font-semibold text-slate-200">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <span className="ml-2 text-xs text-slate-500">
          {dates[0]} – {dates[dates.length - 1]}
        </span>
      </div>

      {/* Scrollable grid area */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-800">
              <th className="sticky left-0 z-20 bg-slate-800 px-3 py-2 text-left text-xs font-medium text-slate-400 border-b border-r border-slate-700 w-[88px] min-w-[88px]">
                Date
              </th>
              {providers.map((p) => (
                <th
                  key={p.id}
                  className="px-1 py-2 text-center text-xs font-medium border-b border-slate-700 w-[44px] min-w-[44px]"
                  title={`${p.name} (${p.ftePercentage * 100}% FTE)`}
                >
                  <span className={p.employmentType === "fee_basis" ? "text-amber-400" : "text-slate-300"}>
                    {p.initials}
                  </span>
                </th>
              ))}
              <th className="px-2 py-2 text-center text-xs font-medium text-slate-400 border-b border-l border-slate-700 w-[32px] min-w-[32px]">
                #
              </th>
            </tr>
          </thead>
          <tbody>
            {rowItems.map((item) => {
              if (item.type === "pp-summary") {
                const { pp, ppIndex } = item;
                const provHours = ppHours.get(pp.startDate);
                return (
                  <tr key={`pp-${pp.startDate}`} className="bg-slate-800/80">
                    <td
                      className="sticky left-0 z-[5] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-r border-slate-600 whitespace-nowrap border-y border-y-indigo-500/60"
                      style={{ background: "#1a2340" }}
                    >
                      <span className="text-indigo-400">PP {ppIndex + 1}</span>
                      <span className="text-slate-500 ml-1">hrs</span>
                    </td>
                    {providers.map((p) => {
                      const hours = provHours?.get(p.id) ?? 0;
                      const target = pp.targetHours * p.ftePercentage;
                      const diff = hours - target;
                      const pct = target > 0 ? hours / target : 0;

                      let color = "text-slate-500";
                      if (hours > 0) {
                        if (pct >= 0.95 && pct <= 1.05) color = "text-emerald-400";
                        else if (pct > 1.05) color = "text-red-400";
                        else if (pct >= 0.7) color = "text-amber-400";
                        else color = "text-slate-400";
                      }

                      return (
                        <td
                          key={p.id}
                          className="px-0 py-1 text-center border-slate-600/50 border border-y-indigo-500/60"
                          title={`${p.initials}: ${hours}/${target}hrs (${diff >= 0 ? "+" : ""}${diff})`}
                        >
                          <div className={`text-[10px] font-mono font-bold ${color}`}>
                            {hours > 0 ? hours : "–"}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-center text-[10px] font-mono border-l border-slate-600 text-indigo-400/60 border-y border-y-indigo-500/60">
                      {pp.targetHours}
                    </td>
                  </tr>
                );
              }

              const { date } = item;
              const label = formatDateLabel(date);
              const isWeekend = label.dow === 0 || label.dow === 6;
              const isHoliday = holidaySet.has(date);
              const isOutsideMonth = date < firstOfMonth || date > lastOfMonth;
              const isToday = date === toDateStr(today);

              const currentPP = findPayPeriod(date, sortedPPs);
              const ppKey = currentPP?.startDate ?? "";
              const isNewPP = ppKey !== "" && ppKey !== lastPPKey;
              if (ppKey !== "") lastPPKey = ppKey;
              const ppIdx = currentPP ? sortedPPs.indexOf(currentPP) : -1;
              const ppEven = ppIdx !== -1 && ppIdx % 2 === 0;

              const dw = dayWarnings.get(date);
              const staffCount = staffingCounts[date];

              return (
                <tr
                  key={date}
                  className={[
                    isOutsideMonth ? "opacity-40" : "",
                    isWeekend && !isOutsideMonth ? "bg-slate-800/50" : "",
                    isHoliday ? "bg-amber-950/20" : "",
                    isToday ? "ring-1 ring-inset ring-blue-500/50" : "",
                    "hover:bg-slate-800/80 transition-colors",
                  ].join(" ")}
                >
                  <td
                    className={[
                      "sticky left-0 z-[5] px-2 py-1 text-xs font-mono border-r border-slate-700 whitespace-nowrap",
                      isNewPP ? "border-t-2 border-t-indigo-500" : "",
                    ].join(" ")}
                    style={{ background: isOutsideMonth ? "#0d1321" : isWeekend ? "#1a2236" : "#0f172a" }}
                  >
                    <span className={isWeekend ? "text-slate-500" : "text-slate-300"}>
                      {label.day}
                    </span>{" "}
                    <span className={isOutsideMonth ? "text-slate-600" : "text-slate-400"}>
                      {label.date}
                    </span>
                    {isHoliday && (
                      <span className="ml-1 text-amber-400 text-[10px]" title={holidayNames.get(date)}>
                        ★
                      </span>
                    )}
                  </td>
                  {providers.map((p) => {
                    const a = assignmentMap.get(`${p.id}:${date}`);
                    const cellKey = `${p.id}:${date}`;
                    const isSaving = saving === cellKey;
                    const isPickerTarget = picker?.providerId === p.id && picker?.date === date;
                    const cw = cellWarnings.get(cellKey);
                    const isDragTarget = dragOver === cellKey;
                    const isDragSrc = dragSource?.providerId === p.id && dragSource?.date === date;

                    return (
                      <td
                        key={p.id}
                        className={[
                          "px-0.5 py-0.5 text-center border-slate-700/30 border cursor-pointer relative",
                          isNewPP ? "border-t-2 border-t-indigo-500" : "",
                          ppEven ? "" : "bg-slate-800/20",
                          isPickerTarget ? "ring-1 ring-inset ring-blue-400" : "",
                          isDragTarget ? "ring-2 ring-inset ring-cyan-400 bg-cyan-900/20" : "",
                          isDragSrc ? "opacity-30" : "",
                          !a && !isSaving ? "hover:bg-slate-700/30" : "",
                        ].join(" ")}
                        onClick={(e) => handleCellClick(p.id, date, e)}
                        onDragOver={(e) => handleDragOver(p.id, date, e)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(p.id, date, e)}
                      >
                        {a ? (
                          <div
                            draggable={!a.isLocked}
                            onDragStart={(e) => handleDragStart(p.id, date, e)}
                            onDragEnd={handleDragEnd}
                            className={[
                              "text-[11px] font-bold rounded px-1 py-0.5 leading-tight",
                              a.isLocked ? "ring-1 ring-yellow-500/50 cursor-not-allowed" : "hover:brightness-125 cursor-grab active:cursor-grabbing",
                              isSaving ? "opacity-50" : "",
                            ].join(" ")}
                            style={{
                              backgroundColor: a.code === "X" ? "transparent" : a.color + "30",
                              color: a.code === "X" ? "#475569" : a.color,
                            }}
                            title={
                              cw && cw.length > 0
                                ? cw.map((w) => w.message).join("\n")
                                : `${p.initials}: ${a.code} on ${date}${a.isLocked ? " (locked)" : ""}`
                            }
                          >
                            {a.code}
                          </div>
                        ) : isSaving ? (
                          <div className="text-[11px] text-slate-600">...</div>
                        ) : null}
                        {cw && <WarningDot warnings={cw} />}
                      </td>
                    );
                  })}
                  <td
                    className={[
                      "px-2 py-1 text-center text-xs font-mono border-l border-slate-700",
                      isNewPP ? "border-t-2 border-t-indigo-500" : "",
                      staffCount === null ? "text-slate-600" : dw && dw.length > 0 ? "text-red-400" : "text-slate-400",
                    ].join(" ")}
                    title={dw ? dw.map((w) => w.message).join("\n") : undefined}
                  >
                    {staffCount !== null ? staffCount : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="px-6 py-2 border-t border-slate-700 bg-slate-900 shrink-0">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-slate-500 font-medium mr-1">Shifts:</span>
          {shiftTypes
            .filter((st) => st.category !== "other")
            .map((st) => (
              <span key={st.id} className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: st.color }}
                />
                <span className="text-slate-400">{st.code}</span>
              </span>
            ))}
          <span className="text-slate-600 mx-1">|</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
            <span className="text-slate-400">rule violation</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
            <span className="text-slate-400">advisory</span>
          </span>
        </div>
      </div>

      {/* Shift picker popover */}
      {picker && (
        <ShiftPicker
          shiftTypes={shiftTypes}
          currentShiftTypeId={assignmentMap.get(`${picker.providerId}:${picker.date}`)?.shiftTypeId ?? null}
          position={{ x: picker.x, y: picker.y }}
          onSelect={handleSelect}
          onClear={handleClear}
          onClose={closePicker}
          warnings={pickerWarnings}
        />
      )}
    </div>
  );
}
