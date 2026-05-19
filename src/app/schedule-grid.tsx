"use client";

import { useCallback, useMemo, useState } from "react";
import { ShiftPicker } from "./shift-picker";

type Provider = {
  id: string;
  initials: string;
  name: string;
  employmentType: string;
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
};

type PayPeriod = {
  startDate: string;
  endDate: string;
};

type Holiday = {
  date: string;
  name: string;
};

type Props = {
  providers: Provider[];
  assignments: AssignmentData[];
  shiftTypes: ShiftType[];
  payPeriods: PayPeriod[];
  holidays: Holiday[];
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

function getPayPeriodIndex(dateStr: string, payPeriods: PayPeriod[]): number {
  for (let i = 0; i < payPeriods.length; i++) {
    if (dateStr >= payPeriods[i].startDate && dateStr <= payPeriods[i].endDate) {
      return i;
    }
  }
  return -1;
}

export function ScheduleGrid({
  providers,
  assignments: initialAssignments,
  shiftTypes,
  payPeriods,
  holidays,
}: Props) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [localAssignments, setLocalAssignments] = useState(initialAssignments);
  const [picker, setPicker] = useState<PickerState>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const dates = useMemo(
    () => getMonthDateRange(viewYear, viewMonth, payPeriods),
    [viewYear, viewMonth, payPeriods],
  );

  const firstOfMonth = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
  const lastOfMonth = toDateStr(new Date(viewYear, viewMonth + 1, 0));

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

  const staffingCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const date of dates) {
      let count = 0;
      for (const p of providers) {
        const a = assignmentMap.get(`${p.id}:${date}`);
        if (a && a.code !== "X") count++;
      }
      counts[date] = count;
    }
    return counts;
  }, [dates, providers, assignmentMap]);

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
      // Reload on error — state is already stale
      window.location.reload();
    } finally {
      setSaving(null);
    }
  }, [picker]);

  const closePicker = useCallback(() => setPicker(null), []);

  let lastPPIndex = -999;

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
                  title={p.name}
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
            {dates.map((date) => {
              const label = formatDateLabel(date);
              const isWeekend = label.dow === 0 || label.dow === 6;
              const isHoliday = holidaySet.has(date);
              const isOutsideMonth = date < firstOfMonth || date > lastOfMonth;
              const isToday = date === toDateStr(today);

              const ppIdx = getPayPeriodIndex(date, sortedPPs);
              const isNewPP = ppIdx !== -1 && ppIdx !== lastPPIndex;
              if (ppIdx !== -1) lastPPIndex = ppIdx;
              const ppEven = ppIdx !== -1 && ppIdx % 2 === 0;

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

                    return (
                      <td
                        key={p.id}
                        className={[
                          "px-0.5 py-0.5 text-center border-slate-700/30 border cursor-pointer",
                          isNewPP ? "border-t-2 border-t-indigo-500" : "",
                          ppEven ? "" : "bg-slate-800/20",
                          isPickerTarget ? "ring-1 ring-inset ring-blue-400" : "",
                          !a && !isSaving ? "hover:bg-slate-700/30" : "",
                        ].join(" ")}
                        onClick={(e) => handleCellClick(p.id, date, e)}
                      >
                        {a ? (
                          <div
                            className={[
                              "text-[11px] font-bold rounded px-1 py-0.5 leading-tight",
                              a.isLocked ? "ring-1 ring-yellow-500/50 cursor-not-allowed" : "hover:brightness-125",
                              isSaving ? "opacity-50" : "",
                            ].join(" ")}
                            style={{
                              backgroundColor: a.code === "X" ? "transparent" : a.color + "30",
                              color: a.code === "X" ? "#475569" : a.color,
                            }}
                            title={`${p.initials}: ${a.code} on ${date}${a.isLocked ? " (locked)" : ""}`}
                          >
                            {a.code}
                          </div>
                        ) : isSaving ? (
                          <div className="text-[11px] text-slate-600">...</div>
                        ) : null}
                      </td>
                    );
                  })}
                  <td
                    className={[
                      "px-2 py-1 text-center text-xs font-mono border-l border-slate-700 text-slate-400",
                      isNewPP ? "border-t-2 border-t-indigo-500" : "",
                    ].join(" ")}
                  >
                    {staffingCounts[date] || 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="px-6 py-2 border-t border-slate-700 bg-slate-900 shrink-0">
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-slate-500 font-medium mr-2">Legend:</span>
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
        </div>
      </div>

      {/* Shift picker popover */}
      {picker && (
        <ShiftPicker
          shiftTypes={shiftTypes.filter((st) => st.category !== "other")}
          currentShiftTypeId={assignmentMap.get(`${picker.providerId}:${picker.date}`)?.shiftTypeId ?? null}
          position={{ x: picker.x, y: picker.y }}
          onSelect={handleSelect}
          onClear={handleClear}
          onClose={closePicker}
        />
      )}
    </div>
  );
}
