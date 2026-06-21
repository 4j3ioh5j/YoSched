"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ShiftPicker } from "./shift-picker";
import { checkCellWarnings, checkDayStaffing, checkStaffPPHours, type Warning } from "@/lib/constraints";
import { buildAlerts, buildPPHoursAlerts, buildRequestAlerts, buildAlertSections, groupAlertsByDate, type PPHoursEntry, type RequestAlertEntry } from "@/lib/alerts";
import { fairnessColor, fairnessLabel } from "@/lib/fairness";
import { type FollowRuleRow, buildFollowRuleMap } from "@/lib/follow-rules";
import { applyScenario, cellsToCommitOnAccept, freesForScope, type ScenarioOutcome, type ScenarioPin, type ScenarioFree, type ScenarioPinRejection } from "@/lib/scenario";
import { type AutoScheduleInput } from "@/lib/auto-scheduler";
import { formatDate, formatDateCompact, calendarMonthBounds, type DateFormatKey, DEFAULT_DATE_FORMAT } from "@/lib/date-format";
import { isPastMonth, visibleStaffForMonth } from "@/lib/schedule-visibility";
import { monthGridDates } from "@/lib/grid-dates";
import { dedicatedColumnInitials } from "@/lib/dedicated-columns";
import { selectionToTsv, parseClipboardGrid, resolvePaste, pasteSummary, dedicatedSelectionTsv, resolveDedicatedPaste, dedicatedPasteSummary } from "@/lib/grid-clipboard";
import { resolveInitials } from "@/lib/dedicated-column-entry";
import { printVisibleStaffIds, type PrintRule, type ShiftKind } from "@/lib/print-column-visibility";
import { computeAggregateColumns, type AggregateColumn } from "@/lib/print-aggregate-columns";
import { requestsForStaffDate, describeRequest, buildRequestPayloads, groupCellsIntoTargets, keysToRequestIntent, summarizeCellRequests, type ScheduleRequestData, type PickerMarks, type RequestCategory, type RequestKind, type RequestStrength, type RequestStatus } from "@/lib/schedule-requests";
import { hashSnapshot, dateInMonth, type SnapshotChange, type ChangeSummary } from "@/lib/versions";

// A schedule request as delivered to the grid (pure-module shape + display stamp).
// source/notes are carried (beyond ScheduleRequestData) so a deleted request can
// be restored verbatim on undo; autoApproved/approvedBy are re-derived by /restore.
type GridRequest = ScheduleRequestData & { receivedAt: string; source: string; notes: string | null; approvedAt?: string | null; approvedByName?: string | null };

// Everything /api/requests/[id]/restore needs to recreate a request verbatim
// under its original id — captured when a request is created/deleted so undo &
// redo can replay it id-stably.
type RequestSnapshot = {
  id: string;
  staffId: string;
  startDate: string;
  endDate: string;
  kind: RequestKind;
  shiftTypeIds: string[];
  leaveShiftTypeId: string | null;
  strength: RequestStrength;
  status: RequestStatus;
  source: string;
  notes: string | null;
  receivedAt: string;
  autoApproved?: boolean;
  approvedAt?: string | null;
  approvedBy?: string | null;
};

// Box/letter colors per request category (static classes for Tailwind).
const REQ_CAT_CLASSES: Record<RequestCategory | "mixed", { ring: string; ringFaint: string; text: string; bg: string }> = {
  leave: { ring: "ring-amber-400", ringFaint: "ring-amber-400/40", text: "text-amber-300", bg: "bg-amber-900/15" },
  restricted: { ring: "ring-rose-400", ringFaint: "ring-rose-400/40", text: "text-rose-300", bg: "bg-rose-900/15" },
  want: { ring: "ring-emerald-400", ringFaint: "ring-emerald-400/40", text: "text-emerald-300", bg: "bg-emerald-900/15" },
  off: { ring: "ring-sky-400", ringFaint: "ring-sky-400/40", text: "text-sky-300", bg: "bg-sky-900/15" },
  mixed: { ring: "ring-violet-400", ringFaint: "ring-violet-400/40", text: "text-violet-300", bg: "bg-violet-900/15" },
};

// RQ overlay filter: show every request, or just one approval state. "denied" maps
// to the declined status; "pending" is anything still awaiting a decision.
type RequestFilter = "all" | "approved" | "pending" | "denied";
const REQUEST_FILTERS: { value: RequestFilter; label: string; short: string }[] = [
  { value: "all", label: "All requests", short: "All" },
  { value: "approved", label: "Approved only", short: "Appr" },
  { value: "pending", label: "Pending only", short: "Pend" },
  { value: "denied", label: "Denied only", short: "Den" },
];
const REQUEST_FILTER_STATUSES: Record<RequestFilter, RequestStatus[]> = {
  all: ["pending", "approved", "declined"],
  approved: ["approved"],
  pending: ["pending"],
  denied: ["declined"],
};
import { useEscape } from "@/lib/use-escape";

type AvailabilityRuleData = {
  type: string;
  strength: string;
  conditionStaffId?: string | null;
  // WHEN columns — sole recurrence representation (slice 7). checkCellWarnings
  // reads these via ruleToWhen for the non-working-day check.
  whenKind?: string | null;
  whenDays?: number[] | null;
  whenPpWeek?: number | null;
  whenOrds?: number[] | null;
  whenCycleUnit?: string | null;
  whenCycleN?: number | null;
  whenCycleOffset?: number | null;
};

type Staff = {
  id: string;
  initials: string;
  name: string;
  ftePercentage: number;
  employmentTypeId: string;
  employmentTypeName: string;
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
  source?: string;
  autoMonth?: string | null;
  // ShiftType.id the auto run originally placed, when a manual edit later
  // overwrote an auto cell — drives the "Auto → Manual (was X)" tooltip badge.
  autoShiftTypeId?: string | null;
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
  defaultHours: number; // weekday hours
  defaultHoursWeekend: number; // 0 = does not accrue weekend hours
  defaultHoursHoliday: number; // 0 = does not accrue holiday hours; holiday wins over weekend
  countsTowardFte: boolean;
  hotkey?: string | null;
  dedicatedColumn?: boolean;
  boldOnSchedule?: boolean;
  printBackgroundColor?: string | null;
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
  // Day-type-aware overrides; null/undefined falls back to durationHrs.
  durationHrsWeekday?: number | null;
  durationHrsWeekend?: number | null;
  durationHrsHoliday?: number | null;
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
  // Live mode needs the engine input bundle, which requires schedule:auto AND
  // requests:view (it serves raw request/availability data). Gate the entry point
  // on the real permission so a schedule:edit-only group never sees a button that
  // only 403s.
  canLive?: boolean;
  // Clear Auto is a pure schedule:auto operation (DELETE only needs schedule:auto),
  // so it's gated on this — independent of canEdit (schedule:edit) and canLive
  // (which also needs requests:view). Matches the server permission exactly.
  canAuto?: boolean;
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
  printAggregateColumns?: AggregateColumn[];
  dateFormat?: string;
  currentVersions?: CurrentVersionMeta[];
  scheduleRequests?: GridRequest[];
  mutedAlertKeys?: string[]; // alert keys muted by any login (shared, single-tenant)
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
  // post-shift is the only hard (red) cell warning. Pay-period hour divergence
  // (over-/under-hours) is amber and surfaces in the Alerts modal, not as a red dot.
  const hasError = warnings.some((w) => w.type === "post-shift");
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
  canLive = false,
  canAuto = false,
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
  printAggregateColumns = [],
  dateFormat: dateFormatProp,
  currentVersions = [],
  scheduleRequests = [],
  mutedAlertKeys = [],
}: Props) {
  const dateFormat = (dateFormatProp || DEFAULT_DATE_FORMAT) as DateFormatKey;
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  // Remember the viewed month across in-app navigation: returning to the schedule from
  // another tab (Requests/Settings/…) restores the month you left on. sessionStorage is
  // per browser-tab session, so a brand-new tab still opens on the current month. Restored
  // in a layout effect (not a lazy initializer) so SSR/first paint stays on `today` —
  // avoids a whole-grid hydration mismatch — then corrects before the browser paints.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem("yosched:viewMonth");
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (
        Number.isInteger(saved?.year) && saved.year >= 2000 && saved.year <= 2100 &&
        Number.isInteger(saved?.month) && saved.month >= 0 && saved.month <= 11
      ) {
        setViewYear(saved.year);
        setViewMonth(saved.month);
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem("yosched:viewMonth", JSON.stringify({ year: viewYear, month: viewMonth }));
    } catch {
      /* ignore storage failures (private mode / quota) */
    }
  }, [viewYear, viewMonth]);
  const [localAssignments, setLocalAssignments] = useState(initialAssignments);
  const [localRequests, setLocalRequests] = useState<GridRequest[]>(scheduleRequests);
  const [requestError, setRequestError] = useState<string | null>(null);
  // Transient summary after a paste (e.g. "12 set · 2 locked · 1 unknown code").
  const [pasteToast, setPasteToast] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState>(null);
  // Request mode (toggled with "/"): bare letters create REQUESTS instead of
  // assignments, and an open picker shows its Request tab. Single source of
  // truth shared by the grid keyboard and the picker's active tab.
  const [requestMode, setRequestMode] = useState(false);
  // Whether request overlays (rings, letters, corner markers) are drawn on the
  // grid. Purely a display toggle — request data/editing are unaffected. Tied
  // to the "RQ" toolbar button and the "?" (Shift+/) hotkey. Persisted per
  // browser; defaults to shown.
  const [showRequests, setShowRequests] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("yosched:showRequests");
    return saved !== null ? saved === "true" : true;
  });
  const toggleShowRequests = useCallback(() => {
    setShowRequests((v) => {
      const next = !v;
      try { localStorage.setItem("yosched:showRequests", String(next)); } catch { /* private mode / quota */ }
      return next;
    });
  }, []);
  // Which requests the RQ overlay draws: "all" (any non-terminal + denied), or one
  // status in isolation. Lets the scheduler see, e.g., only what's still unfulfilled,
  // or audit what was denied, without losing the others. Persisted per browser.
  const [requestFilter, setRequestFilter] = useState<RequestFilter>(() => {
    if (typeof window === "undefined") return "all";
    const saved = localStorage.getItem("yosched:requestFilter");
    return saved === "approved" || saved === "pending" || saved === "denied" ? saved : "all";
  });
  const [requestMenuOpen, setRequestMenuOpen] = useState(false);
  // Picking a filter mode implies "show requests" — turn the overlay on so the
  // choice is visible immediately, and persist both.
  const chooseRequestFilter = useCallback((f: RequestFilter) => {
    setRequestFilter(f);
    setShowRequests(true);
    setRequestMenuOpen(false);
    try {
      localStorage.setItem("yosched:requestFilter", f);
      localStorage.setItem("yosched:showRequests", "true");
    } catch { /* private mode / quota */ }
  }, []);
  // Request mode creates/edits PENDING requests, so a filter that hides pending
  // ("approved"/"denied" only) would mask the very requests being entered. On
  // entering request mode, widen to "all" if the current filter hides pending.
  // Transient (not persisted) so the saved preference returns next session, and
  // only on the mode transition so it never fights a deliberate in-mode re-pick.
  useEffect(() => {
    if (!requestMode) return;
    setRequestFilter((f) => (f === "approved" || f === "denied" ? "all" : f));
  }, [requestMode]);
  const [saving, setSaving] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<{ staffId: string; date: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const [activeCol, setActiveCol] = useState<string | null>(null);
  // The active cell can live in a STAFF column (activeCol = staffId) OR a DEDICATED
  // column (activeDedCol = shiftTypeId). Invariant: at most one of the two is set at
  // a time (the "only one active column kind" rule). activeRow (the date) is shared.
  // This lets arrow navigation, copy/paste, and Delete treat dedicated cells as
  // first-class grid cells, on par with staff cells.
  const [activeDedCol, setActiveDedCol] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);

  // ── "Live" mode (#231): interactive what-if scheduling ──
  // S2 skeleton: enter fetches the engine input bundle once, runs a NO-OP
  // constrained re-solve (applyScenario with no pins/frees) to prove the client
  // engine reproduces the current grid, and wires Accept (existing PUT) / Cancel.
  // Editing → ripple highlight is S3; rendering still flows through the saved
  // grid + suggestion overlay for now.
  const [liveMode, setLiveMode] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveOutcome, setLiveOutcome] = useState<ScenarioOutcome | null>(null);
  // How wide the engine may re-solve to compensate for an edit (user-selectable in
  // the Live banner). "pp" (default) re-solves only the pay period(s) you touched —
  // enough to rebalance PP hours without churning the whole month; "day" is tightest
  // (same-day coverage only); "range" re-solves everything (most compensation).
  const [liveScope, setLiveScope] = useState<"day" | "pp" | "range">("pp");
  // Hard-rejected pins from the most recent edit (snap-back reasons for the banner).
  const [liveReject, setLiveReject] = useState<ScenarioPinRejection[]>([]);
  // Mirror of liveMode for the document-level keyboard/paste listeners, which close
  // over their effect's scope and would otherwise read a stale value.
  const liveModeRef = useRef(false);
  // The fetched engine input with the current grid (saved DB ∪ previewed
  // suggestions) as its baseline; the un-overlaid saved DB cells (for the Accept
  // diff); and the sandbox undo/redo stacks (a SEPARATE stack from the persisted
  // grid undo — populated in S3 when edits exist).
  const liveInputRef = useRef<AutoScheduleInput | null>(null);
  // The re-solve base for edits: the bundle, but with existingAssignments = the
  // COMPLETE enter-time grid (incl. cells the engine filled into empty slots on
  // enter), each carrying its true lock flag. Re-solving from this — rather than the
  // bundle's possibly-partial existingAssignments — ensures every displayed cell is
  // a baseline cell, so Day/PP scope containment holds even on incomplete grids
  // (out-of-scope cells stay locked → preserved).
  const liveBaseInputRef = useRef<AutoScheduleInput | null>(null);
  // The grid as it stood the instant Live was entered (key → shiftTypeId) — the
  // reference for the RIPPLE highlight (which cells changed since you entered).
  const liveInitialGridRef = useRef<Map<string, string>>(new Map());
  // The SAVED DB grid at enter time (key → shiftTypeId), captured BEFORE any
  // overlay. Accept persists every outcome cell that differs from THIS, so the
  // engine's enter-time fills of empty slots get committed too (WYSIWYG) — not
  // just the user's later edits.
  const liveSavedGridRef = useRef<Map<string, string>>(new Map());
  // The user's accumulated explicit edits this session (key → shiftTypeId). These
  // PIN (lock) on every re-solve so the engine never overrides a deliberate edit;
  // everything not locked/pinned is freed so the engine re-solves it to compensate
  // (the "ripple"). A clear/free removes the cell's pin.
  const livePinsRef = useRef<Map<string, string>>(new Map());
  // Dates the user has touched this session — the anchor for the "day"/"pp" scope
  // (only periods/days containing a touched date are re-solved).
  const liveTouchedRef = useRef<Set<string>>(new Set());
  // Sandbox undo/redo: each entry snapshots the accumulated pins, touched-dates, AND
  // the resulting outcome, so reverting restores all three (editing can continue).
  type LiveSnap = { pins: Map<string, string>; touched: Set<string>; outcome: ScenarioOutcome };
  const liveUndoStack = useRef<LiveSnap[]>([]);
  const liveRedoStack = useRef<LiveSnap[]>([]);
  useEffect(() => { liveModeRef.current = liveMode; }, [liveMode]);

  // Multi-select state
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<{ staffId: string; date: string } | null>(null);

  const [showMonthPicker, setShowMonthPicker] = useState(false);
  // Reverse dedicated-column entry: which dedicated cell is being edited (by
  // shift type + date) and its in-progress text. Null when not editing.
  const [dedEdit, setDedEdit] = useState<{ shiftTypeId: string; date: string } | null>(null);
  const [dedEditValue, setDedEditValue] = useState("");
  const dedCancelRef = useRef(false); // set when Escape cancels a dedicated-cell edit
  // Isolated selection for a dedicated column (ICU/CARD) — a contiguous date range
  // within ONE column, used only for clipboard copy/paste. Kept entirely separate from
  // the staff `selection` Set; any staff-cell interaction clears it so staff copy/paste
  // precedence is never affected. dedAnchorRef remembers the last dedicated cell touched
  // (plain click or shift+click) so shift+click can extend a range.
  const [dedSelection, setDedSelection] = useState<{ shiftTypeId: string; dates: string[] } | null>(null);
  const dedAnchorRef = useRef<{ shiftTypeId: string; date: string } | null>(null);
  // Dedicated-column drag-select state, mirroring the staff dragSelecting refs. While
  // a shift-drag is in progress within one dedicated column, onMouseEnter extends the
  // date range; the shared document mouseup listener clears dedDragging too.
  const dedDragging = useRef(false);
  const dedDragMoved = useRef(false);
  // Re-entrancy guard for clipboard paste. The document "paste" listener re-subscribes
  // whenever assignmentMap changes (our own optimistic update does that mid-await), so a
  // second paste firing during an in-flight one could double-apply from stale snapshot
  // state. While a paste is committing, ignore further paste events.
  const pasteBusyRef = useRef(false);
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
    if (liveMode) return; // no version writes while a Live sandbox is active
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
  }, [viewYear, viewMonth, versionComment, focalVersion, monthModified, liveMode]);

  const restoreVersion = useCallback(async (v: VersionRow) => {
    if (liveMode) return; // no version restore while a Live sandbox is active
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
  }, [viewYear, viewMonth, liveMode]);

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
  useEscape(() => setShowAlerts(false));
  useEscape(() => setShowHelp(false));

  // Alerts + Help modals (the alerts sidebar was replaced by an Alerts button).
  const [showAlerts, setShowAlerts] = useState(false);
  // Alert-modal sections that are collapsed (by category). Empty = all expanded.
  const [collapsedAlertSections, setCollapsedAlertSections] = useState<Set<string>>(new Set());
  const [showHelp, setShowHelp] = useState(false);
  // Transient highlight on the day-row a user jumps to from the Alerts modal.
  const [flashDate, setFlashDate] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  // Scroll the grid to a day-row and flash it. Used by the Alerts modal.
  const jumpToDate = useCallback((date: string) => {
    setShowAlerts(false);
    requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      const row = scroller?.querySelector(`tr[data-date="${date}"]`) as HTMLElement | null;
      const thead = scroller?.querySelector("thead") as HTMLElement | null;
      if (scroller && row) scroller.scrollTop = row.offsetTop - (thead?.clientHeight ?? 0);
      setFlashDate(date);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashDate(null), 1600);
    });
  }, []);

  // Shift+drag-select state
  const dragSelecting = useRef(false);
  const dragSelectMoved = useRef(false);
  const dragSelectAnchor = useRef<{ staffId: string; date: string } | null>(null);

  // Undo/redo stacks — each entry is a group of changes applied together
  type UndoOp = { staffId: string; date: string; prev: AssignmentData | null; next: AssignmentData | null };
  // Tagged-union undo stack so assignments AND requests share one chronological
  // Cmd-Z / redo. Request entries are id-stable: undo/redo recreate a request
  // under its ORIGINAL id (via /restore) so no other stack entry goes stale.
  type UndoEntry =
    | { kind: "assignment"; ops: UndoOp[] }
    | { kind: "request-create"; snapshots: RequestSnapshot[] }
    | { kind: "request-delete"; snapshots: RequestSnapshot[] }
    // approve/deny that changed EXACTLY ONE request (no co-approval cascade) —
    // safely reversible by a single PATCH. undo/redo PATCH it back and apply the
    // returned affected window.
    | { kind: "request-status"; item: { id: string; from: RequestStatus; to: RequestStatus } }
    // approve/deny that cascaded (co-approved neighbours / shared placement):
    // a single-PATCH undo would race the auto-approve sync and leave stale state,
    // so it is NOT undoable — Cmd-Z warns instead of attempting it.
    | { kind: "request-status-blocked" };
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const dates = useMemo(
    () => monthGridDates(viewYear, viewMonth, payPeriods),
    [viewYear, viewMonth, payPeriods],
  );

  // The actual calendar month (not the week-padded display range) — Auto-schedule
  // and Clear Auto operate on this so the server expands to pay-period edges
  // instead of swallowing a whole extra pay period when the week padding lands on
  // the next period's first day. The grid still DISPLAYS the week-padded `dates`.
  const monthBounds = useMemo(
    () => calendarMonthBounds(viewYear, viewMonth),
    [viewYear, viewMonth],
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

  const shiftTypeMap = useMemo(() => {
    const map = new Map<string, ShiftType>();
    for (const st of shiftTypes) map.set(st.id, st);
    return map;
  }, [shiftTypes]);

  // In Live mode the grid renders from the in-browser re-solve, not the saved
  // assignments: liveDisplayMap is the result grid as renderable cells, and
  // liveRippleSet flags every cell whose shift differs from the enter-time grid
  // (the cells the engine had to change — the "ripple").
  const liveDisplayMap = useMemo(() => {
    const m = new Map<string, AssignmentData>();
    if (!liveMode || !liveOutcome) return m;
    // Carry the real lock flags from the enter-time bundle so locked cells stay
    // locked in Live (not draggable/editable) — the engine and the re-solve hold
    // them fixed, and the UI must agree.
    const locked = new Set<string>();
    for (const a of liveInputRef.current?.existingAssignments ?? []) {
      if (a.isLocked) locked.add(`${a.staffId}:${a.date}`);
    }
    const initial = liveInitialGridRef.current;
    for (const c of liveOutcome.grid) {
      const key = `${c.staffId}:${c.date}`;
      // Preview provenance: a cell the engine changed will be written source="auto"
      // on Accept, so show Auto now (its saved "manual"/empty source is stale in the
      // what-if). Unchanged cells keep whatever provenance the saved grid has.
      const changed = initial.get(key) !== c.shiftTypeId;
      const saved = assignmentMap.get(key);
      m.set(key, {
        id: `live-${key}`,
        staffId: c.staffId,
        date: c.date,
        shiftTypeId: c.shiftTypeId,
        isLocked: locked.has(key),
        code: c.code,
        color: shiftTypeMap.get(c.shiftTypeId)?.color ?? "#6b7280",
        source: changed ? "auto" : (saved?.source ?? "auto"),
        autoMonth: changed ? null : (saved?.autoMonth ?? null),
        autoShiftTypeId: changed ? null : (saved?.autoShiftTypeId ?? null),
      });
    }
    return m;
  }, [liveMode, liveOutcome, shiftTypeMap, assignmentMap]);

  const liveRippleSet = useMemo(() => {
    const s = new Set<string>();
    if (!liveMode || !liveOutcome) return s;
    const initial = liveInitialGridRef.current;
    for (const c of liveOutcome.grid) {
      const k = `${c.staffId}:${c.date}`;
      if (initial.get(k) !== c.shiftTypeId) s.add(k);
    }
    return s;
  }, [liveMode, liveOutcome]);

  // In Live, the schedule-health computations (cell warnings, day staffing, PP-hours
  // totals/colors, count columns) read the LIVE grid so breaches reflect the what-if;
  // outside Live this IS the saved assignment map, so normal behavior is unchanged.
  // (Edit logic still reads assignmentMap — the SAVED state — for lock checks.)
  const effectiveAssignmentMap = (liveMode && liveOutcome) ? liveDisplayMap : assignmentMap;

  // Reverse map for paste: UPPERCASE shift code → id (codes are unique). Lets a pasted
  // "ORC"/"x" resolve to a shift type without a server round-trip.
  const codeToId = useMemo(() => {
    const map = new Map<string, string>();
    for (const st of shiftTypes) map.set(st.code.toUpperCase(), st.id);
    return map;
  }, [shiftTypes]);

  // The HOL shift's print background color shades the date cell of every holiday on the
  // PRINTED schedule (replaces the old asterisk marker). Driven by the HOL shift's
  // "Print background" setting, so clearing it removes the shading; null → no shading.
  const holidayPrintBg = useMemo(
    () => shiftTypes.find((st) => st.code === "HOL")?.printBackgroundColor ?? null,
    [shiftTypes],
  );

  // Request chrome (boxed border + bare letters + corner badge) surfaces the
  // original requests under the RQ overlay, scoped by `requestFilter`: "all" shows
  // every request with its outcome (approved / pending / denied), or one status in
  // isolation. The box treatment encodes the state — solid = approved, faint =
  // pending, struck rose = denied — so an approved request stays visible after
  // auto-schedule instead of silently dropping its chrome. Hard-constraint
  // violations still raise the warning dot. Keyed `${staffId}:${date}`; empty
  // cells omitted.
  const requestsByCell = useMemo(() => {
    const map = new Map<string, GridRequest[]>();
    if (localRequests.length === 0) return map;
    const statuses = REQUEST_FILTER_STATUSES[requestFilter];
    for (const date of dates) {
      for (const p of visibleStaff) {
        const rs = requestsForStaffDate(localRequests, p.id, date, { statuses });
        if (rs.length > 0) map.set(`${p.id}:${date}`, rs);
      }
    }
    return map;
  }, [localRequests, dates, visibleStaff, requestFilter]);

  // Approved requests only — these are the ones that exert scheduling force, so
  // they're what the cell-warning checks consume (checkRequestConflict ignores
  // pending, but pre-filtering keeps the per-cell work small).
  const approvedRequests = useMemo(
    () => localRequests.filter((r) => r.status === "approved"),
    [localRequests]
  );

  // Provenance line: where this shift came from, and — when a manual edit
  // overwrote an auto cell — what the auto run had chosen.
  const sourceLine = useCallback((a: AssignmentData): string => {
    if (a.source === "auto") return "Source: Auto";
    if (a.source === "imported") return "Source: Imported";
    if (a.source === "request") return "Source: Request-placed";
    if (a.source === "manual" && a.autoShiftTypeId) {
      const was = shiftTypeMap.get(a.autoShiftTypeId)?.code ?? "?";
      return `Source: Auto → Manual (was ${was})`;
    }
    return "Source: Manual"; // manual, or legacy/local cells with no source
  }, [shiftTypeMap]);

  const requestLine = useCallback((r: GridRequest): string => {
    const desc = describeRequest(r, (id) => shiftTypeMap.get(id)?.code ?? id);
    const recv = formatDate(parseDate(r.receivedAt.split("T")[0]), dateFormat);
    const status =
      r.status === "approved" ? (r.autoApproved ? "Auto-approved" : "Manually-approved")
      : r.status === "declined" ? "Manually-denied"
      : r.status === "fulfilled" ? "Fulfilled"
      : r.status === "withdrawn" ? "Withdrawn"
      : "Pending";
    // "by <name>" only for an actually-approved request (declined clears the
    // approver; pending never had one) and only when a name was resolved
    // (schedule:edit viewers). The decision date follows when known.
    const named = r.status === "approved" && r.approvedByName;
    const by = named ? ` by ${r.approvedByName}` : "";
    const on = named && r.approvedAt ? ` (${formatDate(parseDate(r.approvedAt.split("T")[0]), dateFormat)})` : "";
    return `  • ${desc} — ${status}${by}${on}, rec'd ${recv}`;
  }, [shiftTypeMap, dateFormat]);

  // ONE tooltip for every grid cell, parallel construction in all modes:
  //   <initials> · <date>
  //   Assignment: <code | None>[ (locked)]
  //   Source: <…>                 (only when assigned)
  //   Requests:                   (only when present)
  //     • <desc> — <status>, rec'd <date>
  const cellTooltip = useCallback(
    (initials: string, date: string, a: AssignmentData | null | undefined, reqs: GridRequest[] | null | undefined): string => {
      const lines: string[] = [
        `${initials} · ${formatDate(parseDate(date), dateFormat)}`,
        `Assignment: ${a ? a.code : "None"}${a?.isLocked ? " (locked)" : ""}`,
      ];
      if (a) lines.push(sourceLine(a));
      if (reqs && reqs.length) {
        lines.push("Requests:");
        for (const r of reqs) lines.push(requestLine(r));
      }
      return lines.join("\n");
    },
    [dateFormat, sourceLine, requestLine],
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
    const map = new Map<string, { weekday: number; weekend: number; holiday: number }>();
    for (const o of staffOverrides) {
      const weekend = o.durationHrsWeekend ?? o.durationHrs;
      // An unset holiday value mirrors the weekend resolution (legacy back-compat).
      map.set(`${o.staffId}:${o.shiftTypeId}`, {
        weekday: o.durationHrsWeekday ?? o.durationHrs,
        weekend,
        holiday: o.durationHrsHoliday ?? weekend,
      });
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

  function getHoursForAssignment(
    staffId: string,
    shiftTypeId: string,
    dayType: "weekday" | "weekend" | "holiday",
  ): number {
    const override = overrideMap.get(`${staffId}:${shiftTypeId}`);
    if (override !== undefined) return override[dayType];
    const st = shiftTypeMap.get(shiftTypeId);
    if (!st) return 0;
    return dayType === "holiday"
      ? st.defaultHoursHoliday
      : dayType === "weekend"
        ? st.defaultHoursWeekend
        : st.defaultHours;
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
          const a = effectiveAssignmentMap.get(key);
          const stId = a?.shiftTypeId;
          if (stId && shiftCountsTowardFte(stId)) {
            const dow = cursor.getDay();
            // Holiday wins over weekend. A day type the shift doesn't accrue on
            // resolves to 0 hours, so no explicit day-type gate is needed.
            const dayType = holidaySet.has(dateStr)
              ? "holiday"
              : dow === 0 || dow === 6
                ? "weekend"
                : "weekday";
            hours += getHoursForAssignment(p.id, stId, dayType);
          }
          cursor.setDate(cursor.getDate() + 1);
        }
        staffHours.set(p.id, hours);
      }
      result.set(pp.startDate, staffHours);
    }
    return result;
  }, [sortedPPs, visibleStaff, effectiveAssignmentMap, overrideMap, shiftTypeMap]);

  const followRuleMap = useMemo(() => buildFollowRuleMap(followRules ?? []), [followRules]);

  const cellWarnings = useMemo(() => {
    const map = new Map<string, Warning[]>();
    for (const date of dates) {
      for (const p of staff) {
        const a = effectiveAssignmentMap.get(`${p.id}:${date}`);
        if (!a) continue;
        const warnings = checkCellWarnings({
          staffId: p.id,
          date,
          shiftTypeId: a.shiftTypeId,
          staff: p,
          shiftTypeMap,
          assignmentMap: effectiveAssignmentMap,
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
  }, [dates, staff, effectiveAssignmentMap, shiftTypeMap, holidaySet, staffingMins, followRuleMap, approvedRequests]);

  // Compute per-day staffing warnings
  const dayWarnings = useMemo(() => {
    const map = new Map<string, Warning[]>();
    for (const date of dates) {
      const warnings = checkDayStaffing({
        date,
        staff,
        assignmentMap: effectiveAssignmentMap,
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
  }, [dates, staff, effectiveAssignmentMap, shiftTypeMap, holidaySet, staffingMins, staffingReqs]);

  const columnCounts = useMemo(() => {
    return countColumns.map((col) => {
      const codeSet = new Set(col.shiftCodes);
      const counts: Record<string, number> = {};
      for (const date of dates) {
        let count = 0;
        for (const p of staff) {
          const key = `${p.id}:${date}`;
          const a = effectiveAssignmentMap.get(key);
          const code = a?.code;
          if (code && codeSet.has(code)) count++;
        }
        counts[date] = count;
      }
      return counts;
    });
  }, [dates, staff, effectiveAssignmentMap, countColumns]);

  // Shift types flagged for a dedicated column, in sort order. Each gets its own
  // column (left of the count columns) listing the initials of whoever covers
  // that shift on a given day — additive to the normal in-cell shift display.
  const dedicatedColumns = useMemo(
    () => shiftTypes.filter((st) => st.dedicatedColumn),
    [shiftTypes],
  );

  // Per dedicated column: date -> initials of staff covering that shift that
  // day. Mirrors columnCounts (scans all staff so coverage shows even when a
  // staff's own column is hidden).
  const dedicatedColumnInitialsData = useMemo(() => {
    return dedicatedColumns.map((st) =>
      dedicatedColumnInitials(staff, dates, st.code, (pid, date) => {
        const key = `${pid}:${date}`;
        return effectiveAssignmentMap.get(key)?.code;
      }),
    );
  }, [dedicatedColumns, dates, staff, effectiveAssignmentMap]);

  // Print-only column model. Computes, for the printed schedule:
  //   - hiddenIds: staff whose individual column is hidden — they match no enabled
  //     print-column rule, OR they're CLAIMED by an aggregate column with
  //     suppressMembers (folded together so the grid stamps one `data-print-rule-hide`).
  //   - aggregateColumns: the configurable aggregate columns (replacing the old
  //     hardcoded "FB" column), each with per-date member initials. Only columns that
  //     have a scheduled member on an in-month day are kept (skip-empty over the
  //     PRINTED period — so the seeded default "Other" adds nothing when empty).
  // On-screen the grid still shows every staff; this only affects print. Shift codes
  // are gathered from REAL assignments in the printed (in-month) dates.
  const { printHiddenIds, printAggColumns } = useMemo(() => {
    // Only scan dates the printed page actually shows — the grid's `dates` include
    // leading/trailing outside-month padding rows that print CSS hides, so a shift
    // landing only in a padding day must NOT make a staff's column print, nor make an
    // aggregate column appear.
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
    // Code → kind (work | leave | off) for category-based shift conditions.
    const kindByCode = new Map<string, ShiftKind>();
    for (const st of shiftTypes) {
      kindByCode.set(st.code, st.isOffShift ? "off" : st.isLeave ? "leave" : "work");
    }
    const visStaff = visibleStaff.map((p) => ({
      id: p.id,
      employmentTypeId: p.employmentTypeId,
      ftePercentage: p.ftePercentage,
    }));
    const visIds = printVisibleStaffIds(visStaff, printColumnRules, codesByStaff, kindByCode);

    // Render gate (assignment exists that day + not an off-shift) and per-day code lookup,
    // used by both scope modes of the aggregate columns.
    const isScheduledNonOff = (staffId: string, date: string) => {
      const a = assignmentMap.get(`${staffId}:${date}`);
      return !!a && !offShiftTypeIds.has(a.shiftTypeId);
    };
    const codeByStaffDate = (staffId: string, date: string) => assignmentMap.get(`${staffId}:${date}`)?.code;

    // Aggregate columns: per-day member ids + which individual columns they suppress.
    // Pass ONLY in-month dates — ownership, suppression and the catch-all residual must
    // ignore the leading/trailing padding rows (print CSS hides them), or a day-scoped
    // suppressing column matching only on a padding day could hide a staff member's
    // in-month individual column while its own (in-month-empty) column is filtered out.
    const agg = computeAggregateColumns(
      visStaff,
      visIds,
      printAggregateColumns,
      inMonth,
      codesByStaff,
      codeByStaffDate,
      kindByCode,
      isScheduledNonOff,
    );

    // Hidden = not rule-visible (visIds null = everyone visible) ∪ suppressed-by-aggregate.
    const hiddenIds = visIds
      ? new Set(visibleStaff.filter((p) => !visIds.has(p.id)).map((p) => p.id))
      : new Set<string>();
    for (const id of agg.suppressedIndividualIds) hiddenIds.add(id);

    // Per-column day initials over ALL dates (cells must align with every grid row),
    // but only keep columns with a scheduled member on an in-month day (skip-empty).
    const initialsById = new Map(visibleStaff.map((p) => [p.id, p.initials]));
    const printAggColumns = agg.columns
      .map((c) => {
        const initialsByDate: Record<string, string[]> = {};
        for (const d of dates) {
          initialsByDate[d] = (c.memberIdsByDate[d] ?? []).map((id) => initialsById.get(id) ?? "");
        }
        return { label: c.label, initialsByDate };
      })
      .filter((c) => inMonth.some((d) => (c.initialsByDate[d]?.length ?? 0) > 0));

    return { printHiddenIds: hiddenIds, printAggColumns };
  }, [printColumnRules, printAggregateColumns, visibleStaff, dates, assignmentMap, firstOfMonth, lastOfMonth, shiftTypes, offShiftTypeIds]);

  // Drop column focus + selection when the visible column set may change (month
  // change / Show-all toggle), so focus and selection rectangles never point at
  // a column that gets suppressed. Done in the event handlers (not an effect) to
  // avoid setState-in-effect cascades.
  function clearColFocus() {
    setActiveCol(null);
    setActiveDedCol(null);
    setSelection(new Set());
    setSelectionAnchor(null);
    // Also drop any dedicated-column selection: its dates belong to the old month, so
    // leaving it set would give stale copy precedence over staff copy after navigation.
    setDedSelection(null);
    dedAnchorRef.current = null;
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

  // Any path that moves focus into a STAFF column must drop dedicated active/selection
  // state, upholding the one-active-kind invariant (so right-click, the header click,
  // clicks and drags can never leave a stale dedicated cell highlighted/active).
  function clearDedFocus() {
    setActiveDedCol(null);
    setDedSelection(null);
    dedAnchorRef.current = null;
  }

  function handleCellClick(staffId: string, date: string, e: React.MouseEvent) {
    clearDedFocus(); // staff interaction always clears dedicated active/selection
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
    // A locked assignment blocks the Assign tab, but requests are independent of
    // the lock — so in request mode the picker still opens (on its Request tab).
    if (existing?.isLocked && !requestMode) return;
    clearDedFocus(); // right-click focuses a staff cell — drop dedicated active/selection
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
    clearDedFocus(); // staff drag-select clears dedicated active/selection
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

  // ----- Dedicated-column (ICU/CARD) cell interaction — parity with staff cells -----
  // A dedicated cell holds a day's ROSTER (initials of everyone covering that shift),
  // not a single shift code, but it now behaves like a staff cell: a click selects it
  // and makes it the active cell; clicking the already-active cell opens the inline
  // editor; shift+click / shift+drag select a contiguous date range within ONE column.
  const dedReqModeHint = "Dedicated edits set assignments — exit request mode (press /) first.";

  // The roster initials shown in a dedicated cell — the SAME source the cell renders,
  // so the editor prefills exactly what is on screen.
  function dedRosterInitials(shiftTypeId: string, date: string): string[] {
    const di = dedicatedColumns.findIndex((s) => s.id === shiftTypeId);
    return di >= 0 ? (dedicatedColumnInitialsData[di]?.[date] ?? []) : [];
  }

  // Open the inline initials editor for one dedicated cell. Like staff assignment edits
  // and paste, this is blocked in request mode — which must never create firm assignment
  // changes — and surfaces a hint instead.
  function openDedEditor(shiftTypeId: string, date: string) {
    if (!canEdit) return;
    if (requestMode) { setPasteToast(dedReqModeHint); return; }
    setDedEditValue(dedRosterInitials(shiftTypeId, date).join(", "));
    setDedEdit({ shiftTypeId, date });
  }

  // Delete-key clear: empties a dedicated cell's roster via the entry path (empty value
  // removes everyone currently holding this shift that day; locked cells are preserved
  // by handleDedicatedEntry). Request-mode gated.
  function clearDedRoster(shiftTypeId: string, date: string) {
    if (!canEdit) return;
    if (requestMode) { setPasteToast(dedReqModeHint); return; }
    void handleDedicatedEntry(shiftTypeId, date, "");
  }

  // Make a dedicated cell the active cell, dropping all staff focus (one-active-kind
  // invariant) and any prior dedicated range.
  function focusDedCell(shiftTypeId: string, date: string) {
    setActiveCol(null);
    setSelection(new Set());
    setSelectionAnchor(null);
    setActiveDedCol(shiftTypeId);
    setActiveRow(date);
  }

  function handleDedCellClick(shiftTypeId: string, date: string, e: React.MouseEvent) {
    setTooltip(null);
    if (e.shiftKey) {
      // A drag already set the range — ignore the trailing click (mirrors staff).
      if (dedDragMoved.current) { dedDragMoved.current = false; return; }
      // Shift+click: extend a date range within THIS column from the anchor, but only
      // when the anchor is in the same column and still in the visible month; otherwise
      // start a fresh single-cell selection.
      const anchor = dedAnchorRef.current;
      const ia = anchor && anchor.shiftTypeId === shiftTypeId ? dates.indexOf(anchor.date) : -1;
      const ib = dates.indexOf(date);
      if (ia >= 0 && ib >= 0) {
        const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
        setDedSelection({ shiftTypeId, dates: dates.slice(lo, hi + 1) });
      } else {
        dedAnchorRef.current = { shiftTypeId, date };
        setDedSelection({ shiftTypeId, dates: [date] });
      }
      focusDedCell(shiftTypeId, date);
      return;
    }
    // Plain click on the already-active single cell → open the editor (the chosen
    // "click the selected cell to edit" trigger).
    if (activeDedCol === shiftTypeId && activeRow === date && !(dedSelection && dedSelection.dates.length > 1)) {
      openDedEditor(shiftTypeId, date);
      return;
    }
    // Plain click elsewhere → select it (no editor). Available to viewers too.
    focusDedCell(shiftTypeId, date);
    dedAnchorRef.current = { shiftTypeId, date };
    setDedSelection(null);
  }

  function handleDedCellMouseDown(shiftTypeId: string, date: string, e: React.MouseEvent) {
    if (e.button !== 0 || !e.shiftKey) return;
    // Suppress the browser's native text selection (the "extraneous page highlight" bug)
    // and begin an in-column drag range-select.
    e.preventDefault();
    dedDragging.current = true;
    dedDragMoved.current = false;
    const anchor = dedAnchorRef.current && dedAnchorRef.current.shiftTypeId === shiftTypeId
      ? dedAnchorRef.current
      : { shiftTypeId, date };
    dedAnchorRef.current = anchor;
    const ia = dates.indexOf(anchor.date);
    const ib = dates.indexOf(date);
    if (ia >= 0 && ib >= 0) {
      const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
      setDedSelection({ shiftTypeId, dates: dates.slice(lo, hi + 1) });
    }
    focusDedCell(shiftTypeId, date);
  }

  function handleDedCellMouseEnter(shiftTypeId: string, date: string) {
    if (!dedDragging.current) return;
    const anchor = dedAnchorRef.current;
    if (!anchor || anchor.shiftTypeId !== shiftTypeId) return;
    dedDragMoved.current = true;
    const ia = dates.indexOf(anchor.date);
    const ib = dates.indexOf(date);
    if (ia < 0 || ib < 0) return;
    const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
    setDedSelection({ shiftTypeId, dates: dates.slice(lo, hi + 1) });
    setActiveDedCol(shiftTypeId);
    setActiveRow(date);
  }

  useEffect(() => {
    function onMouseUp() {
      dragSelecting.current = false;
      dedDragging.current = false;
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

  // Assignment ops keep their original call sites; wrap them as an entry so the
  // 7 existing pushUndo() callers are untouched.
  function pushUndo(ops: UndoOp[]) {
    pushUndoEntry({ kind: "assignment", ops });
  }
  function pushUndoEntry(entry: UndoEntry) {
    undoStack.current.push(entry);
    redoStack.current = [];
  }

  async function applyAssignment(staffId: string, date: string, assignment: AssignmentData | null) {
    if (liveMode) return; // hard guard: no persisted assignment writes during a Live sandbox
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
        const { requestChanges, ...saved } = await res.json();
        setLocalAssignments((prev) =>
          prev.map((a) => (a.staffId === staffId && a.date === date ? saved : a)),
        );
        applyRequestDelta({ requests: requestChanges });
      } catch { /* optimistic stays */ }
    } else {
      setLocalAssignments((prev) =>
        prev.filter((a) => !(a.staffId === staffId && a.date === date)),
      );
      try {
        const res = await fetch("/api/assignments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId, date }),
        });
        const data = await res.json().catch(() => null);
        applyRequestDelta({ requests: data?.requestChanges });
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
    if (liveMode) return false; // hard guard: no persisted assignment writes during a Live sandbox
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
        const { requestChanges, ...saved } = await res.json();
        setLocalAssignments((cur) =>
          cur.map((a) => (a.staffId === staffId && a.date === date ? saved : a)),
        );
        applyRequestDelta({ requests: requestChanges });
      } else {
        const data = await res.json().catch(() => null);
        applyRequestDelta({ requests: data?.requestChanges });
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
    if (liveMode) return; // dedicated-column entry in Live is a later sub-slice
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

  // Optimistically drop / re-add requests in local state, then persist. Best-
  // effort like the assignment undo path; a failed call surfaces a message.
  async function deleteRequestsForUndo(snapshots: RequestSnapshot[]) {
    setLocalRequests((prev) => prev.filter((r) => !snapshots.some((s) => s.id === r.id)));
    const results = await Promise.all(
      snapshots.map((s) => fetch(`/api/requests/${s.id}`, { method: "DELETE" }).then((r) => r.ok).catch(() => false)),
    );
    if (results.some((ok) => !ok)) setRequestError("Some requests could not be removed during undo/redo.");
  }
  async function restoreRequestsForUndo(snapshots: RequestSnapshot[]) {
    setLocalRequests((prev) => [
      ...snapshots.map((s): GridRequest => ({
        id: s.id, staffId: s.staffId, startDate: s.startDate, endDate: s.endDate,
        kind: s.kind, shiftTypeIds: s.shiftTypeIds, leaveShiftTypeId: s.leaveShiftTypeId,
        strength: s.strength, status: s.status, receivedAt: s.receivedAt,
        source: s.source, notes: s.notes,
      })),
      ...prev,
    ]);
    const results = await Promise.all(
      snapshots.map((s) =>
        fetch(`/api/requests/${s.id}/restore`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s),
        }).then((r) => r.ok).catch(() => false),
      ),
    );
    if (results.some((ok) => !ok)) setRequestError("Some requests could not be restored during undo/redo.");
  }

  // Apply the authoritative "affected window" a request status change returns:
  // overlapping pending/approved requests (incl. co-approved neighbours) and the
  // current assignment on each covered cell. Replaces local state for that
  // window so the grid always matches the server.
  type AffectedDelta = {
    // approvedByName/approvedAt are present from the PATCH route (schedule:edit);
    // the assignment-write sync deltas omit them (name shows on next load instead).
    requests?: { id: string; status: RequestStatus; autoApproved: boolean; approvedByName?: string | null; approvedAt?: string | null }[];
    cells?: { staffId: string; date: string; assignment: { id: string; shiftTypeId: string; isLocked: boolean } | null }[];
  };
  function applyRequestDelta(affected?: AffectedDelta) {
    if (!affected) return;
    if (affected.requests?.length) {
      // Carry autoApproved too — a sync auto-approval (e.g. accepting an
      // auto-generated schedule) flips a pending request to approved AND sets
      // autoApproved=true; without it the row kept its old false and mislabeled
      // as "Manually-approved".
      const m = new Map(affected.requests.map((r) => [r.id, r]));
      setLocalRequests((prev) => prev.map((r) => {
        const d = m.get(r.id);
        if (!d) return r;
        // Always take the delta's approver fields so an explicit clear (a revert
        // sends approvedByName=null) wipes the stale name instead of keeping it.
        // The assignment-write sync path omits them → null here, and the real name
        // is re-resolved on the next load / requests refetch.
        return {
          ...r,
          status: d.status,
          autoApproved: d.autoApproved,
          approvedByName: d.approvedByName ?? null,
          approvedAt: d.approvedAt ?? null,
        };
      }));
    }
    if (affected.cells?.length) {
      setLocalAssignments((prev) => {
        let next = prev;
        for (const c of affected.cells!) {
          next = next.filter((a) => !(a.staffId === c.staffId && a.date === c.date));
          if (c.assignment) {
            const st = shiftTypeMap.get(c.assignment.shiftTypeId);
            next = [...next, { id: c.assignment.id, staffId: c.staffId, date: c.date, shiftTypeId: c.assignment.shiftTypeId, isLocked: c.assignment.isLocked, code: st?.code ?? "?", color: st?.color ?? "#6b7280" }];
          }
        }
        return next;
      });
    }
  }

  // PATCH one request's status and apply the affected window it returns. The
  // explicit row's status is set by the caller (a terminal status like declined
  // drops out of the returned window). Returns ok + http status (409 = locked).
  async function patchRequestStatus(id: string, status: RequestStatus): Promise<{ ok: boolean; httpStatus: number; affected?: AffectedDelta }> {
    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const affected = (await res.json())?.affected as AffectedDelta | undefined;
        applyRequestDelta(affected);
        return { ok: true, httpStatus: res.status, affected };
      }
      return { ok: res.ok, httpStatus: res.status };
    } catch {
      return { ok: false, httpStatus: 0 };
    }
  }

  async function handleUndo() {
    if (liveMode) return; // Live has its own sandbox revert/advance in the banner
    const entry = undoStack.current.pop();
    if (!entry) return;
    if (entry.kind === "request-status-blocked") {
      // Consume the marker and warn — a cascading approve/deny isn't Cmd-Z-able.
      setRequestError("That approve/deny also changed related requests, so it can't be undone with Cmd-Z — reverse it from the Requests view.");
      return;
    }
    redoStack.current.push(entry);
    if (entry.kind === "assignment") {
      await Promise.all(entry.ops.map((op) => applyAssignment(op.staffId, op.date, op.prev)));
    } else if (entry.kind === "request-create") {
      await deleteRequestsForUndo(entry.snapshots); // undo a create = delete the requests
    } else if (entry.kind === "request-delete") {
      await restoreRequestsForUndo(entry.snapshots); // undo a delete = restore them (same ids)
    } else if (entry.kind === "request-status") {
      // Single, non-cascading change → revert with one PATCH; the affected
      // window restores its placement.
      setLocalRequests((prev) => prev.map((r) => (r.id === entry.item.id ? { ...r, status: entry.item.from } : r)));
      const { ok } = await patchRequestStatus(entry.item.id, entry.item.from);
      if (!ok) setRequestError("The request approval could not be reverted during undo.");
    }
  }

  async function handleRedo() {
    if (liveMode) return; // Live has its own sandbox revert/advance in the banner
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push(entry);
    if (entry.kind === "assignment") {
      await Promise.all(entry.ops.map((op) => applyAssignment(op.staffId, op.date, op.next)));
    } else if (entry.kind === "request-create") {
      await restoreRequestsForUndo(entry.snapshots); // redo a create = restore them (same ids)
    } else if (entry.kind === "request-delete") {
      await deleteRequestsForUndo(entry.snapshots); // redo a delete = delete again
    } else if (entry.kind === "request-status") {
      setLocalRequests((prev) => prev.map((r) => (r.id === entry.item.id ? { ...r, status: entry.item.to } : r)));
      const { ok } = await patchRequestStatus(entry.item.id, entry.item.to);
      if (!ok) setRequestError("The request approval could not be re-applied during redo.");
    }
  }

  const undoRef = useRef(handleUndo);
  const redoRef = useRef(handleRedo);
  const clearRef = useRef<(target?: { staffId: string; date: string }) => Promise<void>>(async () => {});
  useEffect(() => { undoRef.current = handleUndo; }, [handleUndo]);
  useEffect(() => { redoRef.current = handleRedo; }, [handleRedo]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Keyboard editing IS the primary single-cell path (type a shift code on the
      // active cell, Tab→picker, Delete→clear), so it must work in Live. The edit
      // actions route through the Live-aware funnels (hotkeyAssign/handleClear/the
      // picker); request-mutating keys are blocked separately below.
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
      // While a modal is open, grid hotkeys (letters, "/", "?", arrows, etc.)
      // are suppressed; each modal closes itself on Escape via useEscape.
      if (showVersions || showAlerts || showHelp) return;
      if (canEdit && (e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (liveModeRef.current) liveUndoFnRef.current(); else undoRef.current();
      }
      if (canEdit && (e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        if (liveModeRef.current) liveRedoFnRef.current(); else redoRef.current();
      }
      // "/" toggles request mode. Works whether or not the picker is open
      // (when open, it flips the picker's Assign/Request tab via the shared
      // requestMode state). Input/SELECT/month-picker targets already returned
      // above, so this never fires while typing or in the month menu.
      if (e.key === "/" && canEdit && !liveModeRef.current) {
        e.preventDefault();
        // Entering request mode forces the request overlay on; exiting leaves it
        // as-is (it stays visible until the user hides it via RQ / "?").
        if (!requestMode) setShowRequests(true);
        setRequestMode((m) => !m);
        return;
      }
      // "?" (Shift+/) shows/hides the request overlay — mirrors the "RQ"
      // toolbar button. Distinct key from "/" (request mode), so no collision;
      // not gated on canEdit since it only changes what's displayed.
      if (e.key === "?") {
        e.preventDefault();
        toggleShowRequests();
        return;
      }
      // Request mode only: "+" approves / "!" denies every pending request on
      // the active cell / selection. Both already require Shift on the key
      // (Shift+= / Shift+1) — match the produced char. Never fires in normal
      // mode, so a stray + can't approve.
      if (requestMode && !liveModeRef.current && !picker && canEdit && !activeDedCol && (activeRow || selection.size > 0) && !e.metaKey && !e.ctrlKey && (e.key === "+" || e.key === "!")) {
        e.preventDefault();
        requestApproveRef.current(e.key === "+" ? "approved" : "declined");
        return;
      }
      if (e.key === "Escape" && !picker) {
        // Precedence: exit request mode first; only clear the selection/active
        // cell once we're back in normal mode.
        if (requestMode) {
          setRequestMode(false);
        } else {
          setSelection(new Set());
          setSelectionAnchor(null);
          setActiveRow(null);
          setActiveCol(null);
          setActiveDedCol(null);
          setDedSelection(null);
          dedAnchorRef.current = null;
        }
      }
      if (e.key === "Tab" && !picker && canEdit && activeRow && activeCol) {
        e.preventDefault();
        const existing = assignmentMap.get(`${activeCol}:${activeRow}`);
        // Locked cells still open the picker in request mode (requests are
        // independent of the assignment lock); blocked only in assign mode.
        if (!existing?.isLocked || requestMode) {
          if (selection.size === 0) {
            setSelectionAnchor({ staffId: activeCol, date: activeRow });
          }
          const pos = pickerPositionForCell(activeCol, activeRow);
          setPicker({ staffId: activeCol, date: activeRow, ...pos });
        }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !picker && canEdit && activeRow && activeCol) {
        e.preventDefault();
        if (requestMode && !liveModeRef.current) {
          // Request mode: delete requests on the active cell / selection
          // (assignments are left untouched).
          requestDeleteRef.current();
        } else if (selection.size > 0) {
          clearRef.current();
        } else {
          clearRef.current({ staffId: activeCol, date: activeRow });
        }
      }
      // Dedicated cell (ICU/CARD) active: Delete clears its roster; Enter/F2 opens the
      // inline editor (keyboard parity — dedicated columns have no picker). Both are
      // request-mode gated inside the helpers (never mutate assignments in request mode).
      if (!picker && canEdit && !liveModeRef.current && activeDedCol && activeRow) {
        // Dedicated-column (ICU/CARD) what-if is out of scope for Live; its writes
        // go through the gated handleDedicatedEntry anyway, but skip the keyboard
        // affordances so Live doesn't open a no-op editor.
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          clearDedRoster(activeDedCol, activeRow);
        } else if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          openDedEditor(activeDedCol, activeRow);
        }
      }
      // Arrow navigation spans staff AND dedicated columns as one ordered list
      // (staff first, then dedicated). Crossing the boundary swaps the active column
      // kind and clears the other kind's selection (no stale range left behind).
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && !picker && activeRow && (activeCol || activeDedCol)) {
        e.preventDefault();
        const dateIdx = dates.indexOf(activeRow);
        if (dateIdx === -1) return;
        const nStaff = visibleStaff.length;
        const totalCols = nStaff + dedicatedColumns.length;
        const colIdx = activeCol
          ? visibleStaff.findIndex((p) => p.id === activeCol)
          : nStaff + dedicatedColumns.findIndex((st) => st.id === activeDedCol);
        if (colIdx < 0) return;
        let newDateIdx = dateIdx;
        let newColIdx = colIdx;
        if (e.key === "ArrowUp") newDateIdx = Math.max(0, dateIdx - 1);
        if (e.key === "ArrowDown") newDateIdx = Math.min(dates.length - 1, dateIdx + 1);
        if (e.key === "ArrowLeft") newColIdx = Math.max(0, colIdx - 1);
        if (e.key === "ArrowRight") newColIdx = Math.min(totalCols - 1, colIdx + 1);
        const newDate = dates[newDateIdx];
        setActiveRow(newDate);
        if (newColIdx < nStaff) {
          // Landing on a staff column: clear any dedicated selection/anchor.
          const newProv = visibleStaff[newColIdx];
          setActiveCol(newProv.id);
          setActiveDedCol(null);
          setDedSelection(null);
          dedAnchorRef.current = null;
          document.querySelector(`[data-cell="${newProv.id}:${newDate}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
        } else {
          // Landing on a dedicated column: clear staff selection/anchor.
          const st = dedicatedColumns[newColIdx - nStaff];
          setActiveDedCol(st.id);
          setActiveCol(null);
          setSelection(new Set());
          setSelectionAnchor(null);
          setDedSelection(null);
          dedAnchorRef.current = null;
          document.querySelector(`[data-cell="ded-${st.id}:${newDate}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      }
      // Hotkey letter entry. Bare letter -> assign (unchanged). In request mode
      // letter -> request, with Shift=avoid and Alt=soft. Resolve the letter
      // from KeyboardEvent.code when a modifier is held, since macOS Option
      // mangles e.key into a non-letter / dead key.
      if (!picker && canEdit && !activeDedCol && !e.metaKey && !e.ctrlKey && (activeRow || selection.size > 0)) {
        const usingMods = e.shiftKey || e.altKey;
        let letter: string | null = null;
        if (usingMods && /^Key[A-Z]$/.test(e.code)) letter = e.code.slice(3);
        else if (e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) letter = e.key.toUpperCase();
        const st = letter ? hotkeyMap.get(letter) : undefined;
        if (st) {
          if (requestMode && !liveModeRef.current) {
            e.preventDefault();
            requestKeyRef.current(st, { avoid: e.shiftKey, soft: e.altKey });
          } else if (!e.altKey) {
            // Assign mode: Alt is reserved for request soft-strength, so it
            // never assigns; bare (or Shift) letter assigns as before.
            e.preventDefault();
            hotkeyAssignRef.current(st);
          }
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [picker, canEdit, activeRow, activeCol, activeDedCol, assignmentMap, dates, visibleStaff, dedicatedColumns, dedicatedColumnInitialsData, staff, shiftTypeMap, hotkeyMap, selection, showMonthPicker, requestMode, toggleShowRequests, showVersions, showAlerts, showHelp]);

  // Copy the selected cells (or the active cell) to the clipboard as TSV so they paste
  // into Excel/Sheets matching the grid (dates rows, staff cols), values only. Read-only
  // — no canEdit gate. Mirrors the keydown guards (inputs/modals/picker) and yields to
  // the browser when the user has selected real page text and there's no grid selection.
  useEffect(() => {
    function onCopy(e: ClipboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (showMonthPicker || showVersions || showAlerts || showHelp || picker) return;

      // Dedicated-column copy (ICU/CARD): a multi-date dedSelection range, OR the single
      // active dedicated cell (parity with a staff active-cell copy). Initials come from
      // PERSISTED assignments only (never suggestions), matching the editor's roster
      // source — so a copy→paste can't promote a suggestion.
      const dedRange = dedSelection && dedSelection.dates.length > 0;
      const dedCopyId = dedRange ? dedSelection!.shiftTypeId : (activeDedCol && activeRow ? activeDedCol : null);
      const dedCopyDates = dedRange ? dedSelection!.dates : (activeDedCol && activeRow ? [activeRow] : null);
      if (dedCopyId && dedCopyDates) {
        const dedSt = shiftTypeMap.get(dedCopyId);
        if (!dedSt) return;
        // Single active cell (no range): defer to a real page-text selection so we never
        // hijack the user copying text (mirrors the staff active-cell rule).
        if (!dedRange && window.getSelection()?.toString().trim()) return;
        const tsv = dedicatedSelectionTsv(dedCopyDates, (date) => {
          const out: string[] = [];
          for (const p of staff) {
            if (assignmentMap.get(`${p.id}:${date}`)?.code === dedSt.code) out.push(p.initials);
          }
          return out;
        });
        if (tsv == null) return;
        e.clipboardData?.setData("text/plain", tsv);
        e.preventDefault();
        return;
      }

      // An explicit multi-cell grid selection is a strong intent signal and wins over
      // any stray DOM selection. With only an active cell, defer to a real text
      // selection so we never hijack the user copying page text.
      let keys: string[];
      if (selection.size > 0) {
        keys = [...selection];
      } else if (activeRow && activeCol) {
        if (window.getSelection()?.toString().trim()) return; // user is copying text
        keys = [`${activeCol}:${activeRow}`];
      } else {
        return;
      }

      const tsv = selectionToTsv(keys, {
        dateOrder: dates,
        staffOrder: visibleStaff.map((p) => p.id),
        codeAt: (staffId, date) => assignmentMap.get(`${staffId}:${date}`)?.code,
      });
      if (tsv == null) return;
      e.clipboardData?.setData("text/plain", tsv);
      e.preventDefault();
    }
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [selection, activeRow, activeCol, activeDedCol, assignmentMap, dates, visibleStaff, showMonthPicker, showVersions, showAlerts, showHelp, picker, dedSelection, shiftTypeMap, staff]);

  // Paste a clipboard block (from Excel/Sheets or our own copy) positionally from the
  // active cell, filling down and right. Same guards as keydown/copy. Gated to assignment
  // mode — in request mode it no-ops with a hint (it must never silently create firm
  // assignments). Writes atomically via /api/assignments/paste, pushes ONE undo group for
  // everything that persisted, and reverts cleanly if the (all-or-nothing) write fails.
  useEffect(() => {
    // Dedicated-column (ICU/CARD) paste: set each day's roster from a column of initials.
    // Row-level all-or-nothing client-side; the server re-enforces per-date lock/conflict
    // skips authoritatively. One transaction, one undo group, optimistic + full revert.
    async function runDedicatedPaste(block: string[][], sel: { shiftTypeId: string; dates: string[] }) {
      const dedSt = shiftTypeMap.get(sel.shiftTypeId);
      if (!dedSt) return;
      const anchorIdx = dates.indexOf(sel.dates[0]);
      if (anchorIdx < 0) return;

      const resolution = resolveDedicatedPaste(block, anchorIdx, {
        dateOrder: dates,
        shiftCode: dedSt.code,
        resolveInitials: (raw) => {
          const { resolved, unknown } = resolveInitials(raw, staff);
          return { resolvedIds: resolved.map((r) => r.id), unknownCount: unknown.length };
        },
        rosterAt: (date) => staff.filter((p) => assignmentMap.get(`${p.id}:${date}`)?.code === dedSt.code).map((p) => p.id),
        shiftCodeOf: (staffId, date) => assignmentMap.get(`${staffId}:${date}`)?.code ?? null,
        isLocked: (staffId, date) => !!assignmentMap.get(`${staffId}:${date}`)?.isLocked,
      });

      const { groups } = resolution;
      if (groups.length === 0) {
        setPasteToast(dedicatedPasteSummary(dedSt.code, 0, 0, resolution));
        return;
      }

      const involvedKeys = new Set<string>();
      for (const g of groups) for (const id of [...g.addStaffIds, ...g.removeStaffIds]) involvedKeys.add(`${id}:${g.date}`);
      const prevByKey = new Map<string, AssignmentData | null>();
      for (const k of involvedKeys) prevByKey.set(k, assignmentMap.get(k) ?? null);

      // Optimistic: drop involved cells, then add the adds (removes stay dropped).
      setLocalAssignments((prev) => {
        const next = prev.filter((a) => !involvedKeys.has(`${a.staffId}:${a.date}`));
        for (const g of groups) {
          for (const id of g.addStaffIds) {
            next.push({ id: `temp-${id}:${g.date}`, staffId: id, date: g.date, shiftTypeId: dedSt.id, isLocked: false, code: dedSt.code, color: dedSt.color });
          }
        }
        return next;
      });
      setSaving("paste");

      try {
        const res = await fetch("/api/assignments/roster-paste", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shiftTypeId: dedSt.id, groups }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { applied, cleared, skippedGroups, requestChanges } = (await res.json()) as {
          applied: AssignmentData[]; cleared: { staffId: string; date: string }[]; skippedGroups: { date: string; reason: string }[]; requestChanges?: AffectedDelta["requests"];
        };
        const appliedKeys = new Set(applied.map((a) => `${a.staffId}:${a.date}`));
        const clearedKeys = new Set(cleared.map((c) => `${c.staffId}:${c.date}`));

        // Reconcile to exactly what the server persisted; restore prior for any involved
        // cell in a server-skipped group (neither applied nor cleared).
        setLocalAssignments((prev) => {
          const next = prev.filter((a) => !involvedKeys.has(`${a.staffId}:${a.date}`)).concat(applied);
          for (const k of involvedKeys) {
            if (!appliedKeys.has(k) && !clearedKeys.has(k)) {
              const prior = prevByKey.get(k);
              if (prior) next.push(prior);
            }
          }
          return next;
        });

        // ONE undo group: applied (prev→next) + cleared (prev→null).
        const undoOps: UndoOp[] = [];
        for (const a of applied) undoOps.push({ staffId: a.staffId, date: a.date, prev: prevByKey.get(`${a.staffId}:${a.date}`) ?? null, next: a });
        for (const c of cleared) undoOps.push({ staffId: c.staffId, date: c.date, prev: prevByKey.get(`${c.staffId}:${c.date}`) ?? null, next: null });
        if (undoOps.length) pushUndo(undoOps);
        applyRequestDelta({ requests: requestChanges });

        const serverLocked = skippedGroups.filter((s) => s.reason === "locked").length;
        const serverConflict = skippedGroups.filter((s) => s.reason === "conflict").length;
        setPasteToast(dedicatedPasteSummary(dedSt.code, applied.length, cleared.length, {
          unknown: resolution.unknown,
          conflict: resolution.conflict + serverConflict,
          locked: resolution.locked + serverLocked,
          clipped: resolution.clipped,
        }));
      } catch {
        setLocalAssignments((prev) => {
          const next = prev.filter((a) => !involvedKeys.has(`${a.staffId}:${a.date}`));
          for (const prior of prevByKey.values()) if (prior) next.push(prior);
          return next;
        });
        setRequestError("Paste failed — no changes were made.");
      } finally {
        setSaving(null);
      }
    }

    async function onPaste(e: ClipboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (showMonthPicker || showVersions || showAlerts || showHelp || picker) return;
      if (!canEdit) return;

      const block = parseClipboardGrid(e.clipboardData?.getData("text/plain") ?? "");
      if (block.length === 0) return;

      // Dedicated-column (ICU/CARD) paste takes precedence — isolated path + endpoint.
      // Anchor at the dedSelection range OR, with parity to staff paste, the single
      // active dedicated cell (fills DOWN from there). This is what lets the user click
      // one ICU/CARD cell and paste a whole column of initials — previously a click
      // opened the text <input> and the whole block landed in one cell.
      const dedPasteSel = dedSelection && dedSelection.dates.length > 0
        ? dedSelection
        : (activeDedCol && activeRow ? { shiftTypeId: activeDedCol, dates: [activeRow] } : null);
      if (dedPasteSel) {
        e.preventDefault();
        if (liveModeRef.current) {
          // Dedicated-column (ICU/CARD) what-if is out of scope for Live.
          setPasteToast("Dedicated-column paste isn't available in Live.");
          return;
        }
        if (requestMode) {
          setPasteToast("Paste sets assignments — exit request mode (press /) first.");
          return;
        }
        if (pasteBusyRef.current) return; // ignore a paste while one is committing
        pasteBusyRef.current = true;
        try {
          await runDedicatedPaste(block, dedPasteSel);
        } finally {
          pasteBusyRef.current = false;
        }
        return;
      }

      if (!activeRow || !activeCol) return; // staff paste needs an anchor cell
      e.preventDefault(); // we own this paste

      if (requestMode) {
        setPasteToast("Paste sets assignments — exit request mode (press /) first.");
        return;
      }
      if (pasteBusyRef.current) return; // ignore a paste while one is committing

      const dateIndex = dates.indexOf(activeRow);
      const staffIndex = visibleStaff.findIndex((p) => p.id === activeCol);
      if (dateIndex < 0 || staffIndex < 0) return;

      const resolution = resolvePaste(block, { dateIndex, staffIndex }, {
        dateOrder: dates,
        staffOrder: visibleStaff.map((p) => p.id),
        codeToId,
        isLocked: (staffId, date) => !!assignmentMap.get(`${staffId}:${date}`)?.isLocked,
      });
      const { sets } = resolution;
      if (sets.length === 0) {
        setPasteToast(pasteSummary(0, resolution));
        return;
      }

      // Live mode: route the pasted block through the what-if engine as batch pins
      // (it ripples like any other edit) instead of persisting.
      if (liveModeRef.current) {
        const ok = liveEditRef.current(sets.map((s) => ({ staffId: s.staffId, date: s.date, shiftTypeId: s.shiftTypeId })), []);
        setPasteToast(ok ? pasteSummary(sets.length, resolution) : "Paste not applied — see the Live banner.");
        return;
      }

      // Prior state per target cell — drives both the undo group and failure revert.
      const prevByKey = new Map<string, AssignmentData | null>();
      for (const s of sets) prevByKey.set(`${s.staffId}:${s.date}`, assignmentMap.get(`${s.staffId}:${s.date}`) ?? null);
      const sentKeys = new Set(sets.map((s) => `${s.staffId}:${s.date}`));

      // Optimistic temps.
      setLocalAssignments((prev) => {
        const filtered = prev.filter((a) => !sentKeys.has(`${a.staffId}:${a.date}`));
        const temps = sets.map((s) => {
          const st = shiftTypeMap.get(s.shiftTypeId);
          return { id: `temp-${s.staffId}:${s.date}`, staffId: s.staffId, date: s.date, shiftTypeId: s.shiftTypeId, isLocked: false, code: st?.code ?? "?", color: st?.color ?? "#6b7280" };
        });
        return [...filtered, ...temps];
      });
      pasteBusyRef.current = true;
      setSaving("paste");

      try {
        const res = await fetch("/api/assignments/paste", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells: sets }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { applied, skippedLocked = 0, requestChanges } = (await res.json()) as { applied: AssignmentData[]; skippedLocked?: number; requestChanges?: AffectedDelta["requests"] };
        const appliedKeys = new Set(applied.map((a) => `${a.staffId}:${a.date}`));

        // Reconcile to exactly what the server persisted: drop temps, add authoritative
        // rows, and restore the prior value of any cell the server skipped (its lock).
        setLocalAssignments((prev) => {
          const next = prev.filter((a) => !sentKeys.has(`${a.staffId}:${a.date}`)).concat(applied);
          for (const s of sets) {
            const k = `${s.staffId}:${s.date}`;
            if (!appliedKeys.has(k)) {
              const prior = prevByKey.get(k);
              if (prior) next.push(prior);
            }
          }
          return next;
        });

        // One undo group covering everything that actually persisted.
        const undoOps: UndoOp[] = applied.map((a) => ({ staffId: a.staffId, date: a.date, prev: prevByKey.get(`${a.staffId}:${a.date}`) ?? null, next: a }));
        if (undoOps.length) pushUndo(undoOps);
        applyRequestDelta({ requests: requestChanges });

        setPasteToast(pasteSummary(applied.length, resolution, skippedLocked));
      } catch {
        // Atomic write → nothing persisted. Revert the optimistic temps to prior state.
        setLocalAssignments((prev) => {
          const next = prev.filter((a) => !sentKeys.has(`${a.staffId}:${a.date}`));
          for (const prior of prevByKey.values()) if (prior) next.push(prior);
          return next;
        });
        setRequestError("Paste failed — no changes were made.");
      } finally {
        setSaving(null);
        pasteBusyRef.current = false;
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canEdit, requestMode, activeRow, activeCol, activeDedCol, dates, visibleStaff, staff, assignmentMap, codeToId, shiftTypeMap, dedSelection, showMonthPicker, showVersions, showAlerts, showHelp, picker]);

  // Auto-dismiss the paste summary toast.
  useEffect(() => {
    if (!pasteToast) return;
    const id = setTimeout(() => setPasteToast(null), 6000);
    return () => clearTimeout(id);
  }, [pasteToast]);

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

    // Live mode: route the keyboard shift-code entry through the what-if engine.
    if (liveMode) {
      setPicker(null);
      setSelection(new Set());
      setSelectionAnchor(null);
      liveEdit(cells.map((c) => ({ staffId: c.staffId, date: c.date, shiftTypeId: st.id })), []);
      return;
    }

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
        const { applied, requestChanges } = await res.json() as { applied: AssignmentData[]; requestChanges?: AffectedDelta["requests"] };
        setLocalAssignments((prev) => {
          const savedKeys = new Set(applied.map((s) => `${s.staffId}:${s.date}`));
          return [...prev.filter((a) => !savedKeys.has(`${a.staffId}:${a.date}`)), ...applied];
        });
        applyRequestDelta({ requests: requestChanges });
      }
    } catch { /* optimistic stays */ }
    setSaving(null);
  }, [selection, activeCol, activeRow, assignmentMap, liveMode, liveEdit]);

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

    // Live mode: route the pick through the what-if engine instead of persisting.
    if (liveMode) {
      setPicker(null);
      setSelection(new Set());
      setSelectionAnchor(null);
      liveEdit(cells.map((c) => ({ staffId: c.staffId, date: c.date, shiftTypeId })), []);
      return;
    }

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
        const { requestChanges, ...saved } = await res.json();
        setLocalAssignments((prev) =>
          prev.map((a) => (a.staffId === staffId && a.date === date ? saved : a)),
        );
        applyRequestDelta({ requests: requestChanges });
      } else {
        const res = await fetch("/api/assignments/bulk", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells, shiftTypeId }),
        });
        const { applied: saved, requestChanges }: { applied: AssignmentData[]; requestChanges?: AffectedDelta["requests"] } = await res.json();
        setLocalAssignments((prev) => {
          const keys = new Set(saved.map((s) => `${s.staffId}:${s.date}`));
          const filtered = prev.filter((a) => !keys.has(`${a.staffId}:${a.date}`));
          return [...filtered, ...saved];
        });
        applyRequestDelta({ requests: requestChanges });
      }
    } catch {
      // Revert temps on failure
      setLocalAssignments((prev) => prev.filter((a) => !a.id.startsWith("temp-")));
    } finally {
      setSaving(null);
    }
  }, [picker, shiftTypeMap, assignmentMap, selection, liveMode, liveEdit]);

  const handleClear = useCallback(async (target?: { staffId: string; date: string }) => {
    const anchor = target ?? (picker ? { staffId: picker.staffId, date: picker.date } : null);
    if (!anchor && selection.size === 0) return;

    // Live mode: clearing a cell FREES it (the engine re-solves the hole) — never
    // a DB delete. Frees route through the what-if engine like every other edit.
    if (liveMode) {
      const frees: ScenarioFree[] = [];
      if (!target && selection.size > 0) {
        for (const key of selection) { const [pid, d] = key.split(":"); frees.push({ staffId: pid, date: d }); }
      } else if (anchor) {
        frees.push(anchor);
      }
      setPicker(null);
      setSelection(new Set());
      setSelectionAnchor(null);
      if (frees.length > 0) liveEdit([], frees);
      return;
    }

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
        const res = await fetch("/api/assignments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cells[0]),
        });
        const data = await res.json().catch(() => null);
        applyRequestDelta({ requests: data?.requestChanges });
      } else {
        const res = await fetch("/api/assignments/bulk", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells }),
        });
        const data = await res.json().catch(() => null);
        applyRequestDelta({ requests: data?.requestChanges });
      }
    } catch {
      window.location.reload();
    } finally {
      setSaving(null);
    }
  }, [picker, assignmentMap, selection, liveMode, liveEdit]);
  useEffect(() => { clearRef.current = handleClear; }, [handleClear]);

  const closePicker = useCallback(() => {
    setPicker(null);
  }, []);

  // Request mode: turn picker marks into pending requests for the selected cells.
  // Lower-level save: turn marks + an explicit cell list into request rows and
  // POST them, with optimistic insert and a partial-failure message. Shared by
  // the picker (handleSaveRequests) and the keyboard request path
  // (handleRequestKey) so neither has to fake picker state.
  const saveRequestMarksForCells = useCallback(
    async (cells: { staffId: string; date: string }[], marks: PickerMarks) => {
      const payloads = buildRequestPayloads(marks, groupCellsIntoTargets(cells));
      if (payloads.length === 0) return;

      setSaving("requests");
      setRequestError(null);
      const created: RequestSnapshot[] = [];
      let failed = 0;
      try {
        for (const p of payloads) {
          try {
            const res = await fetch("/api/requests", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(p),
            });
            if (res.ok) created.push(await res.json() as RequestSnapshot);
            else failed++;
          } catch {
            failed++;
          }
        }
      } finally {
        // Show whatever did persist, then surface any failures so a partial
        // save is never silent.
        if (created.length > 0) {
          setLocalRequests((prev) => [...created, ...prev]);
          // One undoable entry for the batch: Cmd-Z deletes the created
          // requests; redo restores them under the same ids via /restore.
          pushUndoEntry({ kind: "request-create", snapshots: created });
        }
        if (failed > 0) {
          setRequestError(
            `${failed} of ${payloads.length} request${payloads.length > 1 ? "s" : ""} failed to save${created.length > 0 ? ` (${created.length} saved)` : ""}.`,
          );
        }
        setSaving(null);
      }
    },
    [],
  );

  const handleSaveRequests = useCallback(
    async (marks: PickerMarks) => {
      if (liveMode) return; // requests are not part of the Live what-if sandbox
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
      setPicker(null);
      setSelection(new Set());
      setSelectionAnchor(null);
      await saveRequestMarksForCells(cells, marks);
    },
    [picker, selection, saveRequestMarksForCells, liveMode],
  );

  // Keyboard request entry (request mode): apply one keystroke's intent to the
  // selection or active cell. Requests coexist with assignments, so locked
  // cells are NOT skipped (a lock pins an assignment, not the right to request).
  const handleRequestKey = useCallback(
    (st: ShiftType, mods: { avoid: boolean; soft: boolean }) => {
      const cells: { staffId: string; date: string }[] = [];
      if (selection.size > 0) {
        for (const key of selection) {
          const [pid, d] = key.split(":");
          cells.push({ staffId: pid, date: d });
        }
      } else if (activeCol && activeRow) {
        cells.push({ staffId: activeCol, date: activeRow });
      }
      if (cells.length === 0) return;
      const marks = keysToRequestIntent(
        { id: st.id, category: st.category, isOffShift: st.isOffShift },
        mods,
      );
      if (!marks) return;
      setSelection(new Set());
      setSelectionAnchor(null);
      void saveRequestMarksForCells(cells, marks);
    },
    [selection, activeCol, activeRow, saveRequestMarksForCells],
  );
  const requestKeyRef = useRef(handleRequestKey);
  useEffect(() => { requestKeyRef.current = handleRequestKey; }, [handleRequestKey]);

  // Request-mode Delete: remove every request overlapping the active cell /
  // selection (a request overlaps when its staff matches and its date range
  // covers the cell's date). Whole-request delete (a ranged request is removed
  // entirely), undoable via a request-delete entry that restores verbatim.
  const handleRequestDelete = useCallback(() => {
    const cells: { staffId: string; date: string }[] = [];
    if (selection.size > 0) {
      for (const key of selection) { const [pid, d] = key.split(":"); cells.push({ staffId: pid, date: d }); }
    } else if (activeCol && activeRow) {
      cells.push({ staffId: activeCol, date: activeRow });
    }
    if (cells.length === 0) return;
    const visibleStatuses = REQUEST_FILTER_STATUSES[requestFilter];
    const snapshots: RequestSnapshot[] = localRequests
      // Only the requests the grid actually RENDERS on a cell under the active RQ
      // filter — so a visible denied request is deletable, while records the filter
      // hides (and the always-hidden withdrawn/fulfilled) are never silently removed.
      .filter((r) => visibleStatuses.includes(r.status)
        && cells.some((c) => c.staffId === r.staffId && r.startDate <= c.date && c.date <= r.endDate))
      .map((r) => ({
        id: r.id, staffId: r.staffId, startDate: r.startDate, endDate: r.endDate,
        kind: r.kind, shiftTypeIds: r.shiftTypeIds, leaveShiftTypeId: r.leaveShiftTypeId,
        strength: r.strength, status: r.status, source: r.source, notes: r.notes, receivedAt: r.receivedAt,
      }));
    if (snapshots.length === 0) return;
    pushUndoEntry({ kind: "request-delete", snapshots });
    void deleteRequestsForUndo(snapshots); // optimistic remove + DELETE
  }, [selection, activeCol, activeRow, localRequests, requestFilter, liveMode]);
  const requestDeleteRef = useRef(handleRequestDelete);
  useEffect(() => { requestDeleteRef.current = handleRequestDelete; }, [handleRequestDelete]);

  // Request-mode + / ! : approve / deny every PENDING request overlapping the
  // active cell / selection. The decision is made against a PRE-BATCH snapshot
  // (only requests pending right now) so co-approval triggered by an earlier
  // PATCH can't make it order-dependent. Approving a single-shift request also
  // places that shift (server-side; mirrored locally), skipping requests whose
  // covered days are locked-and-unsatisfied (which the server would 409).
  const handleRequestApproveDeny = useCallback(async (target: "approved" | "declined") => {
    const cells: { staffId: string; date: string }[] = [];
    if (selection.size > 0) {
      for (const key of selection) { const [pid, d] = key.split(":"); cells.push({ staffId: pid, date: d }); }
    } else if (activeCol && activeRow) {
      cells.push({ staffId: activeCol, date: activeRow });
    }
    if (cells.length === 0) return;

    // PRE-BATCH snapshot: only requests pending RIGHT NOW (so co-approval from an
    // earlier PATCH in this batch can't make the decision order-dependent).
    const explicit = localRequests
      .filter((r) => r.status === "pending" && cells.some((c) => c.staffId === r.staffId && r.startDate <= c.date && c.date <= r.endDate))
      .map((r) => r.id);
    if (explicit.length === 0) return;

    // Capture every request's status BEFORE the batch so we can record the FULL
    // set that changes — explicit approvals/denials AND any co-approved/reverted
    // neighbours — so undo reverts the whole cascade, not just the keys pressed.
    const preStatus = new Map(localRequests.map((r) => [r.id, r.status]));
    const postStatus = new Map(preStatus);

    setLocalRequests((prev) => prev.map((r) => (explicit.includes(r.id) ? { ...r, status: target } : r)));
    let failed = 0, locked = 0;
    for (const id of explicit) {
      const { ok, httpStatus, affected } = await patchRequestStatus(id, target);
      if (ok) {
        postStatus.set(id, target);
        for (const ar of affected?.requests ?? []) postStatus.set(ar.id, ar.status); // co-approved neighbours
      } else {
        failed++;
        if (httpStatus === 409) locked++; // a covered day is locked-and-unsatisfied
        setLocalRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: "pending" } : r))); // revert
      }
    }

    // Record undo based on blast radius: a change confined to ONE request is
    // safely reversible by a single PATCH; anything that also moved other
    // requests (a co-approval cascade, or a multi-cell batch) can't be undone
    // by sequential PATCHes without racing the auto-approve sync — push a
    // non-undoable marker so Cmd-Z warns rather than corrupting state.
    const changed = [...postStatus.entries()]
      .filter(([id, st]) => preStatus.get(id) !== st)
      .map(([id, st]) => ({ id, from: preStatus.get(id) ?? ("pending" as RequestStatus), to: st }));
    if (changed.length === 1) pushUndoEntry({ kind: "request-status", item: changed[0] });
    else if (changed.length > 1) pushUndoEntry({ kind: "request-status-blocked" });
    if (failed > 0) {
      const verb = target === "approved" ? "approved" : "denied";
      setRequestError(`${failed} request(s) couldn't be ${verb}${locked > 0 ? ` (${locked} locked)` : ""}.`);
    }
  }, [selection, activeCol, activeRow, localRequests]);
  const requestApproveRef = useRef(handleRequestApproveDeny);
  useEffect(() => { requestApproveRef.current = handleRequestApproveDeny; }, [handleRequestApproveDeny]);

  // Delete an existing request (the × in the picker's request list).
  const handleDeleteRequest = useCallback(async (id: string) => {
    if (liveMode) return; // requests are not part of the Live what-if sandbox
    setLocalRequests((prev) => prev.filter((r) => r.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/requests/${id}`, { method: "DELETE" });
      if (!res.ok) setRequestError("Failed to delete request.");
    } catch {
      setRequestError("Failed to delete request.");
    }
  }, [liveMode]);

  function handleDragStart(staffId: string, date: string, e: React.DragEvent) {
    if (!canEdit) { e.preventDefault(); return; }
    // In Live the draggable content is the live-grid cell, not the saved one.
    const a = liveMode ? liveDisplayMap.get(`${staffId}:${date}`) : assignmentMap.get(`${staffId}:${date}`);
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

    // Live mode: drag DISPLACES (it doesn't swap). Pin the dragged cell's shift at
    // the target and FREE the source; the engine re-solves — bumping any occupant
    // of the target and backfilling the freed source as coverage requires (#231).
    if (liveMode) {
      const from = dragSource;
      setDragSource(null);
      if (!from) return;
      if (from.staffId === toStaffId && from.date === toDate) return;
      const fromCell = liveDisplayMap.get(`${from.staffId}:${from.date}`);
      if (!fromCell) return;
      liveEdit(
        [{ staffId: toStaffId, date: toDate, shiftTypeId: fromCell.shiftTypeId }],
        [{ staffId: from.staffId, date: from.date }],
      );
      return;
    }

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
      applyRequestDelta({ requests: result.requestChanges });
    } catch {
      window.location.reload();
    } finally {
      setSaving(null);
    }
  }, [dragSource, assignmentMap, liveMode, liveDisplayMap, liveEdit]);

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

  // Selection count for picker header
  const selectionCount = selection.size;

  async function enterLive() {
    if (!dates.length) return;
    setLiveLoading(true);
    try {
      const res = await fetch(`/api/auto-schedule/inputs?start=${dates[0]}&end=${dates[dates.length - 1]}`);
      if (!res.ok) {
        console.error("Live: failed to load engine inputs", res.status);
        return;
      }
      const bundle: AutoScheduleInput = await res.json();
      // Snapshot the SAVED DB grid (pre-overlay) — the Accept diff baseline, so the
      // engine's enter-time fills of empty slots are committed on Accept (WYSIWYG).
      const saved = new Map<string, string>();
      for (const a of bundle.existingAssignments) saved.set(`${a.staffId}:${a.date}`, a.shiftTypeId);
      liveSavedGridRef.current = saved;
      // The sandbox operates directly on the saved DB grid (no preview overlay).
      const liveInput = bundle;
      liveInputRef.current = liveInput;
      livePinsRef.current = new Map();
      liveTouchedRef.current = new Set();
      liveUndoStack.current = [];
      liveRedoStack.current = [];

      // No-op re-solve: with the whole baseline locked and nothing pinned/freed,
      // the engine reproduces the current grid (a complete schedule ⇒ 0 ripple).
      const outcome = applyScenario(liveInput, [], []);
      // Snapshot the enter-time grid (incl. any engine fills of empty cells) as the
      // Accept baseline — only later, user-driven divergence from this gets saved.
      const initial = new Map<string, string>();
      for (const c of outcome.grid) initial.set(`${c.staffId}:${c.date}`, c.shiftTypeId);
      liveInitialGridRef.current = initial;
      // Re-solve base = the complete enter-time grid, with true lock flags carried
      // from the bundle (engine-filled cells are unlocked/discretionary).
      const lockedKeys = new Set<string>();
      for (const a of liveInput.existingAssignments) if (a.isLocked) lockedKeys.add(`${a.staffId}:${a.date}`);
      liveBaseInputRef.current = {
        ...liveInput,
        existingAssignments: outcome.grid.map((c) => ({
          staffId: c.staffId,
          date: c.date,
          shiftTypeId: c.shiftTypeId,
          code: c.code,
          isLocked: lockedKeys.has(`${c.staffId}:${c.date}`),
        })),
      };
      setLiveReject([]);
      setRequestMode(false); // Live is assign-only; requests aren't part of the sandbox
      setLiveOutcome(outcome);
      setLiveMode(true);
    } catch (e) {
      console.error("Live: enter failed", e);
    } finally {
      setLiveLoading(false);
    }
  }

  function cancelLive() {
    setLiveMode(false);
    setLiveOutcome(null);
    setLiveReject([]);
    liveInputRef.current = null;
    liveBaseInputRef.current = null;
    liveInitialGridRef.current = new Map();
    liveSavedGridRef.current = new Map();
    livePinsRef.current = new Map();
    liveTouchedRef.current = new Set();
    liveUndoStack.current = [];
    liveRedoStack.current = [];
  }

  async function acceptLive() {
    const outcome = liveOutcome;
    if (!outcome) { cancelLive(); return; }
    // WYSIWYG persist: commit every cell that differs from the SAVED DB grid — the
    // engine's enter-time fills of empty slots, the user's edits, and the ripple
    // alike (all of it is on screen). Diffing against the saved grid (NOT the
    // enter-time snapshot) is what stops the auto-fills from being silently dropped.
    // Every committed cell is tagged source:"auto" + autoMonth server-side, so Clear
    // Auto wipes the whole generated schedule back to its pre-generate state.
    const toApply = cellsToCommitOnAccept(outcome.grid, liveSavedGridRef.current);
    if (toApply.length === 0) { cancelLive(); return; }
    setLiveLoading(true);
    try {
      const res = await fetch("/api/auto-schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Send the viewed range so the server stamps each accepted cell's owning
        // month (autoMonth) — so Clear Auto removes the whole generated schedule
        // (including any spill into adjacent months) back to its pre-generate state.
        body: JSON.stringify({
          suggestions: toApply,
          startDate: dates[0],
          endDate: dates[dates.length - 1],
        }),
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
        return [...prev.filter((a) => !keys.has(`${a.staffId}:${a.date}`)), ...applied];
      });
      applyRequestDelta({ requests: data.requestChanges });
      pushUndo(undoOps);
    } catch (e) {
      console.error("Live: accept failed", e);
    } finally {
      setLiveLoading(false);
      cancelLive();
    }
  }

  // The unified Live edit (#231 core principle): every legal cell change — picker
  // pick, clear, drag, keyboard — funnels here as pins (new content) + frees (cells
  // the edit emptied). The model is a CONSTRAINED RE-OPTIMIZATION: the user's
  // accumulated pins and the originally-locked cells are held fixed, EVERYTHING ELSE
  // is freed, and the engine re-solves the rest to stay feasible — that re-solve IS
  // the ripple/compensation (rebalanced hours, backfilled coverage, etc.). We always
  // re-solve from the enter-time input so the result is deterministic per pin-set.
  const pinKeyParts = (k: string): { staffId: string; date: string } => {
    const i = k.indexOf(":");
    return { staffId: k.slice(0, i), date: k.slice(i + 1) };
  };

  // Which non-locked, non-pinned existing cells the engine may re-solve, per the
  // chosen scope — anchored on the dates the user has touched this session.
  function pinsArray(pinsMap: Map<string, string>): ScenarioPin[] {
    return [...pinsMap].map(([k, shiftTypeId]) => ({ ...pinKeyParts(k), shiftTypeId }));
  }

  // Returns true if the edit was applied, false if a hard-illegal pin snapped it back
  // (callers like paste use this to avoid a misleading "applied" toast).
  function liveEdit(newPins: ScenarioPin[], newFrees: ScenarioFree[]): boolean {
    const base = liveBaseInputRef.current;
    if (!base || !liveOutcome) return false;

    // Fold this edit into the accumulated pin set (a free un-pins its cell) and the
    // touched-date anchor.
    const nextPins = new Map(livePinsRef.current);
    for (const f of newFrees) nextPins.delete(`${f.staffId}:${f.date}`);
    for (const p of newPins) nextPins.set(`${p.staffId}:${p.date}`, p.shiftTypeId);
    const nextTouched = new Set(liveTouchedRef.current);
    for (const p of newPins) nextTouched.add(p.date);
    for (const f of newFrees) nextTouched.add(f.date);

    const outcome = applyScenario(base, pinsArray(nextPins), freesForScope(base, nextPins, nextTouched, liveScope));
    if (!outcome.applied) {
      // Hard-illegal pin: snap back (keep current grid + pins) and explain.
      setLiveReject(outcome.rejected);
      return false;
    }
    liveUndoStack.current.push({ pins: livePinsRef.current, touched: liveTouchedRef.current, outcome: liveOutcome });
    liveRedoStack.current = [];
    livePinsRef.current = nextPins;
    liveTouchedRef.current = nextTouched;
    setLiveReject([]);
    setLiveOutcome(outcome);
    return true;
  }

  // Re-solve the current pin-set at a new scope (a scope change is not an edit, so
  // it doesn't touch the undo stack — it just widens/narrows the displayed ripple).
  function changeLiveScope(scope: "day" | "pp" | "range") {
    setLiveScope(scope);
    const base = liveBaseInputRef.current;
    if (!base || !liveOutcome) return;
    const outcome = applyScenario(base, pinsArray(livePinsRef.current), freesForScope(base, livePinsRef.current, liveTouchedRef.current, scope));
    if (outcome.applied) { setLiveReject([]); setLiveOutcome(outcome); }
  }

  function liveSandboxUndo() {
    const snap = liveUndoStack.current.pop();
    if (!snap || !liveOutcome) return;
    liveRedoStack.current.push({ pins: livePinsRef.current, touched: liveTouchedRef.current, outcome: liveOutcome });
    livePinsRef.current = snap.pins;
    liveTouchedRef.current = snap.touched;
    setLiveReject([]);
    setLiveOutcome(snap.outcome);
  }

  function liveSandboxRedo() {
    const snap = liveRedoStack.current.pop();
    if (!snap || !liveOutcome) return;
    liveUndoStack.current.push({ pins: livePinsRef.current, touched: liveTouchedRef.current, outcome: liveOutcome });
    livePinsRef.current = snap.pins;
    liveTouchedRef.current = snap.touched;
    setLiveReject([]);
    setLiveOutcome(snap.outcome);
  }
  const liveUndoFnRef = useRef(liveSandboxUndo);
  const liveRedoFnRef = useRef(liveSandboxRedo);
  const liveEditRef = useRef(liveEdit);
  useEffect(() => { liveUndoFnRef.current = liveSandboxUndo; });
  useEffect(() => { liveRedoFnRef.current = liveSandboxRedo; });
  useEffect(() => { liveEditRef.current = liveEdit; });

  async function clearAutoScheduled() {
    if (liveMode) return;
    if (!dates.length) return;
    setAutoLoading(true);
    try {
      const res = await fetch("/api/auto-schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: monthBounds.start, endDate: monthBounds.end }),
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
      // Clearing auto assignments reverts the approvals they triggered back to
      // pending — keep the overlay in step.
      applyRequestDelta({ requests: data.requestChanges });

      pushUndo(undoOps);
    } catch (e) {
      console.error("Clear auto-scheduled failed:", e);
    } finally {
      setAutoLoading(false);
    }
  }

  // Day-level staffing alerts (coverage). Only days in the viewed month — the grid
  // also renders pay-period padding rows from adjacent months, which must not alert.
  const staffingAlerts = useMemo(
    () => buildAlerts(dates, dayWarnings, firstOfMonth, lastOfMonth),
    [dates, dayWarnings, firstOfMonth, lastOfMonth],
  );

  // Pay-period-hours divergence alerts. Built from the SAME ppHours / visibleStaff
  // set the PP Totals row uses, so the modal and grid can never disagree. Each
  // staff member's divergence anchors to the pay period's end date (so a PP
  // crossing a month boundary surfaces exactly once — see buildPPHoursAlerts).
  const ppHoursAlerts = useMemo(() => {
    const entries: PPHoursEntry[] = [];
    for (const pp of sortedPPs) {
      const provHours = ppHours.get(pp.startDate);
      for (const p of visibleStaff) {
        const hours = provHours?.get(p.id) ?? 0;
        const warning = checkStaffPPHours({ staff: p, pp, currentHours: hours });
        if (!warning) continue;
        entries.push({
          staffId: p.id,
          ppStartDate: pp.startDate,
          anchorDate: pp.endDate,
          hours,
          target: pp.targetHours * p.ftePercentage,
          warning,
        });
      }
    }
    return buildPPHoursAlerts(entries, firstOfMonth, lastOfMonth);
  }, [sortedPPs, ppHours, visibleStaff, firstOfMonth, lastOfMonth]);

  // Pending-request alerts: each still-unfulfilled (status "pending") request for a
  // visible staff member whose range touches the viewed month, surfaced as an
  // actionable to-do. Anchored/keyed in buildRequestAlerts; the message (initials +
  // description + date range) is formatted here where shift codes / dateFormat live.
  const requestAlerts = useMemo(() => {
    const visIds = new Set(visibleStaff.map((p) => p.id));
    const entries: RequestAlertEntry[] = [];
    for (const r of localRequests) {
      if (r.status !== "pending" || !visIds.has(r.staffId)) continue;
      const initials = staffInitialsMap.get(r.staffId) ?? "?";
      const desc = describeRequest(r, (id) => shiftTypeMap.get(id)?.code ?? id);
      const range =
        r.startDate === r.endDate
          ? formatDate(parseDate(r.startDate), dateFormat)
          : `${formatDate(parseDate(r.startDate), dateFormat)}–${formatDate(parseDate(r.endDate), dateFormat)}`;
      entries.push({ id: r.id, startDate: r.startDate, endDate: r.endDate, message: `${initials}: ${desc} (${range})` });
    }
    return buildRequestAlerts(entries, firstOfMonth, lastOfMonth);
  }, [localRequests, visibleStaff, staffInitialsMap, shiftTypeMap, dateFormat, firstOfMonth, lastOfMonth]);

  // The Alerts modal's sections (pending requests, then pay-period hours, then daily staffing).
  const alertSections = useMemo(
    () => buildAlertSections(staffingAlerts, ppHoursAlerts, requestAlerts),
    [staffingAlerts, ppHoursAlerts, requestAlerts],
  );
  // Every alert across categories; counts/severity ignore muted ones.
  const allAlerts = useMemo(() => [...requestAlerts, ...ppHoursAlerts, ...staffingAlerts], [requestAlerts, ppHoursAlerts, staffingAlerts]);

  // Muted alert keys, shared across logins (seeded server-side, kept live here).
  const [mutedKeys, setMutedKeys] = useState<Set<string>>(() => new Set(mutedAlertKeys));
  // Mute/unmute an alert: optimistic, reverts on failure. Persisted shared via
  // /api/alerts/mutes (requires schedule:edit) — only offered when canEdit.
  const toggleMute = useCallback(async (key: string) => {
    if (liveMode) return; // no persisted writes (even alert mutes) during a Live sandbox
    const wasMuted = mutedKeys.has(key);
    setMutedKeys((prev) => {
      const next = new Set(prev);
      if (wasMuted) next.delete(key); else next.add(key);
      return next;
    });
    try {
      const res = await fetch("/api/alerts/mutes", {
        method: wasMuted ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertKey: key }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.error("Toggle alert mute failed:", e);
      setMutedKeys((prev) => {
        const next = new Set(prev);
        if (wasMuted) next.add(key); else next.delete(key);
        return next;
      });
    }
  }, [mutedKeys, liveMode]);

  // Alerts that still "count" — muted ones are silenced.
  const visibleAlerts = useMemo(() => allAlerts.filter((a) => !mutedKeys.has(a.key)), [allAlerts, mutedKeys]);
  // Hard error (red) only from zero-coverage staffing; PP-hours is always amber.
  const hasAlertError = useMemo(() => visibleAlerts.some((a) => a.type === "error"), [visibleAlerts]);

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${requestMode ? "ring-2 ring-inset ring-violet-500" : ""}`}>
      {/* Request mode indicator — "/" toggles; letters create requests, not
          assignments (Shift=avoid, Alt=soft). Esc exits. */}
      {requestMode && (
        <div
          data-print-hide
          className="shrink-0 flex items-center justify-center gap-2 px-4 py-1 bg-violet-600 text-white text-xs font-semibold"
        >
          <span>REQUEST MODE — letters add requests (Shift = avoid, Alt = soft). Press “/” or Esc to exit.</span>
        </div>
      )}
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
          title="Previous month"
        >
          ←
        </button>
        <button
          onClick={goToday}
          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          title="Jump to the current month"
        >
          Today
        </button>
        <button
          onClick={nextMonth}
          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          title="Next month"
        >
          →
        </button>
        <div className="relative ml-4" ref={monthPickerRef}>
          <button
            onClick={() => setShowMonthPicker((v) => !v)}
            className="text-base font-semibold text-slate-200 hover:text-white hover:bg-slate-700 px-2 py-0.5 rounded transition-colors"
            title="Pick a month and year"
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
        {/* Toolbar order: PP / RQ / Versions / Print (Show all staff trails when shown) */}
        <button
          onClick={() => setShowPPRows((v) => { const next = !v; localStorage.setItem("yosched:showPPRows", String(next)); return next; })}
          className={["ml-4 px-3 py-1 text-sm rounded transition-colors", showPPRows ? "bg-indigo-700 hover:bg-indigo-600 text-indigo-100" : "bg-slate-700 hover:bg-slate-600 text-slate-400"].join(" ")}
          title="Toggle pay period hour totals"
        >
          PP Totals
        </button>
        <div className="relative inline-flex">
          <button
            onClick={toggleShowRequests}
            className={["px-3 py-1 text-sm rounded-l transition-colors", showRequests ? "bg-violet-700 hover:bg-violet-600 text-violet-100" : "bg-slate-700 hover:bg-slate-600 text-slate-400"].join(" ")}
            title="Show or hide requests on the schedule (?)"
          >
            RQ{showRequests && requestFilter !== "all" ? <span className="ml-1 text-[10px] opacity-80">{REQUEST_FILTERS.find((f) => f.value === requestFilter)?.short}</span> : null}
          </button>
          <button
            onClick={() => setRequestMenuOpen((o) => !o)}
            className={["px-1.5 py-1 text-sm rounded-r border-l transition-colors", showRequests ? "bg-violet-700 hover:bg-violet-600 text-violet-100 border-violet-800" : "bg-slate-700 hover:bg-slate-600 text-slate-400 border-slate-800"].join(" ")}
            title="Choose which requests to show"
            aria-haspopup="menu"
            aria-expanded={requestMenuOpen}
          >
            ▾
          </button>
          {requestMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setRequestMenuOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-20 min-w-[150px] rounded border border-slate-600 bg-slate-800 py-1 shadow-lg" role="menu">
                {REQUEST_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    role="menuitemradio"
                    aria-checked={requestFilter === f.value}
                    onClick={() => chooseRequestFilter(f.value)}
                    className={["flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors", requestFilter === f.value ? "bg-violet-700/40 text-violet-100" : "text-slate-300 hover:bg-slate-700"].join(" ")}
                  >
                    <span className="w-3 text-violet-300">{requestFilter === f.value ? "✓" : ""}</span>
                    {f.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setShowVersions(true)}
          disabled={liveMode}
          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded transition-colors text-slate-300 flex items-center gap-1.5"
          title={liveMode ? "Exit Live to save or restore versions" : "Save or restore versions of this month's schedule"}
        >
          Versions
          {focalVersion && (
            <span className="text-xs text-slate-400">
              · v{focalVersion.versionNumber}
              {monthModified && <span className="ml-0.5 text-amber-400" title="Unsaved edits since this version">*</span>}
            </span>
          )}
        </button>
        <button
          onClick={() => window.print()}
          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300"
          title="Print this month"
        >
          Print
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
        <div className="ml-auto flex items-center gap-2">
          {canEdit && (
            <>
              {selection.size > 0 && (
                <span className="text-xs text-emerald-400 font-medium">
                  {selection.size} selected
                </span>
              )}
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
            </>
          )}
          {/* Clear Auto — pure schedule:auto op (DELETE needs only schedule:auto),
              gated on canAuto independently of canEdit so it matches the server. */}
          {canAuto && (
            <button
              onClick={clearAutoScheduled}
              disabled={autoLoading || liveMode}
              className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded transition-colors text-red-400 font-medium"
              title="Remove all auto-scheduled assignments (keeps manual entries)"
            >
              Clear Auto
            </button>
          )}
          {/* Auto-generate (the interactive scheduling sandbox). Gated on canLive
              (schedule:auto + requests:view) INDEPENDENTLY of canEdit — the engine
              flow doesn't need schedule:edit, and this is the only scheduling entry
              point, so a schedule:auto user must reach it without schedule:edit. */}
          {canLive && (
            <button
              onClick={enterLive}
              disabled={liveLoading || liveMode}
              className="px-3 py-1 text-sm bg-violet-700 hover:bg-violet-600 disabled:opacity-50 rounded transition-colors text-violet-100 font-medium"
              title="Auto-generate: fill the schedule, then edit any cell and the engine instantly re-solves the rest. Accept to save, Cancel to discard."
            >
              {liveLoading ? "Loading…" : "Auto-generate"}
            </button>
          )}
          {/* Alerts — color reflects severity; opens the alerts modal. */}
          {/* Enabled whenever ANY alert exists (even if all are muted), so muted
              rows stay reachable to unmute. Active count/severity ignore muted. */}
          <button
            onClick={() => setShowAlerts(true)}
            disabled={allAlerts.length === 0}
            className={[
              "px-3 py-1 text-sm rounded transition-colors flex items-center gap-1.5 font-medium",
              allAlerts.length === 0
                ? "bg-slate-800 text-slate-600 cursor-default"
                : visibleAlerts.length === 0
                  ? "bg-slate-700 hover:bg-slate-600 text-slate-300"
                  : hasAlertError
                    ? "bg-red-700 hover:bg-red-600 text-red-100"
                    : "bg-amber-700 hover:bg-amber-600 text-amber-100",
            ].join(" ")}
            title={
              allAlerts.length === 0
                ? "No alerts for this month"
                : visibleAlerts.length === 0
                  ? `All ${allAlerts.length} alert${allAlerts.length !== 1 ? "s" : ""} muted — click to review`
                  : `${visibleAlerts.length} alert${visibleAlerts.length !== 1 ? "s" : ""} — click to review`
            }
          >
            <span className={`w-1.5 h-1.5 rounded-full ${allAlerts.length === 0 || visibleAlerts.length === 0 ? "bg-slate-500" : hasAlertError ? "bg-red-300" : "bg-amber-300"}`} />
            Alerts
            {visibleAlerts.length > 0 && <span className="text-xs opacity-80">{visibleAlerts.length}</span>}
          </button>
          {/* Help — farthest right; keystrokes, color legend, tips. */}
          <button
            onClick={() => setShowHelp(true)}
            className="px-2.5 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300 font-semibold"
            title="Keyboard shortcuts, cell color legend, and help"
            aria-label="Help"
          >
            ?
          </button>
        </div>
      </div>

      {/* Live mode banner (#231). S2: parity readout + Accept/Cancel + sandbox
          revert/advance arrows (disabled until edits exist in S3). */}
      {liveMode && liveOutcome && (
        <div data-print-hide className="px-6 py-3 bg-violet-950/50 border-b border-violet-800 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold text-violet-200">Auto-generate</span>
              <span className="text-xs text-violet-300/80">
                {liveRippleSet.size === 0
                  ? "matches the current grid (no changes yet)"
                  : `${liveRippleSet.size} cell${liveRippleSet.size !== 1 ? "s" : ""} changed`}
              </span>
              {liveOutcome.softWarnings.length > 0 && (
                <span className="text-xs text-amber-400" title={liveOutcome.softWarnings.join("\n")}>
                  {liveOutcome.softWarnings.length} warning{liveOutcome.softWarnings.length !== 1 ? "s" : ""}
                </span>
              )}
              {liveReject.length > 0 && (
                <span className="text-xs text-rose-300" title={liveReject.map((r) => `${r.staffId} ${r.date}: ${r.reason}`).join("\n")}>
                  ✕ edit not allowed ({liveReject.map((r) => r.reason).join(", ")})
                </span>
              )}
              {/* Ripple scope: how wide the engine may re-solve to compensate. */}
              <div className="flex items-center gap-1 text-xs" title="How much of the schedule the engine may change to compensate for an edit">
                <span className="text-violet-300/60">re-solve:</span>
                {([["day", "Day"], ["pp", "Pay period"], ["range", "Whole range"]] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => changeLiveScope(val)}
                    className={`px-1.5 py-0.5 rounded transition-colors ${liveScope === val ? "bg-violet-600 text-white" : "bg-slate-700/60 text-slate-300 hover:bg-slate-600"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={liveSandboxUndo}
                disabled={liveUndoStack.current.length === 0}
                className="px-2 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded transition-colors text-slate-300"
                title="Revert (undo within this Live session) — also Ctrl+Z"
              >
                ↩
              </button>
              <button
                onClick={liveSandboxRedo}
                disabled={liveRedoStack.current.length === 0}
                className="px-2 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded transition-colors text-slate-300"
                title="Advance (redo within this Live session) — also Ctrl+Shift+Z"
              >
                ↪
              </button>
              <button
                onClick={acceptLive}
                disabled={liveLoading}
                className="px-3 py-1 text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded transition-colors text-white font-medium"
              >
                Accept
              </button>
              <button
                onClick={cancelLive}
                disabled={liveLoading}
                className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded transition-colors text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
      {/* Scrollable grid area (full width — the old alerts sidebar is now a modal) */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
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
                    data-print-rule-hide={printHiddenIds.has(p.id) ? "" : undefined}
                    className="px-1 py-1 text-center text-xs font-medium border-b border-slate-700 w-[44px] min-w-[44px] transition-colors cursor-pointer bg-slate-800"
                    style={isActiveCol || hoverCol === p.id ? { backgroundColor: "rgba(29,78,216,0.7)" } : undefined}
                    onClick={() => { clearDedFocus(); setActiveCol(activeCol === p.id ? null : p.id); }}
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
              {/* Aggregate (additional) columns — print-only (hidden on screen, revealed
                  in print via data-other-col). Replace the old hardcoded "FB" column.
                  --agg-col-w sizes the (table-layout:fixed) column to fit the full title
                  on one line, so a long title widens the column rather than wrapping. */}
              {printAggColumns.map((c, ci) => (
                <th
                  key={`agg-h-${ci}`}
                  data-other-col
                  style={{ "--agg-col-w": `calc(${Math.max(c.label.length, 3)}ch + 12px)` } as React.CSSProperties}
                  className="hidden px-1 py-1 text-center text-xs font-medium border-b border-l border-slate-700"
                >
                  {c.label}
                </th>
              ))}
              {dedicatedColumns.map((st) => (
                <th
                  key={`ded-h-${st.id}`}
                  title={st.name}
                  data-print-ded=""
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

                      // Binary signal: green only when hours EXACTLY hit target,
                      // red for any divergence. No ranges, no intermediate colors.
                      // (epsilon guards float rounding, matching PP_HOURS_EPSILON.)
                      let color = "text-slate-500";
                      if (hours > 0) {
                        color = Math.abs(diff) < 0.001 ? "text-emerald-400" : "text-red-400";
                      }

                      const diffLabel = diff >= 0 ? `+${diff}` : `${diff}`;

                      return (
                        <td
                          key={p.id}
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
                    {/* Blank aggregate-column cells keep the PP-summary row aligned with the
                        day rows in print. */}
                    {printAggColumns.map((c, ci) => (
                      <td key={`agg-pp-${ci}`} data-other-col className="hidden border-slate-600/50 border border-y-indigo-500/60" />
                    ))}
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
                    flashDate === date ? "ring-2 ring-inset ring-amber-400 bg-amber-500/20" : "",
                    "transition-colors",
                  ].join(" ")}
                >
                  <td
                    className={[
                      "sticky left-0 z-[5] px-2 py-1 text-xs font-mono border-r border-slate-700 whitespace-nowrap cursor-pointer hover:brightness-125",
                      isNewPP ? "border-t-2 border-t-indigo-500" : "",
                    ].join(" ")}
                    data-print-bg={isHoliday && holidayPrintBg ? "" : undefined}
                    style={{
                      background: isActiveRow ? "rgba(29,78,216,0.7)" : isOutsideMonth ? "#0d1321" : isWeekend ? "#1a2236" : "#0f172a",
                      ...(isHoliday && holidayPrintBg ? { "--print-bg": holidayPrintBg } : null),
                    } as React.CSSProperties}
                    onClick={() => setActiveRow(activeRow === date ? null : date)}
                    onMouseEnter={isHoliday ? (e) => showTip(setTooltip, holidayNames.get(date) ?? "", e) : undefined}
                    onMouseLeave={isHoliday ? () => setTooltip(null) : undefined}
                  >
                    <span className={isActiveRow ? "text-blue-200 font-bold" : isWeekend ? "text-slate-500" : "text-slate-300"}>
                      {label.day}
                    </span>{" "}
                    <span className={isActiveRow ? "text-blue-200" : isOutsideMonth ? "text-slate-600" : "text-slate-400"}>
                      {label.date}
                    </span>
                  </td>
                  {visibleStaff.map((p) => {
                    const cellKey = `${p.id}:${date}`;
                    // In Live mode the cell shows the in-browser re-solve, not the
                    // saved assignment; isRipple flags cells the engine changed.
                    const a = liveMode ? (liveDisplayMap.get(cellKey) ?? null) : assignmentMap.get(cellKey);
                    const isRipple = liveMode && liveRippleSet.has(cellKey);
                    // Per-shift PRINT background tint (Settings → Shift Types → Print background).
                    // Carried as a --print-bg CSS var, consumed only by an @media print rule, so
                    // the on-screen cell is unchanged. null/undefined → no attribute, no tint.
                    const printBg = a ? shiftTypeMap.get(a.shiftTypeId)?.printBackgroundColor : null;
                    const isSaving = saving === cellKey;
                    const isPickerTarget = picker?.staffId === p.id && picker?.date === date;
                    const cw = cellWarnings.get(cellKey);
                    const isDragTarget = dragOver === cellKey;
                    const isDragSrc = dragSource?.staffId === p.id && dragSource?.date === date;
                    const isSelected = selection.has(cellKey);
                    const isActiveCell = activeCol === p.id && isActiveRow;
                    const reqs = showRequests ? requestsByCell.get(cellKey) : undefined;
                    const reqSummary = reqs ? summarizeCellRequests(reqs, (id) => shiftTypeMap.get(id)?.code ?? id) : null;
                    const reqCls = reqSummary ? REQ_CAT_CLASSES[reqSummary.category] : null;
                    // Approval-state treatment: approved/mixed = solid category ring,
                    // pending = faint + dimmed, denied = struck rose (overrides color).
                    const reqDenied = reqSummary?.statusKind === "denied";
                    const reqSolid = reqSummary?.statusKind === "approved" || reqSummary?.statusKind === "mixed";
                    const reqTextCls = reqDenied ? "text-rose-300 line-through decoration-rose-400/70" : reqCls?.text ?? "";
                    const reqDim = reqSummary && !reqSolid && !reqDenied ? "opacity-60" : "";
                    // Boxed request cell; selection/active/drag win.
                    const reqBox =
                      reqSummary && !isSelected && !isActiveCell && !isDragTarget && !isPickerTarget
                        ? `ring-2 ring-inset ${reqDenied ? "ring-rose-500/60" : reqSolid ? reqCls!.ring : reqCls!.ringFaint} ${reqDenied ? "bg-rose-950/25" : reqCls!.bg}`
                        : "";
                    // Empty cells get a lightweight "initials on date" tooltip on the <td>.
                    // Populated cells, requests, and the saving state render their own inner
                    // elements that carry their own tooltips, so skip those.
                    const showEmptyTip = !a && !isSaving && !reqSummary;

                    return (
                      <td
                        key={p.id}
                        data-cell={cellKey}
                        data-bold-cell={a && shiftTypeMap.get(a.shiftTypeId)?.boldOnSchedule ? "" : undefined}
                        data-print-bg={printBg ? "" : undefined}
                        data-print-rule-hide={printHiddenIds.has(p.id) ? "" : undefined}
                        className={[
                          `px-0.5 py-0.5 text-center border-slate-700/30 border relative ${canEdit ? "cursor-pointer" : "cursor-default"}`,
                          isNewPP ? "border-t-2 border-t-indigo-500" : "",
                          !ppEven ? "bg-slate-800/20" : "",
                          reqBox,
                          isPickerTarget ? "ring-1 ring-inset ring-blue-400" : "",
                          // In request mode the selection/active highlight adopts the
                          // violet of the request banner so the selection visibly
                          // belongs to the mode.
                          isSelected ? (requestMode ? "ring-2 ring-inset ring-violet-400 bg-violet-900/30" : "ring-2 ring-inset ring-emerald-400 bg-emerald-900/20") : "",
                          isDragTarget ? "ring-2 ring-inset ring-cyan-400 bg-cyan-900/20" : "",
                          isDragSrc ? "opacity-30" : "",
                          isRipple ? "ring-2 ring-inset ring-amber-400/80 bg-amber-500/10" : "",
                          !a && !isSaving ? "hover:bg-slate-700/30" : "",
                          isActiveCell ? (requestMode ? "ring-2 ring-inset ring-violet-400 z-[2]" : "ring-2 ring-inset ring-blue-400 z-[2]") : "",
                        ].join(" ")}
                        style={{
                          ...(isActiveCell ? { backgroundColor: requestMode ? "rgba(124,58,237,0.45)" : "rgba(29,78,216,0.45)" } : null),
                          ...(printBg ? { "--print-bg": printBg } : null),
                        } as React.CSSProperties}
                        onMouseDown={(e) => handleCellMouseDown(p.id, date, e)}
                        onMouseEnter={(e) => {
                          handleCellMouseEnter(p.id, date);
                          setHoverCol(p.id);
                          if (showEmptyTip) showTip(setTooltip, cellTooltip(p.initials, date, null, reqs), e);
                        }}
                        onMouseLeave={() => { setHoverCol(null); if (showEmptyTip) setTooltip(null); }}
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
                                ? [cellTooltip(p.initials, date, a, reqs), ...cw.map((w) => w.message)].join("\n")
                                : cellTooltip(p.initials, date, a, reqs),
                              e)}
                            onMouseLeave={() => setTooltip(null)}
                          >
                            {a.code}
                          </div>
                        ) : isSaving ? (
                          <div className="text-[11px] text-slate-600">...</div>
                        ) : reqSummary ? (
                          // Empty cell with request(s): show the letters in category color.
                          <div
                            className={`text-[10px] font-bold leading-tight ${reqTextCls} ${reqDim}`}
                            onMouseEnter={(e) => showTip(setTooltip, cellTooltip(p.initials, date, null, reqs), e)}
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
                            className={`absolute top-0 left-0 px-0.5 text-[8px] font-bold leading-none ${reqTextCls} ${reqDim}`}
                            onMouseEnter={(e) => showTip(setTooltip, cellTooltip(p.initials, date, a, reqs), e)}
                            onMouseLeave={() => setTooltip(null)}
                          >
                            {reqSummary.label}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {printAggColumns.map((c, ci) => (
                    <td
                      key={`agg-b-${ci}`}
                      data-other-col
                      className={[
                        "hidden px-0.5 py-0.5 text-center text-[10px] font-semibold leading-tight break-words border-l border-slate-700",
                        isNewPP ? "border-t-2 border-t-indigo-500" : "",
                      ].join(" ")}
                    >
                      {(c.initialsByDate[date] ?? []).join(", ")}
                    </td>
                  ))}
                  {dedicatedColumns.map((st, di) => {
                    const inits = dedicatedColumnInitialsData[di]?.[date] ?? [];
                    const isEditing = canEdit && dedEdit?.shiftTypeId === st.id && dedEdit?.date === date;
                    const isDedSaving = saving === `ded-${st.id}:${date}`;
                    const isDedSelected = dedSelection?.shiftTypeId === st.id && dedSelection.dates.includes(date);
                    const isDedActive = activeDedCol === st.id && activeRow === date;
                    return (
                      <td
                        key={`ded-${st.id}`}
                        data-cell={`ded-${st.id}:${date}`}
                        data-print-ded=""
                        data-print-bg={st.printBackgroundColor && inits.length ? "" : undefined}
                        className={[
                          // Mirror the staff cell so dedicated cells look/feel identical:
                          // faint full border (with a stronger left edge marking the section),
                          // select-none to stop native text-selection bleed, pointer cursor,
                          // and the same emerald-range / blue-active highlight rings.
                          "px-0.5 py-0.5 text-center text-[11px] font-mono font-semibold leading-tight break-words border border-slate-700/30 border-l-slate-700 relative select-none",
                          isNewPP ? "border-t-2 border-t-indigo-500" : "",
                          !isEditing ? (canEdit ? "cursor-pointer" : "cursor-default") : "",
                          !isEditing && !isDedActive && !isDedSelected ? "hover:bg-slate-700/30" : "",
                          isDedSelected ? "ring-2 ring-inset ring-emerald-400 bg-emerald-900/20" : "",
                          isDedActive ? "ring-2 ring-inset ring-blue-400 z-[2]" : "",
                        ].join(" ")}
                        style={{
                          color: st.color,
                          ...(isDedActive ? { backgroundColor: "rgba(29,78,216,0.45)" } : null),
                          ...(st.printBackgroundColor && inits.length ? { "--print-bg": st.printBackgroundColor } : null),
                        } as React.CSSProperties}
                        title={canEdit && !isEditing ? `Click to select · click again or Enter to edit (type initials for ${st.code})` : undefined}
                        onMouseDown={!isEditing ? (e) => handleDedCellMouseDown(st.id, date, e) : undefined}
                        onMouseEnter={!isEditing ? (e) => { handleDedCellMouseEnter(st.id, date); if (inits.length) showTip(setTooltip, `${st.code}: ${inits.join(", ")}`, e); } : undefined}
                        onMouseLeave={!isEditing ? () => setTooltip(null) : undefined}
                        onClick={!isEditing ? (e) => handleDedCellClick(st.id, date, e) : undefined}
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
                              // Defensive: never mutate assignments in request mode, even if it
                              // was toggled on after the editor opened.
                              if (requestMode) { setPasteToast(dedReqModeHint); return; }
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

      {pasteToast && (
        <div
          data-print-hide
          role="status"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-slate-800/95 border border-slate-600 text-slate-100 text-sm px-4 py-2 rounded-lg shadow-xl"
        >
          <span>{pasteToast}</span>
          <button
            onClick={() => setPasteToast(null)}
            className="text-slate-400 hover:text-white text-base leading-none"
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
            tab={liveMode ? "assign" : (requestMode ? "request" : "assign")}
            onTabChange={(t) => { if (liveMode) return; const on = t === "request"; if (on) setShowRequests(true); setRequestMode(on); }}
            requestTargetCount={
              selectionCount > 1
                ? groupCellsIntoTargets([...selection].map((k) => { const [staffId, date] = k.split(":"); return { staffId, date }; })).length
                : 1
            }
          />
        </div>
      )}

      {/* Alerts modal — replaces the old sidebar. Click a day to jump to it. */}
      {showAlerts && (
        <div
          data-print-hide
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowAlerts(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-[480px] max-h-[80vh] flex flex-col"
          >
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-700">
              <h2 className="text-sm font-semibold text-slate-200 flex-1">
                Alerts
                <span className="ml-2 font-normal text-slate-500">{MONTH_NAMES[viewMonth]} {viewYear} · {visibleAlerts.length}</span>
              </h2>
              <button onClick={() => setShowAlerts(false)} className="text-slate-400 hover:text-white text-xl leading-none px-1" aria-label="Close">×</button>
            </div>
            <div className="overflow-y-auto p-2">
              {allAlerts.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-slate-500">No alerts for this month.</div>
              ) : (
                alertSections.map((section) => {
                  const total = section.alerts.length;
                  const active = section.alerts.filter((a) => !mutedKeys.has(a.key)).length;
                  const collapsed = collapsedAlertSections.has(section.category);
                  const groups = groupAlertsByDate(section.alerts);
                  return (
                    <div key={section.category} className="mb-2">
                      {/* Section header — click to expand/collapse. */}
                      <button
                        onClick={() => setCollapsedAlertSections((prev) => {
                          const next = new Set(prev);
                          if (next.has(section.category)) next.delete(section.category); else next.add(section.category);
                          return next;
                        })}
                        disabled={total === 0}
                        className="w-full flex items-center gap-2 px-3 py-1.5 rounded text-left hover:bg-slate-700/40 disabled:hover:bg-transparent disabled:cursor-default"
                      >
                        <span className={`text-slate-500 text-[10px] transition-transform ${collapsed || total === 0 ? "" : "rotate-90"}`}>▶</span>
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex-1">{section.title}</span>
                        {total === 0 ? (
                          <span className="text-[11px] text-slate-600">none</span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-[11px]">
                            <span className={`px-1.5 py-0.5 rounded-full font-semibold ${active === 0 ? "bg-slate-700 text-slate-400" : "bg-amber-600/30 text-amber-300"}`}>{active}</span>
                            {active < total && <span className="text-slate-600">{total - active} muted</span>}
                          </span>
                        )}
                      </button>

                      {/* Section body — alerts grouped by day; the date jumps, the
                          per-alert control mutes (explicit, never the row body). */}
                      {!collapsed && total > 0 && (
                        <div className="mt-0.5">
                          {groups.map((g) => (
                            <div key={g.date} className="px-2 py-1">
                              <button
                                onClick={() => jumpToDate(g.date)}
                                className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 hover:text-white"
                                title="Go to this day on the schedule"
                              >
                                {formatDate(parseDate(g.date), dateFormat)}
                                <span className="text-slate-600">↗</span>
                              </button>
                              <ul className="pl-3 mt-0.5 space-y-0.5">
                                {g.items.map((it) => {
                                  const muted = mutedKeys.has(it.key);
                                  return (
                                    <li key={it.key} className="flex items-start gap-2">
                                      {canEdit && (
                                        <button
                                          onClick={() => toggleMute(it.key)}
                                          className={`shrink-0 mt-[1px] text-[10px] px-1 py-0.5 rounded border transition-colors ${muted ? "border-slate-500 bg-slate-700 text-slate-300 hover:text-white" : "border-slate-600/60 text-slate-500 hover:border-amber-500/60 hover:text-amber-300"}`}
                                          title={muted ? "Unmute — restore this alert to the count" : "Mute — silence this alert for everyone"}
                                          aria-label={muted ? "Unmute alert" : "Mute alert"}
                                          aria-pressed={muted}
                                        >
                                          {muted ? "muted" : "mute"}
                                        </button>
                                      )}
                                      <span className={`text-[11px] leading-tight ${muted ? "text-slate-600 line-through" : it.type === "error" ? "text-red-300" : "text-amber-300/90"}`}>
                                        {it.message}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Help modal — keyboard shortcuts, cell color legend, tips. */}
      {showHelp && (
        <div
          data-print-hide
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowHelp(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-[640px] max-h-[85vh] flex flex-col"
          >
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-700">
              <h2 className="text-sm font-semibold text-slate-200 flex-1">Help — shortcuts &amp; legend</h2>
              <button onClick={() => setShowHelp(false)} className="text-slate-400 hover:text-white text-xl leading-none px-1" aria-label="Close">×</button>
            </div>
            <div className="overflow-y-auto px-5 py-4 text-sm text-slate-300 space-y-5">
              {/* Navigation */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Navigation &amp; selection</h3>
                <dl className="space-y-1">
                  {[
                    ["↑ ↓ ← →", "Move the active cell"],
                    ["Click", "Make a cell active (clears any range selection)"],
                    ["Click a selected cell", "Open the picker for the current selection"],
                    ["Shift + click", "Select a rectangular range from the anchor cell"],
                    ["Shift + drag", "Select a range by dragging"],
                    ["Ctrl / Cmd + click", "Add or remove a cell from the selection"],
                    ["Right-click", "Open the shift picker on a cell"],
                    ["Tab", "Open the shift picker on the active cell"],
                    ["Esc", "Close the picker, exit request mode, or clear the selection"],
                  ].map(([k, d]) => (
                    <div key={k} className="flex items-start gap-3">
                      <kbd className="shrink-0 min-w-[96px] px-2 py-0.5 text-xs font-mono bg-slate-900 border border-slate-600 rounded text-slate-200">{k}</kbd>
                      <span className="text-slate-300">{d}</span>
                    </div>
                  ))}
                </dl>
              </section>

              {/* Entering shifts */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Entering shifts</h3>
                <dl className="space-y-1">
                  {[
                    ["letter", "Assign the shift bound to that hotkey to the active cell / selection"],
                    ["Drag a shift", "Move an assignment to another cell"],
                    ["Delete / Backspace", "Clear the assignment(s) — or, on an ICU/CARD cell, that day's roster"],
                    ["ICU / CARD cell", "Click to select, then click again (or Enter / F2) to edit the initials"],
                    ["Ctrl / Cmd + Z", "Undo"],
                    ["Ctrl + Shift + Z  ·  Ctrl + Y", "Redo"],
                  ].map(([k, d]) => (
                    <div key={k} className="flex items-start gap-3">
                      <kbd className="shrink-0 min-w-[96px] px-2 py-0.5 text-xs font-mono bg-slate-900 border border-slate-600 rounded text-slate-200">{k}</kbd>
                      <span className="text-slate-300">{d}</span>
                    </div>
                  ))}
                </dl>
              </section>

              {/* Copy & paste */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Copy &amp; paste (Excel)</h3>
                <dl className="space-y-1">
                  {[
                    ["Ctrl / Cmd + C", "Copy the selected cells to the clipboard — paste straight into Excel/Sheets"],
                    ["Ctrl / Cmd + V", "Paste a block from Excel into the grid, filling down/right from the active cell"],
                    ["ICU / CARD columns", "Work like staff cells: click to select, Ctrl+C copies, Ctrl+V fills a column of initials down (sets each day's roster). Shift+click or drag selects a date range."],
                  ].map(([k, d]) => (
                    <div key={k} className="flex items-start gap-3">
                      <kbd className="shrink-0 min-w-[96px] px-2 py-0.5 text-xs font-mono bg-slate-900 border border-slate-600 rounded text-slate-200">{k}</kbd>
                      <span className="text-slate-300">{d}</span>
                    </div>
                  ))}
                </dl>
              </section>

              {/* Request mode */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Request mode</h3>
                <dl className="space-y-1">
                  {[
                    ["/", "Toggle request mode (violet banner). Letters now create requests, not assignments."],
                    ["letter", "Request: want this shift"],
                    ["Shift + letter", "Request: avoid this shift"],
                    ["Alt + letter", "Request: soft (preference). Shift + Alt = soft avoid"],
                    ["+", "Approve every pending request on the cell / selection"],
                    ["!", "Deny every pending request on the cell / selection"],
                    ["Delete / Backspace", "Remove the request(s) on the cell / selection"],
                    ["?", "Show or hide the request overlay (the RQ button)"],
                  ].map(([k, d]) => (
                    <div key={k} className="flex items-start gap-3">
                      <kbd className="shrink-0 min-w-[96px] px-2 py-0.5 text-xs font-mono bg-slate-900 border border-slate-600 rounded text-slate-200">{k}</kbd>
                      <span className="text-slate-300">{d}</span>
                    </div>
                  ))}
                </dl>
              </section>

              {/* Shift hotkey legend (dynamic) */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Shift hotkeys</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  {shiftTypes.filter((st) => st.hotkey).map((st) => (
                    <div key={st.id} className="flex items-center gap-2">
                      <kbd className="shrink-0 w-6 text-center px-1 py-0.5 text-xs font-mono bg-slate-900 border border-slate-600 rounded text-slate-200">{st.hotkey!.toUpperCase()}</kbd>
                      <span className="w-9 text-center text-[11px] font-bold rounded px-1 py-0.5" style={{ backgroundColor: st.isOffShift ? "transparent" : st.color + "30", color: st.isOffShift ? "#475569" : st.color }}>{st.code}</span>
                      <span className="text-xs text-slate-400 truncate">{st.name}</span>
                    </div>
                  ))}
                  {shiftTypes.every((st) => !st.hotkey) && (
                    <span className="text-xs text-slate-500">No shift hotkeys configured.</span>
                  )}
                </div>
              </section>

              {/* Cell color legend */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Cell colors</h3>
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500">Assigned shifts use each shift&apos;s own color:</p>
                  <div className="grid grid-cols-3 gap-x-4 gap-y-1">
                    {shiftTypes.map((st) => (
                      <div key={st.id} className="flex items-center gap-2">
                        <span className="w-8 text-center text-[11px] font-bold rounded px-1 py-0.5" style={{ backgroundColor: st.isOffShift ? "transparent" : st.color + "30", color: st.isOffShift ? "#475569" : st.color }}>{st.code}</span>
                        <span className="text-[11px] text-slate-400 truncate">{st.name}{st.isOffShift ? " (off)" : ""}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 pt-1">Request overlay (ring + letters) — kind sets the color:</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {([
                      { label: "want", desc: "Wants the shift", c: REQ_CAT_CLASSES.want },
                      { label: "avoid", desc: "Wants to avoid", c: REQ_CAT_CLASSES.restricted },
                      { label: "leave", desc: "Leave request", c: REQ_CAT_CLASSES.leave },
                      { label: "off", desc: "Off request", c: REQ_CAT_CLASSES.off },
                      { label: "mixed", desc: "Multiple kinds", c: REQ_CAT_CLASSES.mixed },
                    ]).map(({ label, desc, c }) => (
                      <div key={label} className="flex items-center gap-2">
                        <span className={`w-6 h-5 rounded ring-2 ring-inset ${c.ring} ${c.bg}`} />
                        <span className={`text-[11px] font-semibold ${c.text}`}>{label}</span>
                        <span className="text-[11px] text-slate-500 truncate">{desc}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 pt-1">…and the box shows its approval state (toggle with the RQ ▾ menu):</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-5 rounded ring-2 ring-inset ring-emerald-400 bg-emerald-900/15" />
                      <span className="text-[11px] text-slate-400 truncate">Solid ring = approved</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-5 rounded ring-2 ring-inset ring-emerald-400/40 bg-emerald-900/15 opacity-60" />
                      <span className="text-[11px] text-slate-400 truncate">Faint ring = pending</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-5 rounded ring-2 ring-inset ring-rose-500/60 bg-rose-950/25" />
                      <span className="text-[11px] text-slate-400 truncate">Struck rose = denied</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 pt-1">Cell states:</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {[
                      ["ring-2 ring-inset ring-yellow-500/70", "Locked assignment"],
                      ["bg-emerald-900/40", "Auto-schedule suggestion"],
                      ["ring-2 ring-inset ring-emerald-400 bg-emerald-900/20", "Selected (normal mode)"],
                      ["ring-2 ring-inset ring-violet-400 bg-violet-900/30", "Selected (request mode)"],
                      ["ring-2 ring-inset ring-blue-400", "Active cell (normal mode)"],
                      ["ring-2 ring-inset ring-violet-400", "Active cell (request mode)"],
                    ].map(([cls, desc]) => (
                      <div key={desc} className="flex items-center gap-2">
                        <span className={`w-6 h-5 rounded ${cls}`} />
                        <span className="text-[11px] text-slate-400 truncate">{desc}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-5 rounded bg-slate-900 relative"><span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" /></span>
                      <span className="text-[11px] text-slate-400 truncate">Warning dot: red = error, amber = warning</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
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
