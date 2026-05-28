"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShiftPicker } from "./shift-picker";
import { checkCellWarnings, checkDayStaffing, type Warning } from "@/lib/constraints";
import { fairnessColor, fairnessLabel } from "@/lib/fairness";
import { type FollowRuleRow, buildFollowRuleMap } from "@/lib/follow-rules";
import { formatDate, formatDateCompact, type DateFormatKey, DEFAULT_DATE_FORMAT } from "@/lib/date-format";

type AvailabilityRuleData = {
  dayOfWeek: number;
  type: string;
  strength: string;
  pattern: string;
  conditionProviderId?: string | null;
};

type Provider = {
  id: string;
  initials: string;
  name: string;
  ftePercentage: number;
  employmentTypeName: string;
  availabilityRules: AvailabilityRuleData[];
  isAutoScheduled: boolean;
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
  isOffShift: boolean;
  ignoresWorkingDays: boolean;
  defaultHours: number;
  countsTowardFte: boolean;
  countsOnWeekend: boolean;
  hotkey?: string | null;
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

type StaffingReq = {
  shiftCode: string;
  dayKey: string;
  minCount: number;
};

type FairnessDeviation = {
  desirability: number;
  holidayWork: number;
  overall: number;
};

type FairnessMetrics = {
  providerId: string;
  initials: string;
  desirabilityScore: number;
  undesirableShiftCount: number;
  desirableShiftCount: number;
  holidayWorkCount: number;
  totalWorkDays: number;
  totalLeaveDays: number;
  shiftCounts: Record<string, number>;
};

type FairnessEntry = {
  metrics: FairnessMetrics;
  deviation: FairnessDeviation;
  displayDeviation: FairnessDeviation;
};

type Props = {
  canEdit?: boolean;
  providers: Provider[];
  assignments: AssignmentData[];
  shiftTypes: ShiftType[];
  payPeriods: PayPeriod[];
  holidays: Holiday[];
  providerOverrides: ProviderOverride[];
  staffingMins: StaffingMin[];
  staffingReqs: StaffingReq[];
  fairnessData?: Record<string, FairnessEntry>;
  fairnessAverages?: {
    desirabilityScore: number;
    holidayWorkCount: number;
    perShift: Record<string, number>;
  };
  followRules?: FollowRuleRow[];
  countColumns?: { label: string; shiftCodes: string[] }[];
  dateFormat?: string;
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDate(s: string): Date {
  return new Date(s + "T12:00:00");
}

function getMonthDateRange(year: number, month: number, _payPeriods: PayPeriod[]) {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);

  let start = new Date(firstOfMonth);
  let end = new Date(lastOfMonth);

  const startDow = start.getDay();
  if (startDow !== 6) {
    start = new Date(start);
    start.setDate(start.getDate() - ((startDow + 1) % 7));
  }

  const endDow = end.getDay();
  if (endDow !== 0) {
    end = new Date(end);
    end.setDate(end.getDate() + (7 - endDow));
  }

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(toDateStr(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function formatDateLabel(dateStr: string, dateFormat: DateFormatKey = DEFAULT_DATE_FORMAT): { day: string; date: string; dow: number; dayNum: number; month: number } {
  const d = parseDate(dateStr);
  const dow = d.getDay();
  return {
    day: DAY_NAMES[dow],
    date: formatDateCompact(d, dateFormat),
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
  | { type: "date"; date: string; isNewPP: boolean }
  | { type: "pp-summary"; pp: PayPeriod; ppIndex: number };

function buildRowItems(dates: string[], payPeriods: PayPeriod[]): RowItem[] {
  const items: RowItem[] = [];
  const sortedPPs = [...payPeriods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const endedPPs = new Set<string>();

  const findPP = (date: string) => sortedPPs.find((pp) => date >= pp.startDate && date <= pp.endDate);
  let lastPPKey = "";

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const currentPP = findPP(date);
    const ppKey = currentPP?.startDate ?? "";
    const isNewPP = ppKey !== "" && ppKey !== lastPPKey;
    if (ppKey !== "") lastPPKey = ppKey;
    items.push({ type: "date", date, isNewPP });

    const nextDate = dates[i + 1];
    for (let ppIdx = 0; ppIdx < sortedPPs.length; ppIdx++) {
      const pp = sortedPPs[ppIdx];
      const ppStartKey = pp.startDate;
      if (endedPPs.has(ppStartKey)) continue;
      if (pp.startDate > dates[dates.length - 1]) continue;
      if (date === pp.endDate || (date <= pp.endDate && (!nextDate || nextDate > pp.endDate))) {
        items.push({ type: "pp-summary", pp, ppIndex: ppIdx });
        endedPPs.add(ppStartKey);
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
  canEdit = true,
  providers,
  assignments: initialAssignments,
  shiftTypes,
  payPeriods,
  holidays,
  providerOverrides,
  staffingMins,
  staffingReqs,
  fairnessData,
  fairnessAverages,
  followRules,
  countColumns = [],
  dateFormat: dateFormatProp,
}: Props) {
  const dateFormat = (dateFormatProp || DEFAULT_DATE_FORMAT) as DateFormatKey;
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [localAssignments, setLocalAssignments] = useState(initialAssignments);
  const [picker, setPicker] = useState<PickerState>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<{ providerId: string; date: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const [activeCol, setActiveCol] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [autoSuggestions, setAutoSuggestions] = useState<Array<{
    providerId: string;
    date: string;
    shiftTypeId: string;
    code: string;
    reason: string;
    step: string;
    confidence: number;
  }> | null>(null);
  const [autoWarnings, setAutoWarnings] = useState<string[]>([]);
  const [autoStats, setAutoStats] = useState<{ totalSlotsFilled: number; byStep: Record<string, number> } | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);

  type SuggestionEntry = NonNullable<typeof autoSuggestions>[0];
  const suggestionSet = useMemo(() => {
    if (!autoSuggestions) return new Set<string>();
    return new Set(autoSuggestions.map((s) => `${s.providerId}:${s.date}`));
  }, [autoSuggestions]);

  const suggestionMap = useMemo(() => {
    if (!autoSuggestions) return new Map<string, SuggestionEntry>();
    const m = new Map<string, SuggestionEntry>();
    for (const s of autoSuggestions) m.set(`${s.providerId}:${s.date}`, s);
    return m;
  }, [autoSuggestions]);

  // Multi-select state
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<{ providerId: string; date: string } | null>(null);

  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showPPRows, setShowPPRows] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("yosched:showPPRows");
    return saved !== null ? saved === "true" : false;
  });
  const monthPickerRef = useRef<HTMLDivElement>(null);

  // Shift+drag-select state
  const dragSelecting = useRef(false);
  const dragSelectMoved = useRef(false);
  const dragSelectAnchor = useRef<{ providerId: string; date: string } | null>(null);

  // Undo/redo stacks — each entry is a group of changes applied together
  type UndoOp = { providerId: string; date: string; prev: AssignmentData | null; next: AssignmentData | null };
  type UndoEntry = UndoOp[];
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const dates = useMemo(
    () => getMonthDateRange(viewYear, viewMonth, payPeriods),
    [viewYear, viewMonth, payPeriods],
  );

  const firstOfMonth = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
  const lastOfMonth = toDateStr(new Date(viewYear, viewMonth + 1, 0));

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const row = el.querySelector(`tr[data-date="${firstOfMonth}"]`) as HTMLElement | null;
    const thead = el.querySelector("thead") as HTMLElement | null;
    if (row && thead) {
      el.scrollTop = row.offsetTop - thead.offsetHeight;
    }
  }, [firstOfMonth]);

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

  const hotkeyMap = useMemo(() => {
    const map = new Map<string, ShiftType>();
    for (const st of shiftTypes) {
      if (st.hotkey) map.set(st.hotkey.toUpperCase(), st);
    }
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
          const key = `${p.id}:${dateStr}`;
          const a = assignmentMap.get(key);
          const sug = !a ? suggestionMap.get(key) : null;
          const stId = a?.shiftTypeId ?? sug?.shiftTypeId;
          if (stId && shiftCountsTowardFte(stId)) {
            const dow = cursor.getDay();
            const isWeekend = dow === 0 || dow === 6;
            const st = shiftTypeMap.get(stId);
            if (!isWeekend || st?.countsOnWeekend) {
              hours += getHoursForAssignment(p.id, stId);
            }
          }
          cursor.setDate(cursor.getDate() + 1);
        }
        providerHours.set(p.id, hours);
      }
      result.set(pp.startDate, providerHours);
    }
    return result;
  }, [sortedPPs, providers, assignmentMap, suggestionMap, overrideMap, shiftTypeMap]);

  const followRuleMap = useMemo(() => buildFollowRuleMap(followRules ?? []), [followRules]);

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
          followRuleMap,
        });
        if (warnings.length > 0) {
          map.set(`${p.id}:${date}`, warnings);
        }
      }
    }
    return map;
  }, [dates, providers, assignmentMap, shiftTypeMap, holidaySet, staffingMins, followRuleMap]);

  // Compute per-day staffing warnings
  const dayWarnings = useMemo(() => {
    const map = new Map<string, Warning[]>();
    for (const date of dates) {
      const warnings = checkDayStaffing({
        date,
        providers,
        assignmentMap,
        shiftTypeMap,
        holidaySet,
        staffingMins,
        staffingReqs,
      });
      if (warnings.length > 0) {
        map.set(date, warnings);
      }
    }
    return map;
  }, [dates, providers, assignmentMap, shiftTypeMap, holidaySet, staffingMins, staffingReqs]);

  const columnCounts = useMemo(() => {
    return countColumns.map((col) => {
      const codeSet = new Set(col.shiftCodes);
      const counts: Record<string, number> = {};
      for (const date of dates) {
        let count = 0;
        for (const p of providers) {
          const key = `${p.id}:${date}`;
          const a = assignmentMap.get(key);
          const sug = !a ? suggestionMap.get(key) : null;
          const code = a?.code ?? sug?.code;
          if (code && codeSet.has(code)) count++;
        }
        counts[date] = count;
      }
      return counts;
    });
  }, [dates, providers, assignmentMap, suggestionMap, countColumns]);

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
    setActiveRow(date);
    setActiveCol(providerId);
    if (!canEdit) return;
    const existing = assignmentMap.get(`${providerId}:${date}`);
    if (existing?.isLocked) return;

    const cellKey = `${providerId}:${date}`;

    if (e.shiftKey) {
      if (dragSelectMoved.current) { dragSelectMoved.current = false; return; }
      // Shift+click: rectangular range select from anchor
      if (selectionAnchor) {
        setSelection(computeRectSelection(selectionAnchor, { providerId, date }));
      } else {
        setSelection(new Set([cellKey]));
        setSelectionAnchor({ providerId, date });
      }
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+click: toggle cell in selection, no picker
      setSelection((prev) => {
        const next = new Set(prev);
        if (next.has(cellKey)) {
          next.delete(cellKey);
        } else {
          const firstKey = [...next][0];
          if (firstKey) {
            const existingProvider = firstKey.split(":")[0];
            if (existingProvider !== providerId) {
              return new Set([cellKey]);
            }
          }
          next.add(cellKey);
        }
        return next;
      });
      if (!selectionAnchor) setSelectionAnchor({ providerId, date });
      return;
    }

    // Plain click on a selected cell — open picker, keep selection
    if (selection.size > 0 && selection.has(cellKey)) {
      const pos = pickerPositionForCell(providerId, date);
      setPicker({ providerId, date, ...pos });
      return;
    }

    // Plain click on non-selected cell — select it, no picker
    setSelection(new Set());
    setSelectionAnchor({ providerId, date });
    setPicker(null);
  }

  function pickerPositionForCell(providerId: string, date: string): { x: number; y: number } {
    const el = document.querySelector(`[data-cell="${providerId}:${date}"]`);
    if (el) {
      const rect = el.getBoundingClientRect();
      return { x: rect.right, y: rect.bottom };
    }
    return { x: 200, y: 200 };
  }

  function handleCellContextMenu(providerId: string, date: string, e: React.MouseEvent) {
    e.preventDefault();
    if (!canEdit) return;
    const existing = assignmentMap.get(`${providerId}:${date}`);
    if (existing?.isLocked) return;
    setActiveRow(date);
    setActiveCol(providerId);
    const cellKey = `${providerId}:${date}`;
    if (selection.size === 0 || !selection.has(cellKey)) {
      setSelection(new Set());
      setSelectionAnchor({ providerId, date });
    }
    const pos = pickerPositionForCell(providerId, date);
    setPicker({ providerId, date, ...pos });
  }

  function computeRectSelection(anchor: { providerId: string; date: string }, target: { providerId: string; date: string }): Set<string> {
    const aDateIdx = dates.indexOf(anchor.date);
    const tDateIdx = dates.indexOf(target.date);
    const aProvIdx = providers.findIndex((p) => p.id === anchor.providerId);
    const tProvIdx = providers.findIndex((p) => p.id === target.providerId);
    if (aDateIdx === -1 || tDateIdx === -1 || aProvIdx === -1 || tProvIdx === -1) return new Set();
    const dStart = Math.min(aDateIdx, tDateIdx);
    const dEnd = Math.max(aDateIdx, tDateIdx);
    const pStart = Math.min(aProvIdx, tProvIdx);
    const pEnd = Math.max(aProvIdx, tProvIdx);
    const sel = new Set<string>();
    for (let di = dStart; di <= dEnd; di++) {
      for (let pi = pStart; pi <= pEnd; pi++) {
        const k = `${providers[pi].id}:${dates[di]}`;
        if (!assignmentMap.get(k)?.isLocked) sel.add(k);
      }
    }
    return sel;
  }

  function handleCellMouseDown(providerId: string, date: string, e: React.MouseEvent) {
    if (!canEdit || e.button !== 0 || !e.shiftKey) return;
    e.preventDefault();
    dragSelecting.current = true;
    dragSelectMoved.current = false;
    const anchor = selectionAnchor ?? { providerId, date };
    dragSelectAnchor.current = anchor;
    setSelection(computeRectSelection(anchor, { providerId, date }));
    if (!selectionAnchor) setSelectionAnchor({ providerId, date });
    setActiveRow(date);
    setActiveCol(providerId);
    setPicker(null);
  }

  function handleCellMouseEnter(providerId: string, date: string) {
    if (!dragSelecting.current || !dragSelectAnchor.current) return;
    dragSelectMoved.current = true;
    const sel = computeRectSelection(dragSelectAnchor.current, { providerId, date });
    setSelection(sel);
    setActiveRow(date);
    setActiveCol(providerId);
  }

  useEffect(() => {
    function onMouseUp() {
      dragSelecting.current = false;
    }
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, []);

  useEffect(() => {
    if (!showMonthPicker) return;
    function onClick(e: MouseEvent) {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node)) {
        setShowMonthPicker(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showMonthPicker]);

  function pushUndo(ops: UndoOp[]) {
    undoStack.current.push(ops);
    redoStack.current = [];
  }

  async function applyAssignment(providerId: string, date: string, assignment: AssignmentData | null) {
    setSaving(`${providerId}:${date}`);
    if (assignment) {
      setLocalAssignments((prev) => {
        const filtered = prev.filter((a) => !(a.providerId === providerId && a.date === date));
        return [...filtered, assignment];
      });
      try {
        const res = await fetch("/api/assignments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId, date, shiftTypeId: assignment.shiftTypeId }),
        });
        const saved = await res.json();
        setLocalAssignments((prev) =>
          prev.map((a) => (a.providerId === providerId && a.date === date ? saved : a)),
        );
      } catch { /* optimistic stays */ }
    } else {
      setLocalAssignments((prev) =>
        prev.filter((a) => !(a.providerId === providerId && a.date === date)),
      );
      try {
        await fetch("/api/assignments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId, date }),
        });
      } catch { /* optimistic stays */ }
    }
    setSaving(null);
  }

  async function handleUndo() {
    const group = undoStack.current.pop();
    if (!group) return;
    redoStack.current.push(group);
    await Promise.all(group.map((op) => applyAssignment(op.providerId, op.date, op.prev)));
  }

  async function handleRedo() {
    const group = redoStack.current.pop();
    if (!group) return;
    undoStack.current.push(group);
    await Promise.all(group.map((op) => applyAssignment(op.providerId, op.date, op.next)));
  }

  const undoRef = useRef(handleUndo);
  const redoRef = useRef(handleRedo);
  const clearRef = useRef<(target?: { providerId: string; date: string }) => Promise<void>>(async () => {});
  useEffect(() => { undoRef.current = handleUndo; }, [handleUndo]);
  useEffect(() => { redoRef.current = handleRedo; }, [handleRedo]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (showMonthPicker) {
        if (e.key === "Escape") setShowMonthPicker(false);
        return;
      }
      if (canEdit && (e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      }
      if (canEdit && (e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redoRef.current();
      }
      if (e.key === "Escape" && !picker) {
        setSelection(new Set());
        setSelectionAnchor(null);
        setActiveRow(null);
        setActiveCol(null);
      }
      if (e.key === "Tab" && !picker && canEdit && activeRow && activeCol) {
        e.preventDefault();
        const existing = assignmentMap.get(`${activeCol}:${activeRow}`);
        if (!existing?.isLocked) {
          if (selection.size === 0) {
            setSelectionAnchor({ providerId: activeCol, date: activeRow });
          }
          const pos = pickerPositionForCell(activeCol, activeRow);
          setPicker({ providerId: activeCol, date: activeRow, ...pos });
        }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !picker && canEdit && activeRow && activeCol) {
        e.preventDefault();
        if (selection.size > 0) {
          clearRef.current();
        } else {
          clearRef.current({ providerId: activeCol, date: activeRow });
        }
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && !picker && activeRow && activeCol) {
        e.preventDefault();
        const dateIdx = dates.indexOf(activeRow);
        const provIdx = providers.findIndex((p) => p.id === activeCol);
        if (dateIdx === -1 || provIdx === -1) return;
        let newDateIdx = dateIdx;
        let newProvIdx = provIdx;
        if (e.key === "ArrowUp") newDateIdx = Math.max(0, dateIdx - 1);
        if (e.key === "ArrowDown") newDateIdx = Math.min(dates.length - 1, dateIdx + 1);
        if (e.key === "ArrowLeft") newProvIdx = Math.max(0, provIdx - 1);
        if (e.key === "ArrowRight") newProvIdx = Math.min(providers.length - 1, provIdx + 1);
        const newDate = dates[newDateIdx];
        const newProv = providers[newProvIdx];
        setActiveRow(newDate);
        setActiveCol(newProv.id);
        const el = document.querySelector(`[data-cell="${newProv.id}:${newDate}"]`);
        el?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      if (!picker && canEdit && e.key.length === 1 && /^[a-zA-Z]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey && (activeRow || selection.size > 0)) {
        const st = hotkeyMap.get(e.key.toUpperCase());
        if (st) {
          e.preventDefault();
          hotkeyAssignRef.current(st);
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [picker, canEdit, activeRow, activeCol, assignmentMap, dates, providers, hotkeyMap, selection, showMonthPicker]);

  const hotkeyAssign = useCallback(async (st: ShiftType) => {
    const cells: { providerId: string; date: string }[] = [];
    if (selection.size > 0) {
      for (const key of selection) {
        if (assignmentMap.get(key)?.isLocked) continue;
        const [pid, d] = key.split(":");
        cells.push({ providerId: pid, date: d });
      }
    } else if (activeCol && activeRow) {
      const existing = assignmentMap.get(`${activeCol}:${activeRow}`);
      if (existing?.isLocked) return;
      cells.push({ providerId: activeCol, date: activeRow });
    }
    if (cells.length === 0) return;

    const undoOps: UndoOp[] = cells.map(({ providerId, date }) => {
      const prev = assignmentMap.get(`${providerId}:${date}`) ?? null;
      const next: AssignmentData = {
        id: `temp-${providerId}:${date}`,
        providerId,
        date,
        shiftTypeId: st.id,
        isLocked: false,
        code: st.code,
        color: st.color,
      };
      return { providerId, date, prev, next };
    });
    pushUndo(undoOps);

    setPicker(null);
    setSelection(new Set());
    setSelectionAnchor(null);
    setSaving("bulk");

    setLocalAssignments((prev) => {
      const keys = new Set(cells.map((c) => `${c.providerId}:${c.date}`));
      const filtered = prev.filter((a) => !keys.has(`${a.providerId}:${a.date}`));
      const temps = cells.map((c) => ({
        id: `temp-${c.providerId}:${c.date}`,
        providerId: c.providerId,
        date: c.date,
        shiftTypeId: st.id,
        isLocked: false,
        code: st.code,
        color: st.color,
      }));
      return [...filtered, ...temps];
    });

    try {
      const res = await fetch("/api/assignments/bulk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells, shiftTypeId: st.id }),
      });
      if (res.ok) {
        const { applied } = await res.json() as { applied: AssignmentData[] };
        setLocalAssignments((prev) => {
          const savedKeys = new Set(applied.map((s) => `${s.providerId}:${s.date}`));
          return [...prev.filter((a) => !savedKeys.has(`${a.providerId}:${a.date}`)), ...applied];
        });
      }
    } catch { /* optimistic stays */ }
    setSaving(null);
  }, [selection, activeCol, activeRow, assignmentMap]);

  const hotkeyAssignRef = useRef(hotkeyAssign);
  useEffect(() => { hotkeyAssignRef.current = hotkeyAssign; }, [hotkeyAssign]);

  const handleSelect = useCallback(async (shiftTypeId: string) => {
    if (!picker) return;
    const st = shiftTypeMap.get(shiftTypeId);
    if (!st) return;

    // Determine cells to assign: selection or single cell
    const cells: { providerId: string; date: string }[] = [];
    if (selection.size > 0) {
      for (const key of selection) {
        if (assignmentMap.get(key)?.isLocked) continue;
        const [pid, d] = key.split(":");
        cells.push({ providerId: pid, date: d });
      }
    } else {
      cells.push({ providerId: picker.providerId, date: picker.date });
    }
    if (cells.length === 0) { setPicker(null); return; }

    // Build undo group
    const undoOps: UndoOp[] = cells.map(({ providerId, date }) => {
      const key = `${providerId}:${date}`;
      const prev = assignmentMap.get(key) ?? null;
      const next: AssignmentData = {
        id: `temp-${key}`,
        providerId,
        date,
        shiftTypeId,
        isLocked: false,
        code: st.code,
        color: st.color,
      };
      return { providerId, date, prev, next };
    });
    pushUndo(undoOps);

    setPicker(null);
    setSelection(new Set());
    setSelectionAnchor(null);
    setSaving("bulk");

    // Optimistic update
    setLocalAssignments((prev) => {
      const keys = new Set(cells.map((c) => `${c.providerId}:${c.date}`));
      const filtered = prev.filter((a) => !keys.has(`${a.providerId}:${a.date}`));
      const temps = cells.map((c) => ({
        id: `temp-${c.providerId}:${c.date}`,
        providerId: c.providerId,
        date: c.date,
        shiftTypeId,
        isLocked: false,
        code: st.code,
        color: st.color,
      }));
      return [...filtered, ...temps];
    });

    try {
      if (cells.length === 1) {
        const { providerId, date } = cells[0];
        const res = await fetch("/api/assignments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId, date, shiftTypeId }),
        });
        const saved = await res.json();
        setLocalAssignments((prev) =>
          prev.map((a) => (a.providerId === providerId && a.date === date ? saved : a)),
        );
      } else {
        const res = await fetch("/api/assignments/bulk", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells, shiftTypeId }),
        });
        const { applied: saved }: { applied: AssignmentData[] } = await res.json();
        setLocalAssignments((prev) => {
          const keys = new Set(saved.map((s) => `${s.providerId}:${s.date}`));
          const filtered = prev.filter((a) => !keys.has(`${a.providerId}:${a.date}`));
          return [...filtered, ...saved];
        });
      }
    } catch {
      // Revert temps on failure
      setLocalAssignments((prev) => prev.filter((a) => !a.id.startsWith("temp-")));
    } finally {
      setSaving(null);
    }
  }, [picker, shiftTypeMap, assignmentMap, selection]);

  const handleClear = useCallback(async (target?: { providerId: string; date: string }) => {
    const anchor = target ?? (picker ? { providerId: picker.providerId, date: picker.date } : null);
    if (!anchor && selection.size === 0) return;

    // Explicit target (Delete key) always clears just that cell;
    // selection path only used from picker (no target)
    const cells: { providerId: string; date: string }[] = [];
    if (!target && selection.size > 0) {
      for (const key of selection) {
        const a = assignmentMap.get(key);
        if (a && !a.isLocked) {
          const [pid, d] = key.split(":");
          cells.push({ providerId: pid, date: d });
        }
      }
    } else if (anchor) {
      const key = `${anchor.providerId}:${anchor.date}`;
      const a = assignmentMap.get(key);
      if (a && !a.isLocked) {
        cells.push(anchor);
      }
    }

    if (cells.length === 0) { setPicker(null); return; }

    // Build undo group
    const undoOps: UndoOp[] = cells.map(({ providerId, date }) => ({
      providerId,
      date,
      prev: assignmentMap.get(`${providerId}:${date}`) ?? null,
      next: null,
    }));
    pushUndo(undoOps);

    setPicker(null);
    setSelection(new Set());
    setSelectionAnchor(null);
    setSaving("bulk");

    // Optimistic removal
    const keys = new Set(cells.map((c) => `${c.providerId}:${c.date}`));
    setLocalAssignments((prev) =>
      prev.filter((a) => !keys.has(`${a.providerId}:${a.date}`)),
    );

    try {
      if (cells.length === 1) {
        await fetch("/api/assignments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cells[0]),
        });
      } else {
        await fetch("/api/assignments/bulk", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells }),
        });
      }
    } catch {
      window.location.reload();
    } finally {
      setSaving(null);
    }
  }, [picker, assignmentMap, selection]);
  useEffect(() => { clearRef.current = handleClear; }, [handleClear]);

  const closePicker = useCallback(() => {
    setPicker(null);
  }, []);

  function handleDragStart(providerId: string, date: string, e: React.DragEvent) {
    if (!canEdit) { e.preventDefault(); return; }
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

    pushUndo([
      { providerId: fromProviderId, date: fromDate, prev: fromA, next: toA ?? null },
      { providerId: toProviderId, date: toDate, prev: toA ?? null, next: { ...fromA, providerId: toProviderId, date: toDate, id: `temp-${toKey}` } },
    ]);

    setSaving(fromKey);

    // Optimistic update
    setLocalAssignments((prev) => {
      const next = prev.filter(
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
        const next = prev.filter(
          (a) => (!a.id.startsWith("temp-")
            || (a.providerId !== fromProviderId && a.providerId !== toProviderId))
            && !(a.providerId === toProviderId && a.date === toDate)
            && !(a.providerId === fromProviderId && a.date === fromDate)
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

  // Compute warnings for picker preview (uses picker cell for single, first selected cell for bulk)
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
        followRuleMap,
      });
      if (warnings.length > 0) {
        result.set(st.id, warnings);
      }
    }
    return result;
  }, [picker, providerMap, shiftTypes, shiftTypeMap, assignmentMap, providers, holidaySet, staffingMins, followRuleMap]);

  function renderSuggestion(sug: SuggestionEntry, stMap: Map<string, ShiftType>) {
    const st = stMap.get(sug.shiftTypeId);
    const color = st?.color ?? "#6b7280";
    const isHeavy = st ? followRuleMap.has(st.id) : false;
    const isOff = st?.isOffShift;
    return (
      <div
        className={[
          "font-bold rounded px-1 py-0.5 leading-tight border border-dashed",
          isHeavy ? "text-[12px]" : "text-[11px]",
        ].join(" ")}
        style={{
          backgroundColor: isOff ? "transparent" : color + (isHeavy ? "50" : "30"),
          color: isOff ? "#64748b" : color,
          borderColor: isHeavy ? color + "90" : color + "40",
          borderStyle: isHeavy ? "solid" : "dashed",
        }}
        title={`Suggested: ${sug.code}\n${sug.reason}`}
      >
        {sug.code}
      </div>
    );
  }

  // Selection count for picker header
  const selectionCount = selection.size;

  async function runAutoSchedule() {
    setAutoLoading(true);
    try {
      const res = await fetch("/api/auto-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: dates[0],
          endDate: dates[dates.length - 1],
        }),
      });
      const data = await res.json();
      setAutoSuggestions(data.suggestions);
      setAutoWarnings(data.warnings || []);
      setAutoStats(data.stats || null);
    } catch (e) {
      console.error("Auto-schedule failed:", e);
    } finally {
      setAutoLoading(false);
    }
  }

  async function applyAutoSuggestions() {
    if (!autoSuggestions?.length) return;
    setAutoLoading(true);
    try {
      const res = await fetch("/api/auto-schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestions: autoSuggestions }),
      });
      const data = await res.json();
      const applied: AssignmentData[] = data.applied;

      const undoOps: UndoOp[] = applied.map((a) => ({
        providerId: a.providerId,
        date: a.date,
        prev: assignmentMap.get(`${a.providerId}:${a.date}`) ?? null,
        next: a,
      }));

      setLocalAssignments((prev) => {
        const keys = new Set(applied.map((a) => `${a.providerId}:${a.date}`));
        const filtered = prev.filter((a) => !keys.has(`${a.providerId}:${a.date}`));
        return [...filtered, ...applied];
      });

      pushUndo(undoOps);
      setAutoSuggestions(null);
      setAutoWarnings([]);
      setAutoStats(null);
    } catch (e) {
      console.error("Apply failed:", e);
    } finally {
      setAutoLoading(false);
    }
  }

  async function clearAutoScheduled() {
    if (!dates.length) return;
    setAutoLoading(true);
    try {
      const res = await fetch("/api/auto-schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: dates[0], endDate: dates[dates.length - 1] }),
      });
      const data = await res.json();
      const removed: AssignmentData[] = data.removed;

      if (removed.length === 0) {
        setAutoLoading(false);
        return;
      }

      const undoOps: UndoOp[] = removed.map((a) => ({
        providerId: a.providerId,
        date: a.date,
        prev: a,
        next: null,
      }));

      const keys = new Set(removed.map((a) => `${a.providerId}:${a.date}`));
      setLocalAssignments((prev) => prev.filter((a) => !keys.has(`${a.providerId}:${a.date}`)));

      pushUndo(undoOps);
    } catch (e) {
      console.error("Clear auto-scheduled failed:", e);
    } finally {
      setAutoLoading(false);
    }
  }

  const alerts = useMemo(() => {
    const items: Array<{ date: string; label: string; type: "error" | "warn" }> = [];
    const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    for (const date of dates) {
      const dow = parseDate(date).getDay();
      const d = `${DAY[dow]} ${date.slice(5)}`;
      const dw = dayWarnings.get(date);
      if (dw) {
        for (const w of dw) {
          items.push({
            date,
            label: `${d} — ${w.message}`,
            type: w.type === "shift-count" ? "error" : "warn",
          });
        }
      }
    }
    return items;
  }, [dates, dayWarnings]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Print-only title */}
      <div data-print-title className="hidden">
        {MONTH_NAMES[viewMonth]} {viewYear}
      </div>

      {/* Toolbar */}
      <div data-print-hide className="flex items-center gap-2 px-6 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
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
        <div className="relative ml-4" ref={monthPickerRef}>
          <button
            onClick={() => setShowMonthPicker((v) => !v)}
            className="text-base font-semibold text-slate-200 hover:text-white hover:bg-slate-700 px-2 py-0.5 rounded transition-colors"
          >
            {MONTH_NAMES[viewMonth]} {viewYear}
          </button>
          {showMonthPicker && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-3 w-[240px]">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => setViewYear((y) => y - 1)} className="px-2 py-0.5 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded">←</button>
                <span className="text-sm font-semibold text-slate-200">{viewYear}</span>
                <button onClick={() => setViewYear((y) => y + 1)} className="px-2 py-0.5 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded">→</button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {MONTH_NAMES.map((name, i) => (
                  <button
                    key={i}
                    onClick={() => { setViewMonth(i); setShowMonthPicker(false); }}
                    className={[
                      "px-2 py-1.5 text-xs rounded transition-colors",
                      i === viewMonth ? "bg-blue-600 text-white font-semibold" : "text-slate-300 hover:bg-slate-700",
                    ].join(" ")}
                  >
                    {name.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <span className="ml-2 text-xs text-slate-500">
          {formatDate(parseDate(dates[0]), dateFormat)} – {formatDate(parseDate(dates[dates.length - 1]), dateFormat)}
        </span>
        <button
          onClick={() => setShowPPRows((v) => { const next = !v; localStorage.setItem("yosched:showPPRows", String(next)); return next; })}
          className={["ml-4 px-3 py-1 text-sm rounded transition-colors", showPPRows ? "bg-indigo-700 hover:bg-indigo-600 text-indigo-100" : "bg-slate-700 hover:bg-slate-600 text-slate-400"].join(" ")}
          title="Toggle pay period hour totals"
        >
          PP Totals
        </button>
        <button
          onClick={() => window.print()}
          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300"
          title="Print this month"
        >
          Print
        </button>
        {canEdit && (
        <div className="ml-auto flex items-center gap-2">
          {selection.size > 0 && (
            <span className="text-xs text-emerald-400 font-medium">
              {selection.size} selected
            </span>
          )}
          <button
            onClick={clearAutoScheduled}
            disabled={autoLoading}
            className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded transition-colors text-red-400 font-medium"
            title="Remove all auto-scheduled assignments (keeps manual entries)"
          >
            Clear Auto
          </button>
          <button
            onClick={runAutoSchedule}
            disabled={autoLoading}
            className="px-3 py-1 text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded transition-colors text-emerald-100 font-medium"
            title="Auto-fill empty slots using fairness-weighted scheduling"
          >
            {autoLoading ? "Working..." : "Auto-Schedule"}
          </button>
          <button
            onClick={handleUndo}
            className="px-2 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-400"
            title="Undo (Ctrl+Z)"
          >
            ↩
          </button>
          <button
            onClick={handleRedo}
            className="px-2 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-400"
            title="Redo (Ctrl+Shift+Z)"
          >
            ↪
          </button>
        </div>
        )}
      </div>

      {/* Auto-schedule review panel */}
      {autoSuggestions && (
        <div data-print-hide className="px-6 py-3 bg-emerald-950/50 border-b border-emerald-800 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold text-emerald-300">
                Auto-Schedule: {autoSuggestions.length} suggestions
              </span>
              {autoStats && (
                <span className="text-xs text-emerald-400/70">
                  {Object.entries(autoStats.byStep).map(([k, v]) => `${k}: ${v}`).join(" | ")}
                </span>
              )}
              {autoWarnings.length > 0 && (
                <span className="text-xs text-amber-400" title={autoWarnings.join("\n")}>
                  {autoWarnings.length} warning{autoWarnings.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={applyAutoSuggestions}
                disabled={autoLoading}
                className="px-3 py-1 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded transition-colors text-white font-medium"
              >
                Accept All
              </button>
              <button
                onClick={() => { setAutoSuggestions(null); setAutoWarnings([]); setAutoStats(null); }}
                className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
      {/* Scrollable grid area */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <table className="border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-800">
              <th className="sticky left-0 z-20 bg-slate-800 px-3 py-2 text-left text-xs font-medium text-slate-400 border-b border-r border-slate-700 w-[88px] min-w-[88px]">
                Date
              </th>
              {providers.map((p) => {
                const isActiveCol = activeCol === p.id;
                const fe = fairnessData?.[p.id];
                const fColor = fe ? fairnessColor(fe.deviation.overall) : undefined;
                const fLabel = fe ? fairnessLabel(fe.deviation.overall) : undefined;
                const empLabel = p.employmentTypeName === "FTE"
                  ? `${p.ftePercentage * 100}% FTE`
                  : p.employmentTypeName;
                const zFmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}σ`;
                const fte = p.ftePercentage || 1;
                const fTooltip = fe
                  ? `${p.name} (${empLabel})\n` +
                    `Equity: ${zFmt(fe.displayDeviation.overall)}\n` +
                    `Desirability: ${zFmt(-fe.displayDeviation.desirability)}\n` +
                    `Holiday: ${fe.metrics.holidayWorkCount} (avg ${((fairnessAverages?.holidayWorkCount ?? 0) * fte).toFixed(1)})\n` +
                    `CALL: ${fe.metrics.shiftCounts["CALL"] ?? 0} (avg ${((fairnessAverages?.perShift["CALL"] ?? 0) * fte).toFixed(1)})\n` +
                    `ORC: ${fe.metrics.shiftCounts["ORC"] ?? 0} (avg ${((fairnessAverages?.perShift["ORC"] ?? 0) * fte).toFixed(1)})\n` +
                    `ORL: ${fe.metrics.shiftCounts["ORL"] ?? 0} (avg ${((fairnessAverages?.perShift["ORL"] ?? 0) * fte).toFixed(1)})`
                  : `${p.name} (${empLabel})`;
                return (
                  <th
                    key={p.id}
                    className="px-1 py-1 text-center text-xs font-medium border-b border-slate-700 w-[44px] min-w-[44px] transition-colors cursor-pointer"
                    style={isActiveCol || hoverCol === p.id ? { backgroundColor: "rgba(29,78,216,0.7)" } : undefined}
                    title={fTooltip}
                    onClick={() => setActiveCol(activeCol === p.id ? null : p.id)}
                    onMouseEnter={() => setHoverCol(p.id)}
                    onMouseLeave={() => setHoverCol(null)}
                  >
                    <span className={[
                      !p.isAutoScheduled ? "text-amber-400" : "text-slate-300",
                      isActiveCol ? "!text-blue-200 font-bold" : "",
                    ].join(" ")}>
                      {p.initials}
                    </span>
                  </th>
                );
              })}
              {countColumns.map((col, ci) => (
                <th key={ci} className="px-2 py-2 text-center text-xs font-medium text-slate-400 border-b border-l border-slate-700 w-[32px] min-w-[32px]">
                  {col.label || "#"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowItems.map((item) => {
              if (item.type === "pp-summary") {
                if (!showPPRows) return null;
                const { pp, ppIndex } = item;
                const provHours = ppHours.get(pp.startDate);
                return (
                  <tr key={`pp-${pp.startDate}`} className="bg-slate-800/80">
                    <td
                      className="sticky left-0 z-[5] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-r border-slate-600 whitespace-nowrap border-y border-y-indigo-500/60"
                      style={{ background: "#1a2340" }}
                    >
                      <span className="text-indigo-400">PP {ppIndex + 1}</span>
                      <span className="text-slate-500 ml-1">+/–</span>
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

                      const diffLabel = diff >= 0 ? `+${diff}` : `${diff}`;

                      return (
                        <td
                          key={p.id}
                          className="px-0 py-1 text-center border-slate-600/50 border border-y-indigo-500/60"
                          title={`${p.initials}: ${hours}hrs / ${target}hrs target (${diffLabel})`}
                        >
                          <div className={`text-[10px] font-mono font-bold ${color}`}>
                            {hours > 0 ? diffLabel : "–"}
                          </div>
                        </td>
                      );
                    })}
                    {countColumns.length > 0 ? (
                      <td colSpan={countColumns.length} className="px-2 py-1 text-center text-[10px] font-mono border-l border-slate-600 text-indigo-400/60 border-y border-y-indigo-500/60" />
                    ) : (
                      <td className="border-y border-y-indigo-500/60" />
                    )}
                  </tr>
                );
              }

              const { date } = item;
              const label = formatDateLabel(date, dateFormat);
              const isWeekend = label.dow === 0 || label.dow === 6;
              const isHoliday = holidaySet.has(date);
              const isOutsideMonth = date < firstOfMonth || date > lastOfMonth;
              const isToday = date === toDateStr(today);

              const currentPP = findPayPeriod(date, sortedPPs);
              const { isNewPP } = item;
              const ppIdx = currentPP ? sortedPPs.indexOf(currentPP) : -1;
              const ppEven = ppIdx !== -1 && ppIdx % 2 === 0;

              const dw = dayWarnings.get(date);
              const isActiveRow = activeRow === date;

              return (
                <tr
                  key={date}
                  data-date={date}
                  data-weekend={isWeekend || undefined}
                  data-holiday={isHoliday || undefined}
                  className={[
                    isOutsideMonth ? "opacity-40" : "",
                    isWeekend && !isOutsideMonth ? "bg-slate-800/50" : "",
                    isHoliday ? "bg-amber-950/20" : "",
                    isToday ? "ring-1 ring-inset ring-blue-500/50" : "",
                    "transition-colors",
                  ].join(" ")}
                >
                  <td
                    className={[
                      "sticky left-0 z-[5] px-2 py-1 text-xs font-mono border-r border-slate-700 whitespace-nowrap cursor-pointer hover:brightness-125",
                      isNewPP ? "border-t-2 border-t-indigo-500" : "",
                    ].join(" ")}
                    style={{ background: isActiveRow ? "rgba(29,78,216,0.7)" : isOutsideMonth ? "#0d1321" : isWeekend ? "#1a2236" : "#0f172a" }}
                    onClick={() => setActiveRow(activeRow === date ? null : date)}
                  >
                    <span className={isActiveRow ? "text-blue-200 font-bold" : isWeekend ? "text-slate-500" : "text-slate-300"}>
                      {label.day}
                    </span>{" "}
                    <span className={isActiveRow ? "text-blue-200" : isOutsideMonth ? "text-slate-600" : "text-slate-400"}>
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
                    const isSelected = selection.has(cellKey);
                    const isActiveCell = activeCol === p.id && isActiveRow;
                    const suggestion = suggestionMap.get(cellKey);
                    const isSuggested = !!suggestion;

                    return (
                      <td
                        key={p.id}
                        data-cell={cellKey}
                        className={[
                          `px-0.5 py-0.5 text-center border-slate-700/30 border relative ${canEdit ? "cursor-pointer" : "cursor-default"}`,
                          isNewPP ? "border-t-2 border-t-indigo-500" : "",
                          !ppEven ? "bg-slate-800/20" : "",
                          isPickerTarget ? "ring-1 ring-inset ring-blue-400" : "",
                          isSelected ? "ring-2 ring-inset ring-emerald-400 bg-emerald-900/20" : "",
                          isDragTarget ? "ring-2 ring-inset ring-cyan-400 bg-cyan-900/20" : "",
                          isDragSrc ? "opacity-30" : "",
                          isSuggested && !a ? "bg-emerald-900/30" : "",
                          !a && !isSaving && !isSuggested ? "hover:bg-slate-700/30" : "",
                          isActiveCell ? "ring-2 ring-inset ring-blue-400 z-[2]" : "",
                        ].join(" ")}
                        style={isActiveCell ? { backgroundColor: "rgba(29,78,216,0.45)" } : undefined}
                        onMouseDown={(e) => handleCellMouseDown(p.id, date, e)}
                        onMouseEnter={() => { handleCellMouseEnter(p.id, date); setHoverCol(p.id); }}
                        onClick={(e) => handleCellClick(p.id, date, e)}
                        onContextMenu={(e) => handleCellContextMenu(p.id, date, e)}
                        onDragOver={(e) => handleDragOver(p.id, date, e)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(p.id, date, e)}
                      >
                        {a ? (
                          <div
                            draggable={canEdit && !a.isLocked}
                            onDragStart={(e) => handleDragStart(p.id, date, e)}
                            onDragEnd={handleDragEnd}
                            className={[
                              "text-[11px] font-bold rounded px-1 py-0.5 leading-tight",
                              !canEdit ? "cursor-default" : a.isLocked ? "ring-1 ring-yellow-500/50 cursor-not-allowed" : "hover:brightness-125 cursor-grab active:cursor-grabbing",
                              isSaving ? "opacity-50" : "",
                            ].join(" ")}
                            style={{
                              backgroundColor: shiftTypeMap.get(a.shiftTypeId)?.isOffShift ? "transparent" : a.color + "30",
                              color: shiftTypeMap.get(a.shiftTypeId)?.isOffShift ? "#475569" : a.color,
                            }}
                            title={
                              cw && cw.length > 0
                                ? cw.map((w) => w.message).join("\n")
                                : `${p.initials}: ${a.code} on ${formatDate(parseDate(date), dateFormat)}${a.isLocked ? " (locked)" : ""}`
                            }
                          >
                            {a.code}
                          </div>
                        ) : isSuggested ? (
                          renderSuggestion(suggestion!, shiftTypeMap)
                        ) : isSaving ? (
                          <div className="text-[11px] text-slate-600">...</div>
                        ) : null}
                        {cw && <WarningDot warnings={cw} />}
                      </td>
                    );
                  })}
                  {columnCounts.map((counts, ci) => (
                    <td
                      key={ci}
                      className={[
                        "px-2 py-1 text-center text-xs font-mono border-l border-slate-700",
                        isNewPP ? "border-t-2 border-t-indigo-500" : "",
                        dw && dw.length > 0 ? "text-red-400" : "text-slate-400",
                      ].join(" ")}
                    >
                      {counts[date]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Alerts sidebar */}
      {alerts.length > 0 && (
        <div data-print-hide className="w-52 shrink-0 border-l border-slate-700 bg-slate-900/50 overflow-y-auto">
          <div className="sticky top-0 bg-slate-900 px-3 py-2 border-b border-slate-700">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Alerts
            </span>
            <span className="ml-1.5 text-[11px] text-slate-500">{alerts.length}</span>
          </div>
          <div className="px-2 py-1">
            {alerts.map((a, i) => (
              <div
                key={i}
                className="flex items-start gap-1.5 px-1.5 py-1 rounded hover:bg-slate-800/50 cursor-pointer transition-colors"
                onClick={() => {
                  const row = scrollRef.current?.querySelector(`tr[data-date="${a.date}"]`);
                  if (row) {
                    const thead = scrollRef.current?.querySelector("thead");
                    if (scrollRef.current && thead) {
                      scrollRef.current.scrollTop = (row as HTMLElement).offsetTop - thead.clientHeight;
                    }
                  }
                }}
              >
                <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${a.type === "error" ? "bg-red-500" : "bg-amber-500"}`} />
                <span className="text-[11px] text-slate-400 leading-tight">{a.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>

      {/* Shift picker popover */}
      {canEdit && picker && (
        <div data-print-hide>
          <ShiftPicker
            shiftTypes={shiftTypes}
            currentShiftTypeId={selectionCount > 1 ? null : (assignmentMap.get(`${picker.providerId}:${picker.date}`)?.shiftTypeId ?? null)}
            position={{ x: picker.x, y: picker.y }}
            onSelect={handleSelect}
            onClear={() => {
              if (selection.size > 0) {
                handleClear();
              } else if (picker) {
                handleClear({ providerId: picker.providerId, date: picker.date });
              }
            }}
            onClose={closePicker}
            warnings={pickerWarnings}
            bulkCount={selectionCount > 1 ? selectionCount : undefined}
          />
        </div>
      )}
    </div>
  );
}
