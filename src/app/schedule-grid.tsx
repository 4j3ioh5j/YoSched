"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShiftPicker } from "./shift-picker";
import { checkCellWarnings, checkDayStaffing, type Warning } from "@/lib/constraints";
import { fairnessColor, fairnessLabel } from "@/lib/fairness";

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
  noConsecutiveGroup: string | null;
  defaultHours: number;
  countsTowardFte: boolean;
  countsOnWeekend: boolean;
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
};

type Props = {
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
  };
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
      if (pp.startDate > dates[dates.length - 1]) continue;
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
  staffingReqs,
  fairnessData,
  fairnessAverages,
}: Props) {
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

  const staffingCountCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const req of staffingReqs) {
      if (req.minCount > 0) codes.add(req.shiftCode);
    }
    return codes;
  }, [staffingReqs]);

  const staffingCounts = useMemo(() => {
    const counts: Record<string, number | null> = {};
    for (const date of dates) {
      const dow = parseDate(date).getDay();
      const dayKey = holidaySet.has(date) ? "holiday" : String(dow);
      const hasReqs = staffingReqs.some((r) => r.dayKey === dayKey && r.minCount > 0);
      if (!hasReqs) {
        counts[date] = null;
        continue;
      }
      let count = 0;
      for (const p of providers) {
        const key = `${p.id}:${date}`;
        const a = assignmentMap.get(key);
        const sug = !a ? suggestionMap.get(key) : null;
        const code = a?.code ?? sug?.code;
        if (code && staffingCountCodes.has(code)) count++;
      }
      counts[date] = count;
    }
    return counts;
  }, [dates, providers, assignmentMap, suggestionMap, holidaySet, staffingCountCodes, staffingReqs]);

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
    const existing = assignmentMap.get(`${providerId}:${date}`);
    if (existing?.isLocked) return;

    const cellKey = `${providerId}:${date}`;

    if (e.shiftKey) {
      // Shift+click: range select, no picker
      if (selectionAnchor && selectionAnchor.providerId === providerId) {
        const anchorIdx = dates.indexOf(selectionAnchor.date);
        const targetIdx = dates.indexOf(date);
        if (anchorIdx !== -1 && targetIdx !== -1) {
          const start = Math.min(anchorIdx, targetIdx);
          const end = Math.max(anchorIdx, targetIdx);
          const newSel = new Set<string>();
          for (let i = start; i <= end; i++) {
            const k = `${providerId}:${dates[i]}`;
            const a = assignmentMap.get(k);
            if (!a?.isLocked) newSel.add(k);
          }
          setSelection(newSel);
        }
      } else {
        // No anchor or different provider — start fresh selection
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

    // Plain click on a selected cell — open picker for the selection
    if (selection.size > 0 && selection.has(cellKey)) {
      setPicker({ providerId, date, x: e.clientX, y: e.clientY });
      return;
    }

    // Plain click on non-selected cell — clear selection, single-cell picker
    setSelection(new Set());
    setSelectionAnchor({ providerId, date });
    setPicker({ providerId, date, x: e.clientX, y: e.clientY });
  }

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
  undoRef.current = handleUndo;
  redoRef.current = handleRedo;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redoRef.current();
      }
      if (e.key === "Escape" && !picker) {
        setSelection(new Set());
        setSelectionAnchor(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [picker]);

  const handleSelect = useCallback(async (shiftTypeId: string) => {
    if (!picker) return;
    const st = shiftTypeMap.get(shiftTypeId);
    if (!st) return;

    // Determine cells to assign: selection or single cell
    const cells: { providerId: string; date: string }[] = [];
    if (selection.size > 0) {
      for (const key of selection) {
        const [pid, d] = key.split(":");
        cells.push({ providerId: pid, date: d });
      }
    } else {
      cells.push({ providerId: picker.providerId, date: picker.date });
    }

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
        const saved: AssignmentData[] = await res.json();
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

  const handleClear = useCallback(async () => {
    if (!picker) return;

    // Determine cells to clear: selection or single cell
    const cells: { providerId: string; date: string }[] = [];
    if (selection.size > 0) {
      for (const key of selection) {
        const [pid, d] = key.split(":");
        if (assignmentMap.has(key)) cells.push({ providerId: pid, date: d });
      }
    } else {
      const { providerId, date } = picker;
      if (assignmentMap.has(`${providerId}:${date}`)) {
        cells.push({ providerId, date });
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

  const closePicker = useCallback(() => {
    setPicker(null);
  }, []);

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

    pushUndo([
      { providerId: fromProviderId, date: fromDate, prev: fromA, next: toA ?? null },
      { providerId: toProviderId, date: toDate, prev: toA ?? null, next: { ...fromA, providerId: toProviderId, date: toDate, id: `temp-${toKey}` } },
    ]);

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
      });
      if (warnings.length > 0) {
        result.set(st.id, warnings);
      }
    }
    return result;
  }, [picker, providerMap, shiftTypes, shiftTypeMap, assignmentMap, providers, holidaySet, staffingMins]);

  function renderSuggestion(sug: SuggestionEntry, stMap: Map<string, ShiftType>) {
    const st = stMap.get(sug.shiftTypeId);
    const color = st?.color ?? "#6b7280";
    const isHeavy = !!st?.noConsecutiveGroup;
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
      </div>

      {/* Auto-schedule review panel */}
      {autoSuggestions && (
        <div className="px-6 py-3 bg-emerald-950/50 border-b border-emerald-800 shrink-0">
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
                const fTooltip = fe
                  ? `${p.name} (${p.ftePercentage * 100}% FTE)\n` +
                    `Equity: ${fLabel}\n` +
                    `Desirability: ${fe.metrics.desirabilityScore > 0 ? "+" : ""}${fe.metrics.desirabilityScore} (avg ${fairnessAverages?.desirabilityScore.toFixed(1)})\n` +
                    `Holiday work: ${fe.metrics.holidayWorkCount} (avg ${fairnessAverages?.holidayWorkCount.toFixed(1)})\n` +
                    `Work days: ${fe.metrics.totalWorkDays} | Leave: ${fe.metrics.totalLeaveDays}`
                  : `${p.name} (${p.ftePercentage * 100}% FTE)`;
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
                    {fColor && (
                      <div className="flex justify-center mt-0.5">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: fColor }}
                        />
                      </div>
                    )}
                  </th>
                );
              })}
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
                      const isPPHighlighted = activeCol === p.id || hoverCol === p.id;

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
                          style={isPPHighlighted ? { backgroundColor: "rgba(29,78,216,0.35)" } : undefined}
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
              const isActiveRow = activeRow === date;

              return (
                <tr
                  key={date}
                  data-date={date}
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
                    const isHighlighted = activeCol === p.id || hoverCol === p.id || isActiveRow;
                    const suggestion = suggestionMap.get(cellKey);
                    const isSuggested = !!suggestion;

                    return (
                      <td
                        key={p.id}
                        className={[
                          "px-0.5 py-0.5 text-center border-slate-700/30 border cursor-pointer relative",
                          isNewPP ? "border-t-2 border-t-indigo-500" : "",
                          !isHighlighted && !ppEven ? "bg-slate-800/20" : "",
                          isPickerTarget ? "ring-1 ring-inset ring-blue-400" : "",
                          isSelected ? "ring-2 ring-inset ring-emerald-400 bg-emerald-900/20" : "",
                          isDragTarget ? "ring-2 ring-inset ring-cyan-400 bg-cyan-900/20" : "",
                          isDragSrc ? "opacity-30" : "",
                          isSuggested && !a ? "bg-emerald-900/30" : "",
                          !a && !isSaving && !isSuggested ? "hover:bg-slate-700/30" : "",
                        ].join(" ")}
                        style={isHighlighted ? { backgroundColor: "rgba(29,78,216,0.35)" } : undefined}
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
                              backgroundColor: shiftTypeMap.get(a.shiftTypeId)?.isOffShift ? "transparent" : a.color + "30",
                              color: shiftTypeMap.get(a.shiftTypeId)?.isOffShift ? "#475569" : a.color,
                            }}
                            title={
                              cw && cw.length > 0
                                ? cw.map((w) => w.message).join("\n")
                                : `${p.initials}: ${a.code} on ${date}${a.isLocked ? " (locked)" : ""}`
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

      {/* Alerts sidebar */}
      {alerts.length > 0 && (
        <div className="w-52 shrink-0 border-l border-slate-700 bg-slate-900/50 overflow-y-auto">
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
          currentShiftTypeId={selectionCount > 1 ? null : (assignmentMap.get(`${picker.providerId}:${picker.date}`)?.shiftTypeId ?? null)}
          position={{ x: picker.x, y: picker.y }}
          onSelect={handleSelect}
          onClear={handleClear}
          onClose={closePicker}
          warnings={pickerWarnings}
          bulkCount={selectionCount > 1 ? selectionCount : undefined}
        />
      )}
    </div>
  );
}
