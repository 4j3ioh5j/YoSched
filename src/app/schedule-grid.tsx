"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ShiftPicker } from "./shift-picker";
import { checkCellWarnings, checkDayStaffing, type Warning } from "@/lib/constraints";
import { buildAlerts, groupAlertsByDate } from "@/lib/alerts";
import { fairnessColor, fairnessLabel } from "@/lib/fairness";
import { type FollowRuleRow, buildFollowRuleMap } from "@/lib/follow-rules";
import { formatDate, formatDateCompact, type DateFormatKey, DEFAULT_DATE_FORMAT } from "@/lib/date-format";
import { isPastMonth, visibleStaffForMonth } from "@/lib/schedule-visibility";
import { dedicatedColumnInitials } from "@/lib/dedicated-columns";
import { resolveInitials } from "@/lib/dedicated-column-entry";
import { otherColumnInitials } from "@/lib/other-column";
import { printVisibleStaffIds, type PrintRule } from "@/lib/print-column-visibility";
import { requestsForStaffDate, describeRequest, buildRequestPayloads, groupCellsIntoTargets, summarizeCellRequests, type ScheduleRequestData, type PickerMarks, type RequestCategory } from "@/lib/schedule-requests";
import { hashSnapshot, dateInMonth, type SnapshotChange, type ChangeSummary } from "@/lib/versions";

// A schedule request as delivered to the grid (pure-module shape + display stamp).
type GridRequest = ScheduleRequestData & { receivedAt: string };

// Box/letter colors per request category (static classes for Tailwind).
const REQ_CAT_CLASSES: Record<RequestCategory | "mixed", { ring: string; ringFaint: string; text: string; bg: string }> = {
  leave: { ring: "ring-amber-400", ringFaint: "ring-amber-400/40", text: "text-amber-300", bg: "bg-amber-900/15" },
  restricted: { ring: "ring-rose-400", ringFaint: "ring-rose-400/40", text: "text-rose-300", bg: "bg-rose-900/15" },
  want: { ring: "ring-emerald-400", ringFaint: "ring-emerald-400/40", text: "text-emerald-300", bg: "bg-emerald-900/15" },
  off: { ring: "ring-sky-400", ringFaint: "ring-sky-400/40", text: "text-sky-300", bg: "bg-sky-900/15" },
  mixed: { ring: "ring-violet-400", ringFaint: "ring-violet-400/40", text: "text-violet-300", bg: "bg-violet-900/15" },
};
import { useEscape } from "@/lib/use-escape";

type AvailabilityRuleData = {
  dayOfWeek: number;
  type: string;
  strength: string;
  pattern: string;
  conditionStaffId?: string | null;
};

type Staff = {
  id: string;
  initials: string;
  name: string;
  ftePercentage: number;
  employmentTypeId: string;
  employmentTypeName: string;
  collapsesIntoOther: boolean;
  availabilityRules: AvailabilityRuleData[];
  isAutoScheduled: boolean;
  isActive: boolean;
};

type AssignmentData = {
  id: string;
  staffId: string;
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
  dedicatedColumn?: boolean;
  boldOnSchedule?: boolean;
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

type StaffOverride = {
  staffId: string;
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
  staffId: string;
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
  staff: Staff[];
  assignments: AssignmentData[];
  shiftTypes: ShiftType[];
  payPeriods: PayPeriod[];
  holidays: Holiday[];
  staffOverrides: StaffOverride[];
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
  printColumnRules?: PrintRule[];
  dateFormat?: string;
  currentVersions?: CurrentVersionMeta[];
  scheduleRequests?: GridRequest[];
  collapseOtherOnPrint?: boolean;
};

// The current (last saved/restored) version for a calendar month. snapshotHash
// lets the grid detect whether the live month has drifted since that save.
type CurrentVersionMeta = {
  year: number;
  month: number;
  versionNumber: number;
  comment: string | null;
  snapshotHash: string;
  savedAt: string; // ISO
};

// A version row as returned by GET /api/versions (metadata only).
type VersionRow = {
  id: string;
  year: number;
  month: number;
  versionNumber: number;
  comment: string | null;
  isCurrent: boolean;
  isAutoBackup: boolean;
  snapshotHash: string;
  createdAt: string;
};

// Response of GET /api/versions/[id]/changes — the diff vs the previous version.
type ChangesResponse = {
  previousVersionNumber: number | null;
  summary: ChangeSummary;
  changes: SnapshotChange[];
};

type PickerState = {
  staffId: string;
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

type TooltipState = { text: string; x: number; y: number } | null;
type SetTooltip = (t: TooltipState) => void;

function showTip(setTooltip: SetTooltip, text: string, e: React.MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  setTooltip({ text, x: rect.left + rect.width / 2, y: rect.bottom + 4 });
}

function WarningDot({ warnings, setTooltip }: { warnings: Warning[]; setTooltip: SetTooltip }) {
  if (warnings.length === 0) return null;
  const hasError = warnings.some((w) => w.type === "post-shift" || w.type === "over-hours");
  const text = warnings.map((w) => w.message).join("\n");
  return (
    <span
      className={`absolute top-0 right-0 w-1.5 h-1.5 rounded-full ${hasError ? "bg-red-500" : "bg-amber-500"}`}
      onMouseEnter={(e) => showTip(setTooltip, text, e)}
      onMouseLeave={() => setTooltip(null)}
    />
  );
}

// A small colored shift-code pill used in the version changes list.
function ShiftChip({ st }: { st?: { code: string; color: string } }) {
  return (
    <span
      style={{ backgroundColor: st?.color ?? "#6b7280" }}
      className="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold text-white leading-none"
    >
      {st?.code ?? "—"}
    </span>
  );
}

export function ScheduleGrid({
  canEdit = true,
  staff,
  assignments: initialAssignments,
  shiftTypes,
  payPeriods,
  holidays,
  staffOverrides,
  staffingMins,
  staffingReqs,
  fairnessData,
  fairnessAverages,
  followRules,
  countColumns = [],
  printColumnRules = [],
  dateFormat: dateFormatProp,
  currentVersions = [],
  scheduleRequests = [],
  collapseOtherOnPrint = true,
}: Props) {
  const dateFormat = (dateFormatProp || DEFAULT_DATE_FORMAT) as DateFormatKey;
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [localAssignments, setLocalAssignments] = useState(initialAssignments);
  const [localRequests, setLocalRequests] = useState<GridRequest[]>(scheduleRequests);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<{ staffId: string; date: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const [activeCol, setActiveCol] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [autoSuggestions, setAutoSuggestions] = useState<Array<{
    staffId: string;
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
    return new Set(autoSuggestions.map((s) => `${s.staffId}:${s.date}`));
  }, [autoSuggestions]);

  const suggestionMap = useMemo(() => {
    if (!autoSuggestions) return new Map<string, SuggestionEntry>();
    const m = new Map<string, SuggestionEntry>();
    for (const s of autoSuggestions) m.set(`${s.staffId}:${s.date}`, s);
    return m;
  }, [autoSuggestions]);

  // Multi-select state
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<{ staffId: string; date: string } | null>(null);

  const [showMonthPicker, setShowMonthPicker] = useState(false);
  // Reverse dedicated-column entry: which dedicated cell is being edited (by
  // shift type + date) and its in-progress text. Null when not editing.
  const [dedEdit, setDedEdit] = useState<{ shiftTypeId: string; date: string } | null>(null);
  const [dedEditValue, setDedEditValue] = useState("");
  const dedCancelRef = useRef(false); // set when Escape cancels a dedicated-cell edit
  // "Show all staff" override (past months only) — not persisted, default off.
  const [showAllStaff, setShowAllStaff] = useState(false);
  const [showPPRows, setShowPPRows] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("yosched:showPPRows");
    return saved !== null ? saved === "true" : false;
  });
  const monthPickerRef = useRef<HTMLDivElement>(null);

  // --- Versioning ---
  // Current (last saved/restored) version per "year-month". Seeded from the
  // server and updated optimistically when the user saves a new version.
  const [currentVersionMap, setCurrentVersionMap] = useState<Map<string, CurrentVersionMeta>>(
    () => new Map(currentVersions.map((v) => [`${v.year}-${v.month}`, v])),
  );
  const [showVersions, setShowVersions] = useState(false);
  const [versionList, setVersionList] = useState<VersionRow[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionComment, setVersionComment] = useState("");
  const [versionBusy, setVersionBusy] = useState(false);
  // When set, the panel shows the change list for a version instead of the list.
  const [changesView, setChangesView] = useState<{ version: VersionRow; loading: boolean; data: ChangesResponse | null } | null>(null);
  const versionsPanelRef = useRef<HTMLDivElement>(null);

  const focalVersion = currentVersionMap.get(`${viewYear}-${viewMonth}`) ?? null;

  // Hash of the live focal month — compared against the saved version's hash to
  // tell whether the schedule has drifted since it was last saved/restored.
  const liveMonthHash = useMemo(
    () =>
      hashSnapshot(
        localAssignments
          .filter((a) => dateInMonth(a.date, viewYear, viewMonth))
          .map((a) => ({ staffId: a.staffId, date: a.date, shiftTypeId: a.shiftTypeId, isLocked: a.isLocked })),
      ),
    [localAssignments, viewYear, viewMonth],
  );
  const monthModified = focalVersion ? focalVersion.snapshotHash !== liveMonthHash : false;

  // Load the version list whenever the panel is open and the focal month changes.
  useEffect(() => {
    if (!showVersions) return;
    let cancelled = false;
    setVersionsLoading(true);
    setVersionList(null);
    fetch(`/api/versions?year=${viewYear}&month=${viewMonth}`)
      .then((r) => (r.ok ? r.json() : { versions: [] }))
      .then((d) => { if (!cancelled) setVersionList(d.versions); })
      .catch(() => { if (!cancelled) setVersionList([]); })
      .finally(() => { if (!cancelled) setVersionsLoading(false); });
    return () => { cancelled = true; };
  }, [showVersions, viewYear, viewMonth]);

  const saveVersion = useCallback(async () => {
    // Nothing new since the current version — confirm before saving a duplicate.
    if (focalVersion && !monthModified) {
      if (!window.confirm(`No changes since version ${focalVersion.versionNumber}. Save an identical version anyway?`)) return;
    }
    setVersionBusy(true);
    try {
      const res = await fetch("/api/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: viewYear, month: viewMonth, comment: versionComment.trim() || undefined }),
      });
      if (!res.ok) { alert("Could not save version"); return; }
      const { version } = (await res.json()) as { version: VersionRow };
      setCurrentVersionMap((m) => {
        const next = new Map(m);
        next.set(`${viewYear}-${viewMonth}`, {
          year: viewYear,
          month: viewMonth,
          versionNumber: version.versionNumber,
          comment: version.comment,
          snapshotHash: version.snapshotHash,
          savedAt: version.createdAt,
        });
        return next;
      });
      setVersionList((list) => [version, ...(list ?? []).map((x) => ({ ...x, isCurrent: false }))]);
      setVersionComment("");
    } finally {
      setVersionBusy(false);
    }
  }, [viewYear, viewMonth, versionComment, focalVersion, monthModified]);

  const restoreVersion = useCallback(async (v: VersionRow) => {
    const label = v.comment ? `v${v.versionNumber} — “${v.comment}”` : `v${v.versionNumber}`;
    if (!window.confirm(
      `Restore ${MONTH_NAMES[viewMonth]} ${viewYear} to ${label}?\n\n` +
      `The current state of this month will be auto-saved as a new version first, then replaced.`,
    )) return;
    setVersionBusy(true);
    try {
      const res = await fetch(`/api/versions/${v.id}/restore`, { method: "POST" });
      if (res.ok) {
        // The month's assignments were rewritten server-side; reload to resync.
        window.location.reload();
        return;
      }
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "Restore failed");
    } catch {
      alert("Restore failed");
    } finally {
      setVersionBusy(false);
    }
  }, [viewYear, viewMonth]);

  const openChanges = useCallback(async (v: VersionRow) => {
    setChangesView({ version: v, loading: true, data: null });
    const empty: ChangesResponse = { previousVersionNumber: null, summary: { added: 0, removed: 0, changed: 0, locked: 0, total: 0 }, changes: [] };
    let data: ChangesResponse = empty;
    try {
      const res = await fetch(`/api/versions/${v.id}/changes`);
      if (res.ok) data = await res.json();
    } catch { /* keep empty */ }
    // Ignore if the user navigated away to a different version meanwhile.
    setChangesView((cur) => (cur && cur.version.id === v.id ? { version: v, loading: false, data } : cur));
  }, []);

  const closeVersions = useCallback(() => { setShowVersions(false); setChangesView(null); }, []);
  useEscape(() => { if (changesView) setChangesView(null); else setShowVersions(false); });

  // Resizable alerts panel width (pixels)
  const [alertWidth, setAlertWidth] = useState(() => {
    if (typeof window === "undefined") return 220;
    const saved = localStorage.getItem("yosched:alertWidth");
    return saved !== null ? Number(saved) : 220;
  });
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const splitDragging = useRef(false);

  // Shift+drag-select state
  const dragSelecting = useRef(false);
  const dragSelectMoved = useRef(false);
  const dragSelectAnchor = useRef<{ staffId: string; date: string } | null>(null);

  // Undo/redo stacks — each entry is a group of changes applied together
  type UndoOp = { staffId: string; date: string; prev: AssignmentData | null; next: AssignmentData | null };
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

  const pastMonth = isPastMonth(viewYear, viewMonth, today);

  const offShiftTypeIds = useMemo(
    () => new Set(shiftTypes.filter((st) => st.isOffShift).map((st) => st.id)),
    [shiftTypes],
  );

  // The columns actually rendered for the displayed month. Past months show only
  // staff who were scheduled (real, non-off-shift assignment); current/future
  // show the active roster. `showAllStaff` overrides suppression on past months.
  const visibleStaff = useMemo(
    () =>
      visibleStaffForMonth(
        staff,
        localAssignments,
        firstOfMonth,
        lastOfMonth,
        pastMonth,
        showAllStaff,
        offShiftTypeIds,
      ),
    [staff, localAssignments, firstOfMonth, lastOfMonth, pastMonth, showAllStaff, offShiftTypeIds],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const row = el.querySelector(`tr[data-date="${firstOfMonth}"]`) as HTMLElement | null;
    const thead = el.querySelector("thead") as HTMLElement | null;
    if (row && thead) {
      el.scrollTop = row.offsetTop - thead.offsetHeight;
    }
  }, [firstOfMonth]);

  // Empty cells default to blank (no assignment). An off-day "X" is now an
  // explicit choice the scheduler makes via the shift picker, not an
  // auto-filled default — so a cell with no shift reads as "unscheduled"
  // rather than "off".

  const rowItems = useMemo(() => buildRowItems(dates, payPeriods), [dates, payPeriods]);

  const assignmentMap = useMemo(() => {
    const map = new Map<string, AssignmentData>();
    for (const a of localAssignments) {
      map.set(`${a.staffId}:${a.date}`, a);
    }
    return map;
  }, [localAssignments]);

  // "OTHER" print column: staff flagged collapsesIntoOther are hidden as individual
  // columns in print and listed together here. Print-only — the on-screen grid keeps a
  // column per person for editing. otherColInitials maps each date to the initials of
  // those scheduled (a non-off assignment) that day.
  const otherStaff = useMemo(
    () => (collapseOtherOnPrint ? visibleStaff.filter((p) => p.collapsesIntoOther) : []),
    [collapseOtherOnPrint, visibleStaff],
  );
  const showOtherColumn = otherStaff.length > 0;
  const otherColInitials = useMemo(
    () =>
      otherColumnInitials(otherStaff, dates, (staffId, date) => {
        const a = assignmentMap.get(`${staffId}:${date}`);
        return !!a && !offShiftTypeIds.has(a.shiftTypeId);
      }),
    [otherStaff, dates, assignmentMap, offShiftTypeIds],
  );

  const shiftTypeMap = useMemo(() => {
    const map = new Map<string, ShiftType>();
    for (const st of shiftTypes) map.set(st.id, st);
    return map;
  }, [shiftTypes]);

  // Request chrome (boxed border + bare letters + corner badge) is for PENDING
  // requests only — the open asks still awaiting a decision. Once approved, a
  // request is honored by a real assignment and reads as a normal shift, so it
  // drops the chrome. Hard-constraint violations still raise the warning dot.
  // Keyed `${staffId}:${date}`; empty cells omitted.
  const requestsByCell = useMemo(() => {
    const map = new Map<string, GridRequest[]>();
    if (localRequests.length === 0) return map;
    for (const date of dates) {
      for (const p of visibleStaff) {
        const rs = requestsForStaffDate(localRequests, p.id, date, { includePending: true })
          .filter((r) => r.status === "pending");
        if (rs.length > 0) map.set(`${p.id}:${date}`, rs);
      }
    }
    return map;
  }, [localRequests, dates, visibleStaff]);

  // Approved requests only — these are the ones that exert scheduling force, so
  // they're what the cell-warning checks consume (checkRequestConflict ignores
  // pending, but pre-filtering keeps the per-cell work small).
  const approvedRequests = useMemo(
    () => localRequests.filter((r) => r.status === "approved"),
    [localRequests]
  );

  const requestTooltip = useCallback(
    (reqs: GridRequest[], date: string): string => {
      const header = `Requests · ${formatDate(parseDate(date), dateFormat)}`;
      const lines = reqs.map((r) => {
        const desc = describeRequest(r, (id) => shiftTypeMap.get(id)?.code ?? id);
        const recv = formatDate(parseDate(r.receivedAt.split("T")[0]), dateFormat);
        const status = r.status === "approved" ? "approved" : "pending";
        return `• ${desc} — ${status}, rec'd ${recv}`;
      });
      return [header, ...lines].join("\n");
    },
    [shiftTypeMap, dateFormat],
  );

  const staffInitialsMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of staff) map.set(p.id, p.initials);
    return map;
  }, [staff]);

  const hotkeyMap = useMemo(() => {
    const map = new Map<string, ShiftType>();
    for (const st of shiftTypes) {
      if (st.hotkey) map.set(st.hotkey.toUpperCase(), st);
    }
    return map;
  }, [shiftTypes]);

  const staffMap = useMemo(() => {
    const map = new Map<string, Staff>();
    for (const p of staff) map.set(p.id, p);
    return map;
  }, [staff]);

  const overrideMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of staffOverrides) {
      map.set(`${o.staffId}:${o.shiftTypeId}`, o.durationHrs);
    }
    return map;
  }, [staffOverrides]);

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

  function getHoursForAssignment(staffId: string, shiftTypeId: string): number {
    const override = overrideMap.get(`${staffId}:${shiftTypeId}`);
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
      const staffHours = new Map<string, number>();
      for (const p of visibleStaff) {
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
        staffHours.set(p.id, hours);
      }
      result.set(pp.startDate, staffHours);
    }
    return result;
  }, [sortedPPs, visibleStaff, assignmentMap, suggestionMap, overrideMap, shiftTypeMap]);

  const followRuleMap = useMemo(() => buildFollowRuleMap(followRules ?? []), [followRules]);

  const cellWarnings = useMemo(() => {
    const map = new Map<string, Warning[]>();
    for (const date of dates) {
      for (const p of staff) {
        const a = assignmentMap.get(`${p.id}:${date}`);
        if (!a) continue;
        const warnings = checkCellWarnings({
          staffId: p.id,
          date,
          shiftTypeId: a.shiftTypeId,
          staff: p,
          shiftTypeMap,
          assignmentMap,
          allStaff: staff,
          holidaySet,
          staffingMins,
          followRuleMap,
          scheduleRequests: approvedRequests,
        });
        if (warnings.length > 0) {
          map.set(`${p.id}:${date}`, warnings);
        }
      }
    }
    return map;
  }, [dates, staff, assignmentMap, shiftTypeMap, holidaySet, staffingMins, followRuleMap, approvedRequests]);

  // Compute per-day staffing warnings
  const dayWarnings = useMemo(() => {
    const map = new Map<string, Warning[]>();
    for (const date of dates) {
      const warnings = checkDayStaffing({
        date,
        staff,
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
  }, [dates, staff, assignmentMap, shiftTypeMap, holidaySet, staffingMins, staffingReqs]);

  const columnCounts = useMemo(() => {
    return countColumns.map((col) => {
      const codeSet = new Set(col.shiftCodes);
      const counts: Record<string, number> = {};
      for (const date of dates) {
        let count = 0;
        for (const p of staff) {
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
  }, [dates, staff, assignmentMap, suggestionMap, countColumns]);

  // Shift types flagged for a dedicated column, in sort order. Each gets its own
  // column (left of the count columns) listing the initials of whoever covers
  // that shift on a given day — additive to the normal in-cell shift display.
  const dedicatedColumns = useMemo(
    () => shiftTypes.filter((st) => st.dedicatedColumn),
    [shiftTypes],
  );

  // Per dedicated column: date -> initials of staff covering that shift that
  // day. Mirrors columnCounts (includes suggestions, scans all staff so
  // coverage shows even when a staff's own column is hidden).
  const dedicatedColumnInitialsData = useMemo(() => {
    return dedicatedColumns.map((st) =>
      dedicatedColumnInitials(staff, dates, st.code, (pid, date) => {
        const key = `${pid}:${date}`;
        const a = assignmentMap.get(key);
        const sug = !a ? suggestionMap.get(key) : null;
        return a?.code ?? sug?.code;
      }),
    );
  }, [dedicatedColumns, dates, staff, assignmentMap, suggestionMap]);

  // Print-only: staff whose individual column must be HIDDEN from the printed
  // schedule because they match no enabled print-column rule. Empty when there are
  // no enabled rules (print everyone — today's behavior). On-screen the grid still
  // shows every staff; only print stamps `data-print-rule-hide` on these columns.
  // Shift codes are gathered from REAL assignments in the displayed dates (print
  // reflects the committed schedule, so suggestions are excluded).
  const printHiddenIds = useMemo(() => {
    // Only scan dates the printed page actually shows — the grid's `dates` include
    // leading/trailing outside-month padding rows that print CSS hides, so a shift
    // landing only in a padding day must NOT make a staff's column print.
    const inMonth = dates.filter((d) => d >= firstOfMonth && d <= lastOfMonth);
    const codesByStaff = new Map<string, Set<string>>();
    for (const p of visibleStaff) {
      const set = new Set<string>();
      for (const date of inMonth) {
        const a = assignmentMap.get(`${p.id}:${date}`);
        if (a?.code) set.add(a.code);
      }
      if (set.size > 0) codesByStaff.set(p.id, set);
    }
    const visIds = printVisibleStaffIds(
      visibleStaff.map((p) => ({
        id: p.id,
        employmentTypeId: p.employmentTypeId,
        ftePercentage: p.ftePercentage,
      })),
      printColumnRules,
      codesByStaff,
    );
    if (!visIds) return new Set<string>(); // no enabled rules → hide nothing
    return new Set(visibleStaff.filter((p) => !visIds.has(p.id)).map((p) => p.id));
  }, [printColumnRules, visibleStaff, dates, assignmentMap, firstOfMonth, lastOfMonth]);

  // Drop column focus + selection when the visible column set may change (month
  // change / Show-all toggle), so focus and selection rectangles never point at
  // a column that gets suppressed. Done in the event handlers (not an effect) to
  // avoid setState-in-effect cascades.
  function clearColFocus() {
    setActiveCol(null);
    setSelection(new Set());
    setSelectionAnchor(null);
  }

  function prevMonth() {
    clearColFocus();
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    clearColFocus();
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function goToday() {
    clearColFocus();
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  }

  function handleCellClick(staffId: string, date: string, e: React.MouseEvent) {
    setActiveRow(date);
    setActiveCol(staffId);
    if (!canEdit) return;
    const existing = assignmentMap.get(`${staffId}:${date}`);
    if (existing?.isLocked) return;

    const cellKey = `${staffId}:${date}`;

    if (e.shiftKey) {
      if (dragSelectMoved.current) { dragSelectMoved.current = false; return; }
      // Shift+click: rectangular range select from anchor
      if (selectionAnchor) {
        setSelection(computeRectSelection(selectionAnchor, { staffId, date }));
      } else {
        setSelection(new Set([cellKey]));
        setSelectionAnchor({ staffId, date });
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
            const existingStaff = firstKey.split(":")[0];
            if (existingStaff !== staffId) {
              return new Set([cellKey]);
            }
          }
          next.add(cellKey);
        }
        return next;
      });
      if (!selectionAnchor) setSelectionAnchor({ staffId, date });
      return;
    }

    // Plain click on a selected cell — open picker, keep selection
    if (selection.size > 0 && selection.has(cellKey)) {
      const pos = pickerPositionForCell(staffId, date);
      setPicker({ staffId, date, ...pos });
      return;
    }

    // Plain click on non-selected cell — select it, no picker
    setSelection(new Set());
    setSelectionAnchor({ staffId, date });
    setPicker(null);
  }

  function pickerPositionForCell(staffId: string, date: string): { x: number; y: number } {
    const el = document.querySelector(`[data-cell="${staffId}:${date}"]`);
    if (el) {
      const rect = el.getBoundingClientRect();
      return { x: rect.right, y: rect.bottom };
    }
    return { x: 200, y: 200 };
  }

  function handleCellContextMenu(staffId: string, date: string, e: React.MouseEvent) {
    e.preventDefault();
    if (!canEdit) return;
    const existing = assignmentMap.get(`${staffId}:${date}`);
    if (existing?.isLocked) return;
    setActiveRow(date);
    setActiveCol(staffId);
    const cellKey = `${staffId}:${date}`;
    if (selection.size === 0 || !selection.has(cellKey)) {
      setSelection(new Set());
      setSelectionAnchor({ staffId, date });
    }
    const pos = pickerPositionForCell(staffId, date);
    setPicker({ staffId, date, ...pos });
  }

  function computeRectSelection(anchor: { staffId: string; date: string }, target: { staffId: string; date: string }): Set<string> {
    const aDateIdx = dates.indexOf(anchor.date);
    const tDateIdx = dates.indexOf(target.date);
    const aProvIdx = visibleStaff.findIndex((p) => p.id === anchor.staffId);
    const tProvIdx = visibleStaff.findIndex((p) => p.id === target.staffId);
    if (aDateIdx === -1 || tDateIdx === -1 || aProvIdx === -1 || tProvIdx === -1) return new Set();
    const dStart = Math.min(aDateIdx, tDateIdx);
    const dEnd = Math.max(aDateIdx, tDateIdx);
    const pStart = Math.min(aProvIdx, tProvIdx);
    const pEnd = Math.max(aProvIdx, tProvIdx);
    const sel = new Set<string>();
    for (let di = dStart; di <= dEnd; di++) {
      for (let pi = pStart; pi <= pEnd; pi++) {
        const k = `${visibleStaff[pi].id}:${dates[di]}`;
        if (!assignmentMap.get(k)?.isLocked) sel.add(k);
      }
    }
    return sel;
  }

  function handleCellMouseDown(staffId: string, date: string, e: React.MouseEvent) {
    if (!canEdit || e.button !== 0 || !e.shiftKey) return;
    e.preventDefault();
    dragSelecting.current = true;
    dragSelectMoved.current = false;
    const anchor = selectionAnchor ?? { staffId, date };
    dragSelectAnchor.current = anchor;
    setSelection(computeRectSelection(anchor, { staffId, date }));
    if (!selectionAnchor) setSelectionAnchor({ staffId, date });
    setActiveRow(date);
    setActiveCol(staffId);
    setPicker(null);
  }

  function handleCellMouseEnter(staffId: string, date: string) {
    if (!dragSelecting.current || !dragSelectAnchor.current) return;
    dragSelectMoved.current = true;
    const sel = computeRectSelection(dragSelectAnchor.current, { staffId, date });
    setSelection(sel);
    setActiveRow(date);
    setActiveCol(staffId);
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

  async function applyAssignment(staffId: string, date: string, assignment: AssignmentData | null) {
    setSaving(`${staffId}:${date}`);
    if (assignment) {
      setLocalAssignments((prev) => {
        const filtered = prev.filter((a) => !(a.staffId === staffId && a.date === date));
        return [...filtered, assignment];
      });
      try {
        const res = await fetch("/api/assignments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId, date, shiftTypeId: assignment.shiftTypeId }),
        });
        const saved = await res.json();
        setLocalAssignments((prev) =>
          prev.map((a) => (a.staffId === staffId && a.date === date ? saved : a)),
        );
      } catch { /* optimistic stays */ }
    } else {
      setLocalAssignments((prev) =>
        prev.filter((a) => !(a.staffId === staffId && a.date === date)),
      );
      try {
        await fetch("/api/assignments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId, date }),
        });
      } catch { /* optimistic stays */ }
    }
    setSaving(null);
  }

  // Response-checked single-cell write for reverse dedicated-column entry. Unlike
  // applyAssignment (used by the keyboard/picker/drag paths, which keep the
  // optimistic value even on a failed request), this reverts to `prev` when the
  // server rejects the write — so a locked/raced 400 never leaves stale local
  // state. Returns whether the write committed.
  async function applyAssignmentChecked(
    staffId: string,
    date: string,
    next: AssignmentData | null,
    prev: AssignmentData | null,
  ): Promise<boolean> {
    setLocalAssignments((cur) => {
      const filtered = cur.filter((a) => !(a.staffId === staffId && a.date === date));
      return next ? [...filtered, next] : filtered;
    });
    try {
      let res: Response;
      if (next) {
        res = await fetch("/api/assignments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId, date, shiftTypeId: next.shiftTypeId }),
        });
      } else {
        res = await fetch("/api/assignments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId, date }),
        });
      }
      if (!res.ok) throw new Error(`write failed: ${res.status}`);
      if (next) {
        const saved = await res.json();
        setLocalAssignments((cur) =>
          cur.map((a) => (a.staffId === staffId && a.date === date ? saved : a)),
        );
      }
      return true;
    } catch {
      // Revert this cell to its prior value (the optimistic change did not stick).
      setLocalAssignments((cur) => {
        const filtered = cur.filter((a) => !(a.staffId === staffId && a.date === date));
        return prev ? [...filtered, prev] : filtered;
      });
      return false;
    }
  }

  // Reverse dedicated-column entry: parse initials typed into a dedicated column's
  // cell and assign that shift to the named staff for the date (the inverse of the
  // normal "assign ICU → initials appear in the ICU column" flow). Additions assign
  // the shift; initials removed from the cell delete that staff's assignment ONLY
  // when it is this dedicated shift. Conflicts (a different, unlocked real shift)
  // ask Replace/Skip per cell; locked cells are never touched.
  async function handleDedicatedEntry(shiftTypeId: string, date: string, raw: string) {
    const st = shiftTypeMap.get(shiftTypeId);
    if (!st) return;

    const { resolved, unknown } = resolveInitials(raw, staff);
    if (unknown.length > 0) {
      window.alert(`Unknown initials (no matching staff): ${unknown.join(", ")}`);
    }
    const resolvedIds = new Set(resolved.map((r) => r.id));

    // Who currently holds this dedicated shift on this date (REAL assignments only).
    const currentIds = new Set<string>();
    for (const p of staff) {
      if (assignmentMap.get(`${p.id}:${date}`)?.code === st.code) currentIds.add(p.id);
    }

    const initialsOf = (id: string) => staff.find((p) => p.id === id)?.initials ?? id;
    const ops: UndoOp[] = [];
    setSaving(`ded-${shiftTypeId}:${date}`);

    // Additions: staff named in the entry who don't already hold this shift.
    for (const r of resolved) {
      if (currentIds.has(r.id)) continue;
      const existing = assignmentMap.get(`${r.id}:${date}`) ?? null;
      if (existing?.isLocked) {
        window.alert(`${initialsOf(r.id)} is locked on ${formatDate(parseDate(date), dateFormat)} — skipped.`);
        continue;
      }
      if (existing && existing.code !== st.code) {
        const ok = window.confirm(
          `${initialsOf(r.id)} already has ${existing.code} on ${formatDate(parseDate(date), dateFormat)}. Replace with ${st.code}?`,
        );
        if (!ok) continue;
      }
      const next: AssignmentData = {
        id: `temp-${r.id}:${date}`,
        staffId: r.id,
        date,
        shiftTypeId,
        isLocked: false,
        code: st.code,
        color: st.color,
      };
      if (await applyAssignmentChecked(r.id, date, next, existing)) {
        ops.push({ staffId: r.id, date, prev: existing, next });
      }
    }

    // Removals: staff dropped from the entry — delete only if their current cell
    // is THIS dedicated shift and not locked (never clobber another shift).
    for (const id of currentIds) {
      if (resolvedIds.has(id)) continue;
      const existing = assignmentMap.get(`${id}:${date}`) ?? null;
      if (!existing || existing.code !== st.code) continue;
      if (existing.isLocked) {
        window.alert(`${initialsOf(id)} is locked on ${formatDate(parseDate(date), dateFormat)} — not removed.`);
        continue;
      }
      if (await applyAssignmentChecked(id, date, null, existing)) {
        ops.push({ staffId: id, date, prev: existing, next: null });
      }
    }

    if (ops.length > 0) pushUndo(ops);
    setSaving(null);
  }

  async function handleUndo() {
    const group = undoStack.current.pop();
    if (!group) return;
    redoStack.current.push(group);
    await Promise.all(group.map((op) => applyAssignment(op.staffId, op.date, op.prev)));
  }

  async function handleRedo() {
    const group = redoStack.current.pop();
    if (!group) return;
    undoStack.current.push(group);
    await Promise.all(group.map((op) => applyAssignment(op.staffId, op.date, op.next)));
  }

  const undoRef = useRef(handleUndo);
  const redoRef = useRef(handleRedo);
  const clearRef = useRef<(target?: { staffId: string; date: string }) => Promise<void>>(async () => {});
  useEffect(() => { undoRef.current = handleUndo; }, [handleUndo]);
  useEffect(() => { redoRef.current = handleRedo; }, [handleRedo]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ignore grid shortcuts while typing in a field (e.g. the dedicated-column
      // initials input, version comment) — otherwise letters/Delete/arrows would
      // hit the active cell instead of the input the user is focused on.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
        return;
      }
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
            setSelectionAnchor({ staffId: activeCol, date: activeRow });
          }
          const pos = pickerPositionForCell(activeCol, activeRow);
          setPicker({ staffId: activeCol, date: activeRow, ...pos });
        }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !picker && canEdit && activeRow && activeCol) {
        e.preventDefault();
        if (selection.size > 0) {
          clearRef.current();
        } else {
          clearRef.current({ staffId: activeCol, date: activeRow });
        }
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && !picker && activeRow && activeCol) {
        e.preventDefault();
        const dateIdx = dates.indexOf(activeRow);
        const provIdx = visibleStaff.findIndex((p) => p.id === activeCol);
        if (dateIdx === -1 || provIdx === -1) return;
        let newDateIdx = dateIdx;
        let newProvIdx = provIdx;
        if (e.key === "ArrowUp") newDateIdx = Math.max(0, dateIdx - 1);
        if (e.key === "ArrowDown") newDateIdx = Math.min(dates.length - 1, dateIdx + 1);
        if (e.key === "ArrowLeft") newProvIdx = Math.max(0, provIdx - 1);
        if (e.key === "ArrowRight") newProvIdx = Math.min(visibleStaff.length - 1, provIdx + 1);
        const newDate = dates[newDateIdx];
        const newProv = visibleStaff[newProvIdx];
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
  }, [picker, canEdit, activeRow, activeCol, assignmentMap, dates, visibleStaff, hotkeyMap, selection, showMonthPicker]);

  const hotkeyAssign = useCallback(async (st: ShiftType) => {
    const cells: { staffId: string; date: string }[] = [];
    if (selection.size > 0) {
      for (const key of selection) {
        if (assignmentMap.get(key)?.isLocked) continue;
        const [pid, d] = key.split(":");
        cells.push({ staffId: pid, date: d });
      }
    } else if (activeCol && activeRow) {
      const existing = assignmentMap.get(`${activeCol}:${activeRow}`);
      if (existing?.isLocked) return;
      cells.push({ staffId: activeCol, date: activeRow });
    }
    if (cells.length === 0) return;

    const undoOps: UndoOp[] = cells.map(({ staffId, date }) => {
      const prev = assignmentMap.get(`${staffId}:${date}`) ?? null;
      const next: AssignmentData = {
        id: `temp-${staffId}:${date}`,
        staffId,
        date,
        shiftTypeId: st.id,
        isLocked: false,
        code: st.code,
        color: st.color,
      };
      return { staffId, date, prev, next };
    });
    pushUndo(undoOps);

    setPicker(null);
    setSelection(new Set());
    setSelectionAnchor(null);
    setSaving("bulk");

    setLocalAssignments((prev) => {
      const keys = new Set(cells.map((c) => `${c.staffId}:${c.date}`));
      const filtered = prev.filter((a) => !keys.has(`${a.staffId}:${a.date}`));
      const temps = cells.map((c) => ({
        id: `temp-${c.staffId}:${c.date}`,
        staffId: c.staffId,
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
          const savedKeys = new Set(applied.map((s) => `${s.staffId}:${s.date}`));
          return [...prev.filter((a) => !savedKeys.has(`${a.staffId}:${a.date}`)), ...applied];
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
    const cells: { staffId: string; date: string }[] = [];
    if (selection.size > 0) {
      for (const key of selection) {
        if (assignmentMap.get(key)?.isLocked) continue;
        const [pid, d] = key.split(":");
        cells.push({ staffId: pid, date: d });
      }
    } else {
      cells.push({ staffId: picker.staffId, date: picker.date });
    }
    if (cells.length === 0) { setPicker(null); return; }

    // Build undo group
    const undoOps: UndoOp[] = cells.map(({ staffId, date }) => {
      const key = `${staffId}:${date}`;
      const prev = assignmentMap.get(key) ?? null;
      const next: AssignmentData = {
        id: `temp-${key}`,
        staffId,
        date,
        shiftTypeId,
        isLocked: false,
        code: st.code,
        color: st.color,
      };
      return { staffId, date, prev, next };
    });
    pushUndo(undoOps);

    setPicker(null);
    setSelection(new Set());
    setSelectionAnchor(null);
    setSaving("bulk");

    // Optimistic update
    setLocalAssignments((prev) => {
      const keys = new Set(cells.map((c) => `${c.staffId}:${c.date}`));
      const filtered = prev.filter((a) => !keys.has(`${a.staffId}:${a.date}`));
      const temps = cells.map((c) => ({
        id: `temp-${c.staffId}:${c.date}`,
        staffId: c.staffId,
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
        const { staffId, date } = cells[0];
        const res = await fetch("/api/assignments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId, date, shiftTypeId }),
        });
        const saved = await res.json();
        setLocalAssignments((prev) =>
          prev.map((a) => (a.staffId === staffId && a.date === date ? saved : a)),
        );
      } else {
        const res = await fetch("/api/assignments/bulk", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells, shiftTypeId }),
        });
        const { applied: saved }: { applied: AssignmentData[] } = await res.json();
        setLocalAssignments((prev) => {
          const keys = new Set(saved.map((s) => `${s.staffId}:${s.date}`));
          const filtered = prev.filter((a) => !keys.has(`${a.staffId}:${a.date}`));
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

  const handleClear = useCallback(async (target?: { staffId: string; date: string }) => {
    const anchor = target ?? (picker ? { staffId: picker.staffId, date: picker.date } : null);
    if (!anchor && selection.size === 0) return;

    // Explicit target (Delete key) always clears just that cell;
    // selection path only used from picker (no target)
    const cells: { staffId: string; date: string }[] = [];
    if (!target && selection.size > 0) {
      for (const key of selection) {
        const a = assignmentMap.get(key);
        if (a && !a.isLocked) {
          const [pid, d] = key.split(":");
          cells.push({ staffId: pid, date: d });
        }
      }
    } else if (anchor) {
      const key = `${anchor.staffId}:${anchor.date}`;
      const a = assignmentMap.get(key);
      if (a && !a.isLocked) {
        cells.push(anchor);
      }
    }

    if (cells.length === 0) { setPicker(null); return; }

    // Build undo group
    const undoOps: UndoOp[] = cells.map(({ staffId, date }) => ({
      staffId,
      date,
      prev: assignmentMap.get(`${staffId}:${date}`) ?? null,
      next: null,
    }));
    pushUndo(undoOps);

    setPicker(null);
    setSelection(new Set());
    setSelectionAnchor(null);
    setSaving("bulk");

    // Optimistic removal
    const keys = new Set(cells.map((c) => `${c.staffId}:${c.date}`));
    setLocalAssignments((prev) =>
      prev.filter((a) => !keys.has(`${a.staffId}:${a.date}`)),
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

  // Request mode: turn picker marks into pending requests for the selected cells.
  const handleSaveRequests = useCallback(
    async (marks: PickerMarks) => {
      if (!picker) return;
      const cells: { staffId: string; date: string }[] = [];
      if (selection.size > 0) {
        for (const key of selection) {
          const [pid, d] = key.split(":");
          cells.push({ staffId: pid, date: d });
        }
      } else {
        cells.push({ staffId: picker.staffId, date: picker.date });
      }
      const payloads = buildRequestPayloads(marks, groupCellsIntoTargets(cells));

      setPicker(null);
      setSelection(new Set());
      setSelectionAnchor(null);
      if (payloads.length === 0) return;

      setSaving("requests");
      setRequestError(null);
      const created: GridRequest[] = [];
      let failed = 0;
      try {
        for (const p of payloads) {
          try {
            const res = await fetch("/api/requests", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(p),
            });
            if (res.ok) created.push(await res.json());
            else failed++;
          } catch {
            failed++;
          }
        }
      } finally {
        // Show whatever did persist, then surface any failures so a partial
        // save is never silent.
        if (created.length > 0) setLocalRequests((prev) => [...created, ...prev]);
        if (failed > 0) {
          setRequestError(
            `${failed} of ${payloads.length} request${payloads.length > 1 ? "s" : ""} failed to save${created.length > 0 ? ` (${created.length} saved)` : ""}.`,
          );
        }
        setSaving(null);
      }
    },
    [picker, selection],
  );

  // Delete an existing request (the × in the picker's request list).
  const handleDeleteRequest = useCallback(async (id: string) => {
    setLocalRequests((prev) => prev.filter((r) => r.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/requests/${id}`, { method: "DELETE" });
      if (!res.ok) setRequestError("Failed to delete request.");
    } catch {
      setRequestError("Failed to delete request.");
    }
  }, []);

  function handleDragStart(staffId: string, date: string, e: React.DragEvent) {
    if (!canEdit) { e.preventDefault(); return; }
    const a = assignmentMap.get(`${staffId}:${date}`);
    if (!a || a.isLocked) { e.preventDefault(); return; }
    setDragSource({ staffId, date });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${staffId}:${date}`);
  }

  function handleDragOver(staffId: string, date: string, e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const key = `${staffId}:${date}`;
    if (dragOver !== key) setDragOver(key);
  }

  function handleDragLeave() {
    setDragOver(null);
  }

  function handleDragEnd() {
    setDragSource(null);
    setDragOver(null);
  }

  const handleDrop = useCallback(async (toStaffId: string, toDate: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);

    if (!dragSource) return;
    const { staffId: fromStaffId, date: fromDate } = dragSource;
    setDragSource(null);

    if (fromStaffId === toStaffId && fromDate === toDate) return;

    const fromA = assignmentMap.get(`${fromStaffId}:${fromDate}`);
    const toA = assignmentMap.get(`${toStaffId}:${toDate}`);
    if (!fromA || fromA.isLocked || toA?.isLocked) return;

    const fromKey = `${fromStaffId}:${fromDate}`;
    const toKey = `${toStaffId}:${toDate}`;

    pushUndo([
      { staffId: fromStaffId, date: fromDate, prev: fromA, next: toA ?? null },
      { staffId: toStaffId, date: toDate, prev: toA ?? null, next: { ...fromA, staffId: toStaffId, date: toDate, id: `temp-${toKey}` } },
    ]);

    setSaving(fromKey);

    // Optimistic update
    setLocalAssignments((prev) => {
      const next = prev.filter(
        (a) => !(a.staffId === fromStaffId && a.date === fromDate) &&
               !(a.staffId === toStaffId && a.date === toDate)
      );
      // Move source to target
      next.push({ ...fromA, staffId: toStaffId, date: toDate, id: `temp-${toKey}` });
      // If target had assignment, move it to source (swap)
      if (toA) {
        next.push({ ...toA, staffId: fromStaffId, date: fromDate, id: `temp-${fromKey}` });
      }
      return next;
    });

    try {
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "swap",
          from: { staffId: fromStaffId, date: fromDate },
          to: { staffId: toStaffId, date: toDate },
        }),
      });
      if (!res.ok) throw new Error("Swap failed");
      const result = await res.json();

      setLocalAssignments((prev) => {
        const next = prev.filter(
          (a) => (!a.id.startsWith("temp-")
            || (a.staffId !== fromStaffId && a.staffId !== toStaffId))
            && !(a.staffId === toStaffId && a.date === toDate)
            && !(a.staffId === fromStaffId && a.date === fromDate)
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
    const { staffId, date } = picker;
    const cellStaff = staffMap.get(staffId);
    if (!cellStaff) return new Map<string, Warning[]>();

    const result = new Map<string, Warning[]>();
    for (const st of shiftTypes) {
      if (st.category === "other") continue;
      const warnings = checkCellWarnings({
        staffId,
        date,
        shiftTypeId: st.id,
        staff: cellStaff,
        shiftTypeMap,
        assignmentMap,
        allStaff: staff,
        holidaySet,
        staffingMins,
        followRuleMap,
        scheduleRequests: approvedRequests,
      });
      if (warnings.length > 0) {
        result.set(st.id, warnings);
      }
    }
    return result;
  }, [picker, staffMap, shiftTypes, shiftTypeMap, assignmentMap, staff, holidaySet, staffingMins, followRuleMap, approvedRequests]);

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
        onMouseEnter={(e) => showTip(setTooltip, `Suggested: ${sug.code}\n${sug.reason}`, e)}
        onMouseLeave={() => setTooltip(null)}
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
        staffId: a.staffId,
        date: a.date,
        prev: assignmentMap.get(`${a.staffId}:${a.date}`) ?? null,
        next: a,
      }));

      setLocalAssignments((prev) => {
        const keys = new Set(applied.map((a) => `${a.staffId}:${a.date}`));
        const filtered = prev.filter((a) => !keys.has(`${a.staffId}:${a.date}`));
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
        staffId: a.staffId,
        date: a.date,
        prev: a,
        next: null,
      }));

      const keys = new Set(removed.map((a) => `${a.staffId}:${a.date}`));
      setLocalAssignments((prev) => prev.filter((a) => !keys.has(`${a.staffId}:${a.date}`)));

      pushUndo(undoOps);
    } catch (e) {
      console.error("Clear auto-scheduled failed:", e);
    } finally {
      setAutoLoading(false);
    }
  }

  // Only days in the currently-viewed month get alerts — the grid also renders
  // pay-period padding rows from adjacent months, which must not produce alerts.
  const alerts = useMemo(
    () => buildAlerts(dates, dayWarnings, firstOfMonth, lastOfMonth),
    [dates, dayWarnings, firstOfMonth, lastOfMonth],
  );

  // Group alerts by date so each row gets a single positioned block.
  const alertGroups = useMemo(() => groupAlertsByDate(alerts), [alerts]);

  // Vertically align each alert block with the schedule row it refers to,
  // and keep them in sync as the grid scrolls.
  const alertGroupRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [alertHeaderH, setAlertHeaderH] = useState(0);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || alertGroups.length === 0) return;
    const thead = scroller.querySelector("thead") as HTMLElement | null;
    const headerH = thead?.offsetHeight ?? 0;
    setAlertHeaderH(headerH);

    // Per alert date: the matching row's top offset and height, so each block
    // can be centered on its row's vertical midpoint.
    const rows = new Map<string, { top: number; height: number }>();
    const measure = () => {
      rows.clear();
      for (const date of alertGroupRefs.current.keys()) {
        const row = scroller.querySelector(`tr[data-date="${date}"]`) as HTMLElement | null;
        if (row) rows.set(date, { top: row.offsetTop, height: row.offsetHeight });
      }
    };
    const apply = () => {
      const top0 = thead?.offsetHeight ?? headerH;
      const st = scroller.scrollTop;
      for (const [date, el] of alertGroupRefs.current) {
        const r = rows.get(date);
        if (!r) {
          el.style.display = "none";
          continue;
        }
        el.style.display = "";
        // Center the block on the row: row midpoint minus half the block height.
        const rowCenter = r.top + r.height / 2 - top0 - st;
        el.style.transform = `translateY(${rowCenter - el.offsetHeight / 2}px)`;
      }
    };
    measure();
    apply();
    scroller.addEventListener("scroll", apply, { passive: true });
    // Re-measure on table layout changes (rows added, PP rows toggled) and
    // re-apply when an alert block's own height changes — e.g. resizing the
    // alerts panel rewraps the text, which would otherwise leave it off-center.
    const ro = new ResizeObserver(() => { measure(); apply(); });
    const table = scroller.querySelector("table");
    if (table) ro.observe(table);
    for (const el of alertGroupRefs.current.values()) ro.observe(el);
    return () => {
      scroller.removeEventListener("scroll", apply);
      ro.disconnect();
    };
  }, [alertGroups, dates, showPPRows, visibleStaff.length, viewMonth, viewYear]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Print-only title: bold-centered "YoSched" brand above the month/year */}
      <div data-print-title className="hidden">
        <span data-print-brand>YoSched</span>
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
                <button onClick={() => { clearColFocus(); setViewYear((y) => y - 1); }} className="px-2 py-0.5 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded">←</button>
                <span className="text-sm font-semibold text-slate-200">{viewYear}</span>
                <button onClick={() => { clearColFocus(); setViewYear((y) => y + 1); }} className="px-2 py-0.5 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded">→</button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {MONTH_NAMES.map((name, i) => (
                  <button
                    key={i}
                    onClick={() => { clearColFocus(); setViewMonth(i); setShowMonthPicker(false); }}
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
        {pastMonth && (
          <button
            onClick={() => { clearColFocus(); setShowAllStaff((v) => !v); }}
            className={["px-3 py-1 text-sm rounded transition-colors", showAllStaff ? "bg-indigo-700 hover:bg-indigo-600 text-indigo-100" : "bg-slate-700 hover:bg-slate-600 text-slate-400"].join(" ")}
            title="Show all staff, including those with no assignments this month"
          >
            Show all staff
          </button>
        )}
        <button
          onClick={() => window.print()}
          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300"
          title="Print this month"
        >
          Print
        </button>
        <button
          onClick={() => setShowVersions(true)}
          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300 flex items-center gap-1.5"
          title="Save or restore versions of this month's schedule"
        >
          Versions
          {focalVersion && (
            <span className="text-xs text-slate-400">
              · v{focalVersion.versionNumber}
              {monthModified && <span className="ml-0.5 text-amber-400" title="Unsaved edits since this version">*</span>}
            </span>
          )}
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

      <div ref={splitContainerRef} className="flex-1 flex overflow-hidden">
      {/* Scrollable grid area */}
      <div ref={scrollRef} className="shrink-0 overflow-auto" style={{ width: `calc(100% - ${alerts.length > 0 ? alertWidth + 4 : 0}px)` }}>
        <table className="border-collapse text-sm w-full">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-800">
              <th className="sticky left-0 z-20 bg-slate-800 px-3 py-2 text-left text-xs font-medium text-slate-400 border-b border-r border-slate-700 w-[88px] min-w-[88px]">
                Date
              </th>
              {visibleStaff.map((p) => {
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
                    data-print-collapse={collapseOtherOnPrint && p.collapsesIntoOther ? "" : undefined}
                    data-print-rule-hide={printHiddenIds.has(p.id) ? "" : undefined}
                    className="px-1 py-1 text-center text-xs font-medium border-b border-slate-700 w-[44px] min-w-[44px] transition-colors cursor-pointer"
                    style={isActiveCol || hoverCol === p.id ? { backgroundColor: "rgba(29,78,216,0.7)" } : undefined}
                    onClick={() => setActiveCol(activeCol === p.id ? null : p.id)}
                    onMouseEnter={(e) => {
                      setHoverCol(p.id);
                      const rect = e.currentTarget.getBoundingClientRect();
                      setTooltip({ text: fTooltip, x: rect.left + rect.width / 2, y: rect.bottom + 4 });
                    }}
                    onMouseLeave={() => { setHoverCol(null); setTooltip(null); }}
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
              {showOtherColumn && (
                <th data-other-col className="hidden px-1 py-1 text-center text-xs font-medium border-b border-slate-700">
                  FB
                </th>
              )}
              {dedicatedColumns.map((st) => (
                <th
                  key={`ded-h-${st.id}`}
                  title={st.name}
                  className="px-1 py-1 text-center text-xs font-medium border-b border-l border-slate-700 w-[44px] min-w-[44px]"
                  style={{ color: st.color }}
                >
                  {st.code}
                </th>
              ))}
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
                    {visibleStaff.map((p) => {
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
                          data-print-collapse={collapseOtherOnPrint && p.collapsesIntoOther ? "" : undefined}
                          data-print-rule-hide={printHiddenIds.has(p.id) ? "" : undefined}
                          className="px-0 py-1 text-center border-slate-600/50 border border-y-indigo-500/60"
                          onMouseEnter={(e) => showTip(setTooltip, `${p.initials}: ${hours}hrs / ${target}hrs target (${diffLabel})`, e)}
                          onMouseLeave={() => setTooltip(null)}
                        >
                          <div className={`text-[10px] font-mono font-bold ${color}`}>
                            {hours > 0 ? diffLabel : "–"}
                          </div>
                        </td>
                      );
                    })}
                    {/* Blank OTHER cell keeps the PP-summary row column-aligned with the day
                        rows in print (where the individual fee-basis columns are hidden). */}
                    {showOtherColumn && (
                      <td data-other-col className="hidden border-slate-600/50 border border-y-indigo-500/60" />
                    )}
                    {dedicatedColumns.length > 0 && (
                      <td colSpan={dedicatedColumns.length} className="border-l border-slate-600 border-y border-y-indigo-500/60" />
                    )}
                    {countColumns.length > 0 ? (
                      <td colSpan={countColumns.length} className="px-2 py-1 text-center text-[10px] font-mono border-l border-slate-600 text-indigo-400/60 border-y border-y-indigo-500/60" />
                    ) : dedicatedColumns.length === 0 ? (
                      <td className="border-y border-y-indigo-500/60" />
                    ) : null}
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
                  data-outside-month={isOutsideMonth || undefined}
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
                      <span className="ml-1 text-amber-400 text-[10px]"
                        onMouseEnter={(e) => showTip(setTooltip, holidayNames.get(date) ?? "", e)}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        ★
                      </span>
                    )}
                  </td>
                  {visibleStaff.map((p) => {
                    const a = assignmentMap.get(`${p.id}:${date}`);
                    const cellKey = `${p.id}:${date}`;
                    const isSaving = saving === cellKey;
                    const isPickerTarget = picker?.staffId === p.id && picker?.date === date;
                    const cw = cellWarnings.get(cellKey);
                    const isDragTarget = dragOver === cellKey;
                    const isDragSrc = dragSource?.staffId === p.id && dragSource?.date === date;
                    const isSelected = selection.has(cellKey);
                    const isActiveCell = activeCol === p.id && isActiveRow;
                    const suggestion = suggestionMap.get(cellKey);
                    const isSuggested = !!suggestion;
                    const reqs = requestsByCell.get(cellKey);
                    const reqSummary = reqs ? summarizeCellRequests(reqs, (id) => shiftTypeMap.get(id)?.code ?? id) : null;
                    const reqCls = reqSummary ? REQ_CAT_CLASSES[reqSummary.category] : null;
                    // Boxed, category-colored request cell; selection/active/drag win.
                    const reqBox =
                      reqSummary && !isSelected && !isActiveCell && !isDragTarget && !isPickerTarget
                        ? `ring-2 ring-inset ${reqSummary.hasApproved ? reqCls!.ring : reqCls!.ringFaint} ${reqCls!.bg}`
                        : "";

                    return (
                      <td
                        key={p.id}
                        data-cell={cellKey}
                        data-bold-cell={a && shiftTypeMap.get(a.shiftTypeId)?.boldOnSchedule ? "" : undefined}
                        data-print-collapse={collapseOtherOnPrint && p.collapsesIntoOther ? "" : undefined}
                        data-print-rule-hide={printHiddenIds.has(p.id) ? "" : undefined}
                        className={[
                          `px-0.5 py-0.5 text-center border-slate-700/30 border relative ${canEdit ? "cursor-pointer" : "cursor-default"}`,
                          isNewPP ? "border-t-2 border-t-indigo-500" : "",
                          !ppEven ? "bg-slate-800/20" : "",
                          reqBox,
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
                        {a && !(isSuggested && shiftTypeMap.get(a.shiftTypeId)?.isOffShift && !a.isLocked) ? (
                          <div
                            draggable={canEdit && !a.isLocked}
                            onDragStart={(e) => handleDragStart(p.id, date, e)}
                            onDragEnd={handleDragEnd}
                            data-shift-code
                            data-bold-print={shiftTypeMap.get(a.shiftTypeId)?.boldOnSchedule || undefined}
                            className={[
                              "text-[11px] font-bold rounded px-1 py-0.5 leading-tight",
                              !canEdit ? "cursor-default" : a.isLocked ? "ring-1 ring-yellow-500/50 cursor-not-allowed" : "hover:brightness-125 cursor-grab active:cursor-grabbing",
                              isSaving ? "opacity-50" : "",
                            ].join(" ")}
                            style={{
                              backgroundColor: shiftTypeMap.get(a.shiftTypeId)?.isOffShift ? "transparent" : a.color + "30",
                              color: shiftTypeMap.get(a.shiftTypeId)?.isOffShift ? "#475569" : a.color,
                            }}
                            onMouseEnter={(e) => showTip(setTooltip,
                              cw && cw.length > 0
                                ? cw.map((w) => w.message).join("\n")
                                : `${p.initials}: ${a.code} on ${formatDate(parseDate(date), dateFormat)}${a.isLocked ? " (locked)" : ""}`,
                              e)}
                            onMouseLeave={() => setTooltip(null)}
                          >
                            {a.code}
                          </div>
                        ) : isSuggested ? (
                          renderSuggestion(suggestion!, shiftTypeMap)
                        ) : isSaving ? (
                          <div className="text-[11px] text-slate-600">...</div>
                        ) : reqSummary ? (
                          // Empty cell with request(s): show the letters in category color.
                          <div
                            className={`text-[10px] font-bold leading-tight ${reqCls!.text} ${reqSummary.hasApproved ? "" : "opacity-60"}`}
                            onMouseEnter={(e) => showTip(setTooltip, requestTooltip(reqs!, date), e)}
                            onMouseLeave={() => setTooltip(null)}
                          >
                            {reqSummary.label}
                          </div>
                        ) : null}
                        {cw && <WarningDot warnings={cw} setTooltip={setTooltip} />}
                        {reqSummary && a && (
                          // Assigned cell with request(s): bare corner marker (no pill) carries the tooltip.
                          // label is letters for a single request, the count for multiple.
                          <span
                            className={`absolute top-0 left-0 px-0.5 text-[8px] font-bold leading-none ${reqCls!.text} ${reqSummary.hasApproved ? "" : "opacity-60"}`}
                            onMouseEnter={(e) => showTip(setTooltip, requestTooltip(reqs!, date), e)}
                            onMouseLeave={() => setTooltip(null)}
                          >
                            {reqSummary.label}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {showOtherColumn && (
                    <td
                      data-other-col
                      className={[
                        "hidden px-0.5 py-0.5 text-center text-[10px] font-semibold leading-tight break-words border-l border-slate-700",
                        isNewPP ? "border-t-2 border-t-indigo-500" : "",
                      ].join(" ")}
                    >
                      {(otherColInitials[date] ?? []).join(", ")}
                    </td>
                  )}
                  {dedicatedColumns.map((st, di) => {
                    const inits = dedicatedColumnInitialsData[di]?.[date] ?? [];
                    const isEditing = canEdit && dedEdit?.shiftTypeId === st.id && dedEdit?.date === date;
                    const isDedSaving = saving === `ded-${st.id}:${date}`;
                    return (
                      <td
                        key={`ded-${st.id}`}
                        className={[
                          "px-0.5 py-0.5 text-center text-[11px] font-mono font-semibold leading-tight break-words border-l border-slate-700",
                          isNewPP ? "border-t-2 border-t-indigo-500" : "",
                          canEdit && !isEditing ? "cursor-text hover:bg-slate-700/30" : "",
                        ].join(" ")}
                        style={{ color: st.color }}
                        title={canEdit && !isEditing ? `Type initials to assign ${st.code}` : undefined}
                        onMouseEnter={!isEditing && inits.length ? (e) => showTip(setTooltip, `${st.code}: ${inits.join(", ")}`, e) : undefined}
                        onMouseLeave={!isEditing && inits.length ? () => setTooltip(null) : undefined}
                        onClick={canEdit && !isEditing ? () => {
                          setTooltip(null);
                          setDedEditValue(inits.join(", "));
                          setDedEdit({ shiftTypeId: st.id, date });
                        } : undefined}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            value={dedEditValue}
                            onChange={(e) => setDedEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                              else if (e.key === "Escape") { e.preventDefault(); dedCancelRef.current = true; e.currentTarget.blur(); }
                            }}
                            onBlur={() => {
                              const cur = dedEdit;
                              const raw = dedEditValue;
                              setDedEdit(null);
                              setDedEditValue("");
                              if (dedCancelRef.current) { dedCancelRef.current = false; return; }
                              if (cur) void handleDedicatedEntry(cur.shiftTypeId, cur.date, raw);
                            }}
                            className="w-full bg-slate-900 text-slate-100 text-center text-[11px] font-mono rounded px-0.5 outline-none ring-1 ring-blue-400"
                            style={{ color: st.color }}
                          />
                        ) : isDedSaving ? (
                          <span className="text-slate-600">…</span>
                        ) : (
                          inits.join(", ")
                        )}
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

      {/* Resize handle + Alerts sidebar */}
      {alerts.length > 0 && (
        <>
        <div
          data-print-hide
          className="w-1 shrink-0 cursor-col-resize bg-slate-700 hover:bg-blue-500 active:bg-blue-400 transition-colors"
          onMouseDown={(e) => {
            e.preventDefault();
            splitDragging.current = true;
            let lastWidth = alertWidth;
            const minGridWidth = 200;
            const onMove = (ev: MouseEvent) => {
              if (!splitDragging.current || !splitContainerRef.current) return;
              const rect = splitContainerRef.current.getBoundingClientRect();
              const maxAlert = rect.width - minGridWidth - 4;
              lastWidth = Math.min(maxAlert, Math.max(120, rect.right - ev.clientX));
              setAlertWidth(lastWidth);
            };
            const onUp = () => {
              splitDragging.current = false;
              localStorage.setItem("yosched:alertWidth", String(Math.round(lastWidth)));
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          }}
        />
        <div data-print-hide className="shrink-0 bg-slate-900/50 flex flex-col overflow-hidden" style={{ width: alertWidth }}>
          <div
            className="shrink-0 flex items-center bg-slate-900 px-3 border-b border-slate-700"
            style={alertHeaderH ? { height: alertHeaderH } : undefined}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Alerts
            </span>
            <span className="ml-1.5 text-[11px] text-slate-500">{alerts.length}</span>
          </div>
          {/* Alert blocks are absolutely positioned to line up with the row they refer to. */}
          <div className="relative flex-1 overflow-hidden">
            {alertGroups.map((g) => {
              // Keep each day's alerts on a single line that ellipsizes when it
              // doesn't fit (widening the panel reveals more). The full set is
              // stacked vertically in the hover tooltip.
              const hasError = g.items.some((it) => it.type === "error");
              const line = g.items.map((it) => it.message).join("  •  ");
              const tip = g.items.map((it) => it.message).join("\n");
              return (
                <div
                  key={g.date}
                  ref={(el) => {
                    const m = alertGroupRefs.current;
                    if (el) m.set(g.date, el);
                    else m.delete(g.date);
                  }}
                  className="absolute left-0 right-0 px-2 will-change-transform"
                  style={{ top: 0 }}
                >
                  <div
                    className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-slate-800/50 cursor-pointer transition-colors overflow-hidden"
                    onMouseEnter={(e) => showTip(setTooltip, tip, e)}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => {
                      const row = scrollRef.current?.querySelector(`tr[data-date="${g.date}"]`);
                      if (row) {
                        const thead = scrollRef.current?.querySelector("thead");
                        if (scrollRef.current && thead) {
                          scrollRef.current.scrollTop = (row as HTMLElement).offsetTop - thead.clientHeight;
                        }
                      }
                    }}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasError ? "bg-red-500" : "bg-amber-500"}`} />
                    <span className="flex-1 min-w-0 text-[11px] text-slate-400 leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
                      {line}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </>
      )}
      </div>

      {/* Version footer — visible on screen AND in print (shows at the bottom of
          the printed schedule). Reflects the focal month's last saved/restored version. */}
      <div
        data-version-footer
        className="shrink-0 border-t border-slate-700 bg-slate-800/60 px-6 py-1.5 text-xs text-slate-400 flex items-center gap-2 flex-wrap"
      >
        {focalVersion ? (
          <>
            <span className="font-semibold text-slate-200">Version {focalVersion.versionNumber}</span>
            <span className="text-slate-500">·</span>
            <span>saved {formatDate(parseDate(focalVersion.savedAt.slice(0, 10)), dateFormat)}</span>
            {focalVersion.comment && (
              <span className="text-slate-500 italic truncate max-w-md" title={focalVersion.comment}>
                — {focalVersion.comment}
              </span>
            )}
            {monthModified && (
              <span data-version-modified className="text-amber-500 font-semibold">
                · includes unsaved edits not in this version
              </span>
            )}
          </>
        ) : (
          <span className="text-slate-500">No saved version for {MONTH_NAMES[viewMonth]} {viewYear}</span>
        )}
      </div>

      {/* Request save error — partial/failed saves are surfaced, not silent */}
      {requestError && (
        <div
          data-print-hide
          role="alert"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-red-900/90 border border-red-500/60 text-red-100 text-sm px-4 py-2 rounded-lg shadow-xl"
        >
          <span>{requestError}</span>
          <button
            onClick={() => setRequestError(null)}
            className="text-red-300 hover:text-white text-base leading-none"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Unified cell picker — assign shifts + make/delete requests in one popover */}
      {canEdit && picker && (
        <div data-print-hide>
          <ShiftPicker
            shiftTypes={shiftTypes}
            currentShiftTypeId={selectionCount > 1 ? null : (assignmentMap.get(`${picker.staffId}:${picker.date}`)?.shiftTypeId ?? null)}
            position={{ x: picker.x, y: picker.y }}
            onSelect={handleSelect}
            onClear={() => {
              if (selection.size > 0) {
                handleClear();
              } else if (picker) {
                handleClear({ staffId: picker.staffId, date: picker.date });
              }
            }}
            onClose={closePicker}
            warnings={pickerWarnings}
            bulkCount={selectionCount > 1 ? selectionCount : undefined}
            existingRequests={
              selectionCount > 1
                ? undefined
                : requestsForStaffDate(localRequests, picker.staffId, picker.date, { includePending: true }).map((r) => ({
                    id: r.id,
                    label: describeRequest(r, (id) => shiftTypeMap.get(id)?.code ?? id),
                    pending: r.status === "pending",
                  }))
            }
            onDeleteRequest={handleDeleteRequest}
            onSaveRequest={handleSaveRequests}
            requestTargetCount={
              selectionCount > 1
                ? groupCellsIntoTargets([...selection].map((k) => { const [staffId, date] = k.split(":"); return { staffId, date }; })).length
                : 1
            }
          />
        </div>
      )}

      {/* Versions panel */}
      {showVersions && (
        <div
          data-print-hide
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeVersions}
        >
          <div
            ref={versionsPanelRef}
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-[520px] max-h-[80vh] flex flex-col"
          >
            {changesView ? (
              /* --- Changes view for a single version --- */
              <>
                <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-700">
                  <button
                    onClick={() => setChangesView(null)}
                    className="text-slate-400 hover:text-white text-base leading-none px-1"
                    aria-label="Back to versions"
                    title="Back"
                  >
                    ←
                  </button>
                  <h2 className="text-sm font-semibold text-slate-200 flex-1 min-w-0 truncate">
                    Changes in v{changesView.version.versionNumber}
                    {changesView.data && !changesView.loading && (
                      <span className="ml-2 font-normal text-slate-500">
                        {changesView.data.previousVersionNumber != null
                          ? `since v${changesView.data.previousVersionNumber}`
                          : "first version of this month"}
                      </span>
                    )}
                  </h2>
                  <button
                    onClick={closeVersions}
                    className="text-slate-400 hover:text-white text-xl leading-none px-1"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>

                {changesView.data && !changesView.loading && changesView.data.summary.total > 0 && (
                  <div className="px-5 py-2 border-b border-slate-700 text-xs flex items-center gap-3 flex-wrap">
                    <span className="text-slate-300 font-medium">
                      {changesView.data.summary.total} change{changesView.data.summary.total !== 1 ? "s" : ""}
                    </span>
                    {changesView.data.summary.added > 0 && <span className="text-emerald-400">{changesView.data.summary.added} added</span>}
                    {changesView.data.summary.removed > 0 && <span className="text-red-400">{changesView.data.summary.removed} removed</span>}
                    {changesView.data.summary.changed > 0 && <span className="text-amber-400">{changesView.data.summary.changed} changed</span>}
                    {changesView.data.summary.locked > 0 && <span className="text-slate-400">{changesView.data.summary.locked} lock</span>}
                  </div>
                )}

                <div className="overflow-y-auto flex-1">
                  {changesView.loading && (
                    <div className="px-5 py-6 text-sm text-slate-500 text-center">Loading…</div>
                  )}
                  {!changesView.loading && changesView.data?.changes.length === 0 && (
                    <div className="px-5 py-6 text-sm text-slate-500 text-center">
                      Identical to the previous version — no schedule changes.
                    </div>
                  )}
                  {!changesView.loading && changesView.data?.changes.map((c, i) => (
                    <div key={i} className="px-5 py-1.5 border-b border-slate-700/40 flex items-center gap-3 text-xs">
                      <span className="w-10 shrink-0 text-slate-500 tabular-nums">{formatDateCompact(parseDate(c.date), dateFormat)}</span>
                      <span className="w-9 shrink-0 font-semibold text-slate-300 truncate" title={c.staffId}>
                        {staffInitialsMap.get(c.staffId) ?? "—"}
                      </span>
                      <span className="flex items-center gap-1.5 min-w-0 flex-wrap">
                        {c.kind === "added" && (
                          <><span className="text-emerald-400 font-bold">+</span><ShiftChip st={shiftTypeMap.get(c.shiftTypeId)} /></>
                        )}
                        {c.kind === "removed" && (
                          <><span className="text-red-400 font-bold">−</span><span className="opacity-50"><ShiftChip st={shiftTypeMap.get(c.shiftTypeId)} /></span></>
                        )}
                        {c.kind === "changed" && (
                          <><ShiftChip st={shiftTypeMap.get(c.fromShiftTypeId)} /><span className="text-slate-500">→</span><ShiftChip st={shiftTypeMap.get(c.toShiftTypeId)} /></>
                        )}
                        {c.kind === "locked" && (
                          <><ShiftChip st={shiftTypeMap.get(c.shiftTypeId)} /><span className="text-slate-400">{c.isLocked ? "🔒 locked" : "🔓 unlocked"}</span></>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              /* --- Version list --- */
              <>
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
                  <h2 className="text-sm font-semibold text-slate-200">
                    Versions — {MONTH_NAMES[viewMonth]} {viewYear}
                  </h2>
                  <button
                    onClick={closeVersions}
                    className="text-slate-400 hover:text-white text-xl leading-none px-1"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>

                {canEdit && (
                  <div className="px-5 py-3 border-b border-slate-700 flex items-center gap-2">
                    <input
                      value={versionComment}
                      onChange={(e) => setVersionComment(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !versionBusy) saveVersion(); }}
                      placeholder="Optional comment…"
                      maxLength={200}
                      className="flex-1 px-2.5 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={saveVersion}
                      disabled={versionBusy}
                      className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-white font-medium whitespace-nowrap"
                    >
                      Save version
                    </button>
                  </div>
                )}

                <div className="overflow-y-auto flex-1">
                  {versionsLoading && (
                    <div className="px-5 py-6 text-sm text-slate-500 text-center">Loading…</div>
                  )}
                  {!versionsLoading && versionList && versionList.length === 0 && (
                    <div className="px-5 py-6 text-sm text-slate-500 text-center">
                      No versions saved for this month yet.
                    </div>
                  )}
                  {!versionsLoading && versionList?.map((v) => (
                    <div
                      key={v.id}
                      className="px-5 py-2.5 border-b border-slate-700/50 flex items-center gap-3 hover:bg-slate-700/30"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-200">v{v.versionNumber}</span>
                          {v.isCurrent && (
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-700/50 text-emerald-300">current</span>
                          )}
                          {v.isAutoBackup && (
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-600/50 text-slate-400">auto-backup</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {formatDate(parseDate(v.createdAt.slice(0, 10)), dateFormat)} · {new Date(v.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                        {v.comment && (
                          <div className="text-xs text-slate-400 italic mt-0.5 truncate" title={v.comment}>{v.comment}</div>
                        )}
                      </div>
                      <button
                        onClick={() => openChanges(v)}
                        className="px-2.5 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-200 whitespace-nowrap"
                        title="Show what changed since the previous version"
                      >
                        Changes
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => restoreVersion(v)}
                          disabled={versionBusy || (v.isCurrent && !monthModified)}
                          className="px-2.5 py-1 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-slate-200 whitespace-nowrap"
                          title={v.isCurrent && !monthModified ? "This is the current state" : "Restore this version"}
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tooltip && (
        <div
          ref={(el) => {
            if (!el) return;
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            const pad = 8;
            let left = tooltip.x - w / 2;
            let top = tooltip.y;
            if (left + w + pad > window.innerWidth) left = window.innerWidth - w - pad;
            if (left < pad) left = pad;
            if (top + h + pad > window.innerHeight) top = tooltip.y - h - 8;
            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
          }}
          className="fixed z-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-200 bg-slate-800 border border-slate-600 rounded shadow-xl whitespace-pre-wrap pointer-events-none w-max max-w-xs"
          style={{ left: -9999, top: -9999 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
