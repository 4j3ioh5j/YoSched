"use client";

import { ARCHIVE_LEAVE_RULES, ARCHIVE_DAYS_MAX, dateInZone, isValidArchiveDays, type ArchiveLeaveRule } from "@/lib/request-lines";
import { useTimeZone, TIME_ZONE_EVENT } from "@/app/time-zone-provider";
import { formatClock, wallClock, zoneChoices } from "@/lib/time-zone";
import { orderSpecialColumns, specialColumnKey } from "@/lib/special-columns";
import { loadUdWidthSnapshot, UD_WIDTH_SNAPSHOT_KEY, type UdWidthSnapshot } from "@/lib/ud-width-snapshot";
import { followAvoidsChanged, type FollowAvoidData } from "@/lib/follow-avoids";
import { saveErrorMessage } from "@/lib/stale-client";
import { activationAlreadyCommitted, type CommittedActivation } from "@/lib/activation-retry";
import { appliedDiff, undoList, type ListApplied } from "@/lib/eligibility-undo";
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useEscape } from "@/lib/use-escape";
import type { About } from "@/lib/about";
import { DATE_FORMAT_OPTIONS, DEFAULT_DATE_FORMAT, formatDate, type DateFormatKey } from "@/lib/date-format";
import { PENDING_REQUEST_MODES, type PendingRequestMode, REQUEST_CONFLICT_POLICIES, type RequestConflictPolicy, APPROVAL_CONFLICT_POLICIES, type ApprovalConflictPolicy } from "@/lib/schedule-requests";
import { LIVE_SCOPES, LIVE_SCOPE_LABELS, LIVE_SCOPE_HINTS, type LiveScope } from "@/lib/live-scope";
import { EQUITY_FACTORS_SAVE_URL, buildEquityFactorsSave, equitySaveErrorMessage } from "@/lib/equity-factors";
import { COUNT_COLUMNS_SAVE_URL, buildCountColumnsSave, countColumnsSaveErrorMessage } from "@/lib/count-columns";
import { PRINT_COLUMN_RULES_SAVE_URL, PRINT_AGGREGATE_COLUMNS_SAVE_URL, buildConditionsSave, printSaveErrorMessage } from "@/lib/print-conditions";
import { effectiveCriteria, isInertLine } from "@/lib/print-aggregate-columns";
import { buildCriteriaSave } from "@/lib/print-criteria";
import { SHIFT_SHARE_BASES, type ShiftShareBasis } from "@/lib/shift-share";
import { HOLIDAY_POLICIES, type HolidayPolicy, isHolidayCreditShift, isHolidayUsualWeekdayPct } from "@/lib/holiday-policy";
import { holidayRulesVersion } from "@/lib/holiday-rules-db";
import { buildHolidayGroups, RULE_OFFSET_MIN, RULE_OFFSET_MAX, RULE_NAME_MAX, type HolidayRuleSpec } from "@/lib/holiday-rules";
import { createLatestWriter, type LatestWriter } from "@/lib/latest-writer";
import { TUNING_DEFAULTS, WEEKDAY_NAMES, isWeekendDow, readTuning, tuningError, tuningNeedsSave, weekendLabel, weekendSecondDow, type SchedulerTuning, type TuningKey } from "@/lib/scheduler-tuning";
import { LEAVE_POLICIES, type LeavePolicy } from "@/lib/leave-policy";
import { PINNED_CONSTRAINTS, FACTOR_META, PRIORITY_ROADMAP_NOTE, type FactorMeta } from "@/lib/autogen-priority";
import { HOURS_POLICIES, HOURS_POLICY_KEYS, parseHoursPolicy, isHoursPolicyKey, type HoursPolicy } from "@/lib/autogen-hours-policy";
import { reconcileOrder, MAX_PROFILE_NAME_LENGTH } from "@/lib/autogen-profile";
import { OffStrategyEditor } from "@/components/off-strategy-editor";
import { ruleToWhen, isPlainWeekdayWhen, whenToColumns, describeWhen } from "@/lib/recurrence";
import { payPeriodLabel, periodLengthOf } from "@/lib/pay-periods";
import { createStatusTimer } from "@/lib/status-timer";
import { BackupPanel } from "./backup-panel";
import {
  DEFAULT_PRINT_LAYOUT,
  DATE_COLUMN_FORMATS,
  DAY_COLUMN_FORMATS,
  YOSCHED_FOOTER_SUFFIX,
  PRINT_BLOCK_TEXT_MAX,
  validatePrintBlock,
  validatePrintFontFamily,
  validatePrintFontSize,
  renderPrintTemplate,
  footerLine,
  printFontStack,
  formatDateColumn,
  formatDayColumn,
  ppLabelText,
  PRINT_PAPERS,
  PAPER_IN,
  validatePrintMargin,
  printFit,
  DEFAULT_UD_WIDTH,
  UD_WIDTH_MIN,
  udNarrowerThanTitle,
  udTitleFloorIn,
  UD_WIDTH_MAX,
  type UdWidthMode,
  type UdWidthSettings,
  type PrintAlign,
  type PrintBlock,
  type PrintLayout,
  type PrintTemplateContext,
} from "@/lib/print-layout";
import type { AutoVersionMode } from "@/lib/auto-version";
import { DEFAULT_EXPORT_FILE_NAME, EXPORT_FILE_NAME_MAX, exportFileNameError, resolveExportFileName } from "@/lib/export-filename";
import { RecurrencePicker } from "../staff/recurrence-picker";
import { FrequencyPicker } from "../staff/frequency-picker";
import { deptPickerTarget, deptTargetPutBody, DEPT_DEFAULT_STRENGTH, type DeptTargetRow, type DeptPickerTarget } from "./dept-target-row";
import { DecimalField } from "@/components/decimal-field";
import { DEFAULT_STAFF_ORDER, orderStaff, STAFF_ORDER_DEFAULT_DIR, type StaffOrderCriterion, type StaffOrderDir, type StaffOrderKey } from "@/lib/staff-order";
import { SettingsSearch } from "./settings-search";

const CanEditContext = createContext(true);
function useCanEdit() { return useContext(CanEditContext); }
// Card #215: the SAVED scheduler tuning (weekend, spacing reach, even band) for help text and
// shading across the page; updated only after a successful save.
const TuningContext = createContext<SchedulerTuning>(TUNING_DEFAULTS);
function useTuning() { return useContext(TuningContext); }

type ShiftType = {
  id: string;
  code: string;
  name: string;
  defaultHours: number; // weekday hours
  defaultHoursWeekend: number;
  defaultHoursHoliday: number;
  countsTowardFte: boolean;
  countsAsHolidayWork: boolean;
  isLeave: boolean;
  isPaid: boolean;
  category: string;

  color: string;
  sortOrder: number;
  schedulePriority: number | null;
  isOffShift: boolean;
  isFillShift: boolean;
  weekendPaired: boolean;
  holidayWeekendPaired: boolean;
  spreadOverMonth?: boolean;
  evenAcrossMonths?: boolean;
  minGapDays?: number | null; // card #260
  minGapStrength?: string; // "rule" | "preference"
  ignoresWorkingDays: boolean;
  autoSchedulable: boolean;
  hotkey: string | null;
  dedicatedColumn: boolean;
  boldOnSchedule: boolean;
  printBackgroundColor: string | null;
};

type StaffingReq = {
  id: string;
  shiftTypeId: string;
  dayKey: string;
  minCount: number;
  preferredCount: number;
  maxCount: number | null;
};

type PayPeriod = {
  id: string;
  startDate: string;
  endDate: string;
  targetHours: number;
};

type Holiday = {
  id: string;
  date: string;
  name: string;
  holidayTypeId?: string | null; // card #210: which kind of holiday (links to holiday rules by id)
};
type HolidayTypeData = { id: string; name: string };

type DesirabilityWeight = {
  id: string;
  shiftTypeId: string;
  dayOfWeek: number;
  weight: number;
  reason: string | null;
};

type SchedulingPrefs = {
  prefer3DayWeekends: boolean;
  prefer4DayWeekends: boolean;
  preferSequentialOff: boolean;
  dateFormat: string;
  maxLeavePerDay: number;
  pendingRequestMode: PendingRequestMode;
  requestConflictPolicy: RequestConflictPolicy;
  approvalConflictPolicy: ApprovalConflictPolicy;
  requestArchiveDays: number;
  archiveLeaveMetBy: ArchiveLeaveRule;
  defaultOffStrategyOrder: string[];
  defaultLiveScope: LiveScope;
  shiftShareBasis: ShiftShareBasis;
  holidayPolicy: HolidayPolicy;
  holidayUsualWeekdayPct: number; // card #349
  holidayShiftId: string | null; // card #207: shift credited on a holiday, by id
  printWeekendColor: string | null; // card #209: null = no weekend shading in print
  printHolidayColor: string | null; // card #209: null = no holiday shading in print
  screenHolidayColor: string | null; // card #209: null = no holiday tint on screen
  printLayout: PrintLayout; // card #301: header/footer, table font, DATE/DAY columns
  exportFileName: string | null; // card #299: year export file name template; null = built-in default
  autoVersionMode: AutoVersionMode; // card #312: Print / Export save a version first
  leaveHoursPolicy: LeavePolicy;
  shiftBalanceFrom?: string | null;
  payPeriodAnchor: string | null;
  payPeriodLengthDays: number;
  activationWorkedDefault: ActivationData["defaults"]["worked"];
  activationNeverDefault: ActivationData["defaults"]["never"];
  activationNewHireDefault: ActivationData["defaults"]["newHire"];
} & SchedulerTuning;

type DefaultAvailabilityRule = {
  type: string;
  strength: string;
  // Unified WHEN columns — sole recurrence representation (slice 7 dropped the
  // legacy dayOfWeek/pattern columns).
  whenKind?: string | null;
  whenDays?: number[] | null;
  whenPpWeek?: number | null;
  whenOrds?: number[] | null;
  whenCycleUnit?: string | null;
  whenCycleN?: number | null;
  whenCycleOffset?: number | null;
};

type EmploymentTypeData = {
  id: string;
  name: string;
  defaultIsAutoScheduled: boolean;
  defaultFtePercentage: number;
  /** Card #71: what the type means, as settings (never read from its name). */
  usesFtePercentage: boolean;
  allowsFixedHours: boolean;
  includedInFairness: boolean;
  defaultEligibleShiftTypeIds: string[];
  defaultAvailabilityRules: DefaultAvailabilityRule[];
  sortOrder: number;
  staffCount: number;
};

/** Card #71: what a setting change does to the type's staff, for the confirm dialog (null = nothing).
 *  Nothing is deleted: values a setting turns off are kept and come back when it is turned on again. */
function typeFlagChangeWarning(prev: EmploymentTypeData, next: EmploymentTypeData): string | null {
  if (next.staffCount === 0) return null;
  const n = `${next.staffCount} staff member${next.staffCount === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (prev.usesFtePercentage && !next.usesFtePercentage) parts.push(`${n} will have no FTE % or hours target (their FTE % is kept for if you turn this back on)`);
  if (!prev.usesFtePercentage && next.usesFtePercentage) parts.push(`${n} will use the FTE % stored on each person — check them on the Staff page`);
  if (prev.allowsFixedHours && !next.allowsFixedHours) parts.push(`fixed hours for ${n} will stop applying (kept for if you turn this back on)`);
  if (prev.includedInFairness !== next.includedInFairness) parts.push(`${n} will be ${next.includedInFairness ? "counted in" : "left out of"} fairness`);
  return parts.length ? `${parts.join("; ")}. Continue?` : null;
}

type EquityFactorData = {
  id: string;
  factorType: string;
  shiftTypeId: string | null; // the link (factorType "shift" only)
  shiftCode: string | null; // display only: the shift's current code at page load; the live label comes from the shared shift list
  weight: number;
  enabled: boolean;
  sortOrder: number;
};


type FollowRuleData = {
  id: string;
  sourceShiftId: string;
  allowedShiftId: string | null;
  allowOffShifts: boolean;
  mode: string;
};

type RequiredFollowerData = {
  id: string;
  sourceShiftId: string;
  followerShiftId: string;
  scope: string; // "each_day" | "each_run"
  countsTowardTargets: boolean;
};

type PrintShiftCondition = {
  quantifier: string; // "has_any" | "has_none" | "has_all"
  categories: string[]; // "work" | "leave" | "off"
  shiftTypeIds: string[]; // shifts by id; the chip text is the shift's CURRENT code
  exceptIds: string[];
};

type PrintColumnRuleData = {
  id: string;
  label: string;
  enabled: boolean;
  mode: string; // "include" | "exclude"
  employmentTypeIds: string[];
  minFtePercentage: number | null;
  maxFtePercentage: number | null;
  conditions: PrintShiftCondition[];
};

type PrintAggregateColumnData = {
  id: string;
  label: string;
  enabled: boolean;
  isOther: boolean;
  suppressMembers: boolean;
  employmentTypeIds: string[];
  minFtePercentage: number | null;
  maxFtePercentage: number | null;
  conditions: PrintShiftCondition[];
  conditionScope: string; // "month" | "day"
  // Card #309: the Include / Exclude rule lines; null/absent = the single rule above.
  criteria?: {
    mode: string;
    staffIds: string[];
    employmentTypeIds: string[];
    minFtePercentage: number | null;
    maxFtePercentage: number | null;
    conditions: PrintShiftCondition[];
  }[] | null;
};

/** Card #309: everyone a printed-column People rule may name, inactive staff included (a rule
 *  naming someone who has since gone inactive keeps them, and shows them as such). */
type PrintPerson = { id: string; name: string; isActive: boolean };

type Props = {
  about?: About;
  shiftTypes: ShiftType[];
  staffingReqs: StaffingReq[];
  payPeriods: PayPeriod[];
  holidays: Holiday[];
  holidayTypes?: HolidayTypeData[];
  holidayRules?: { version: string; rules: HolidayRuleSpec[] };
  desirabilityWeights: DesirabilityWeight[];
  schedulingPrefs: SchedulingPrefs;
  departmentTargets: DeptTargetData[];
  employmentTypes: EmploymentTypeData[];
  equityFactors: EquityFactorData[];
  autoGenFactors: AutoGenFactorData[];
  autoGenProfiles: AutoGenProfileData[];
  shiftCodes: string[];
  followRules: FollowRuleData[];
  followAvoids?: FollowAvoidData[];
  requiredFollowers: RequiredFollowerData[];
  countColumns: { id: string; label: string; shiftTypeIds: string[] }[];
  printColumnRules: PrintColumnRuleData[];
  printAggregateColumns: PrintAggregateColumnData[];
  printPeople?: PrintPerson[];
  staffColumnOrder: StaffOrderCriterion[];
  specialColumnOrder?: string[] | null;
  orderableStaff: OrderableStaffRow[];
  canEdit?: boolean;
  canEditAutoGenPriority?: boolean;
  canBackup?: boolean; // card #314: holds "Back Up and Restore All Data"
};

type OrderableStaffRow = {
  id: string;
  name: string;
  initials: string;
  ftePercentage: number | null;
  isAutoScheduled: boolean;
  sortOrder: number;
  createdAt: string;
  employmentType: { sortOrder: number };
  employmentTypeName: string;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

// Card #75: the activation panel tells the employment-type editor that one shift's new-hire
// defaults changed, so a later edit there starts from (and sends) the new list.
const TYPE_DEFAULTS_EVENT = "yosched:type-default-shifts";

type UndoAction = {
  label: string;
  execute: () => Promise<void>;
};

function useUndo() {
  const [pending, setPending] = useState<UndoAction | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const push = useCallback((action: UndoAction) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPending(action);
    timerRef.current = setTimeout(() => setPending(null), 8000);
  }, []);

  const execute = useCallback(async () => {
    if (!pending) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const action = pending;
    setPending(null);
    await action.execute();
  }, [pending]);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPending(null);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { pending, push, execute, dismiss };
}

function UndoToast({ action, onUndo, onDismiss }: { action: UndoAction; onUndo: () => void; onDismiss: () => void }) {
  useEscape(onDismiss);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 shadow-xl animate-in">
      <span className="text-sm text-slate-200">{action.label}</span>
      <button
        onClick={onUndo}
        className="px-3 py-1 text-sm font-medium bg-blue-600 hover:bg-blue-500 rounded transition-colors"
      >
        Undo
      </button>
      <button
        onClick={onDismiss}
        className="text-slate-400 hover:text-slate-200 text-sm transition-colors"
      >
        ×
      </button>
    </div>
  );
}

function ScrollContainer({ children, maxClass }: { children: React.ReactNode; maxClass: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function check() {
      if (!el) return;
      setHasMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    }
    check();
    el.addEventListener("scroll", check);
    const obs = new ResizeObserver(check);
    obs.observe(el);
    return () => { el.removeEventListener("scroll", check); obs.disconnect(); };
  }, [children]);

  return (
    <div className="relative">
      <div ref={scrollRef} className={`${maxClass} overflow-y-auto`}>
        {children}
      </div>
      {hasMore && (
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-slate-800 to-transparent pointer-events-none" />
      )}
    </div>
  );
}

function StatusBadge({ status, error }: { status: SaveStatus; error?: string }) {
  if (status === "idle") return null;
  return (
    <span className={[
      "text-xs px-2 py-0.5 rounded",
      status === "saving" ? "bg-blue-900/50 text-blue-300" : "",
      status === "saved" ? "bg-emerald-900/50 text-emerald-300" : "",
      status === "error" ? "bg-red-900/50 text-red-300" : "",
    ].join(" ")}>
      {status === "saving" && "Saving..."}
      {status === "saved" && "Saved"}
      {status === "error" && (error || "Error")}
    </span>
  );
}

// ─── Collapsible section infrastructure ─────────────────────────────────────

type CollapseCtx = {
  isCollapsed: (id: string) => boolean;
  toggle: (id: string) => void;
  open: (id: string) => void;
  setAll: (collapsed: boolean) => void;
  register: (id: string) => () => void;
};

const CollapseContext = createContext<CollapseCtx | null>(null);
const COLLAPSE_STORAGE_KEY = "yosched.settings.collapsed";
const EMPTY_COLLAPSED: ReadonlySet<string> = new Set();

// Backed by localStorage through useSyncExternalStore: the server snapshot is
// always empty (everything expanded) so SSR/hydration stay stable, then React
// swaps in the persisted client snapshot after mount — no setState-in-effect.
function CollapseProvider({ children }: { children: React.ReactNode }) {
  const idsRef = useRef<Set<string>>(new Set());
  const storeRef = useRef<{ snap: Set<string>; loaded: boolean; listeners: Set<() => void> } | null>(null);
  if (storeRef.current === null) {
    storeRef.current = { snap: new Set(), loaded: false, listeners: new Set() };
  }
  const store = storeRef.current;

  const getSnapshot = useCallback(() => {
    if (!store.loaded) {
      store.loaded = true;
      try {
        const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
        if (raw) store.snap = new Set<string>(JSON.parse(raw) as string[]);
      } catch { /* ignore */ }
    }
    return store.snap;
  }, [store]);
  const getServerSnapshot = useCallback(() => EMPTY_COLLAPSED as Set<string>, []);
  const subscribe = useCallback((cb: () => void) => {
    store.listeners.add(cb);
    return () => { store.listeners.delete(cb); };
  }, [store]);

  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const commit = useCallback((next: Set<string>) => {
    store.snap = next;
    store.loaded = true;
    try { window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
    store.listeners.forEach((l) => l());
  }, [store]);

  const register = useCallback((id: string) => {
    idsRef.current.add(id);
    return () => { idsRef.current.delete(id); };
  }, []);

  const toggle = useCallback((id: string) => {
    const next = new Set(store.snap);
    if (next.has(id)) next.delete(id); else next.add(id);
    commit(next);
  }, [store, commit]);

  // Card #366: the search box opens a collapsed section; an open one stays open.
  const open = useCallback((id: string) => {
    if (!store.snap.has(id)) return;
    const next = new Set(store.snap);
    next.delete(id);
    commit(next);
  }, [store, commit]);

  const setAll = useCallback((collapse: boolean) => {
    commit(collapse ? new Set(idsRef.current) : new Set<string>());
  }, [commit]);

  const value = useMemo<CollapseCtx>(() => ({
    isCollapsed: (id: string) => collapsed.has(id),
    toggle, open, setAll, register,
  }), [collapsed, toggle, open, setAll, register]);

  return <CollapseContext.Provider value={value}>{children}</CollapseContext.Provider>;
}

function CollapseToolbar() {
  const ctx = useContext(CollapseContext);
  if (!ctx) return null;
  const btn = "text-xs px-3 py-1.5 rounded bg-slate-700/70 text-slate-300 hover:bg-slate-600 hover:text-slate-100 transition-colors";
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => ctx.setAll(false)} className={btn}>Reveal all</button>
      <button type="button" onClick={() => ctx.setAll(true)} className={btn}>Collapse all</button>
    </div>
  );
}

function SettingsSearchBox() {
  const ctx = useContext(CollapseContext);
  const openSection = useCallback((id: string) => ctx?.open(id), [ctx]);
  return <SettingsSearch openSection={openSection} />;
}

function SectionGroup({ label }: { label: string }) {
  return (
    <h2 data-settings-group={label} className="text-xs font-semibold uppercase tracking-wider text-slate-500 pt-4 pb-1 px-1 border-b border-slate-700/40">
      {label}
    </h2>
  );
}

function CollapsibleSection({ id, title, description, status, error, children }: {
  id: string;
  title: string;
  description: string;
  status: SaveStatus;
  error?: string;
  children: React.ReactNode;
}) {
  const ctx = useContext(CollapseContext);
  useEffect(() => ctx?.register(id), [ctx, id]);
  const open = ctx ? !ctx.isCollapsed(id) : true;

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg scroll-mt-24" data-settings-section={id} data-section-title={title} data-section-desc={description}>
      <button
        type="button"
        onClick={() => ctx?.toggle(id)}
        aria-expanded={open}
        className="w-full flex items-start justify-between gap-3 p-6 text-left group"
      >
        <span className="flex items-start gap-3 min-w-0">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={`w-4 h-4 mt-1 shrink-0 text-slate-500 transition-transform group-hover:text-slate-300 ${open ? "" : "-rotate-90"}`}>
            <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="min-w-0">
            <span className="block text-lg font-semibold text-slate-100">{title}</span>
            <span className="block text-sm text-slate-400">{description}</span>
          </span>
        </span>
        <StatusBadge status={status} error={error} />
      </button>
      <div data-settings-body className={open ? "px-6 pb-6" : "hidden"}>
        {children}
      </div>
    </div>
  );
}

// ─── About YoSched Section (card #230) ──────────────────────────────────────
// Every value comes from the build (package.json + the release commit); nothing is
// typed in here. An unknown value says so instead of showing a guess.

function AboutSection({ about, dateFormat }: { about: About; dateFormat: DateFormatKey }) {
  const unknown = <span className="text-slate-500">unknown</span>;
  const [y, m, d] = about.releaseDate ? about.releaseDate.split("-").map(Number) : [];
  const released = about.releaseDate ? formatDate(new Date(y, m - 1, d), dateFormat) : null;
  const maker = about.makerName
    ? about.makerUrl
      ? <a href={about.makerUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 underline underline-offset-2">{about.makerName}</a>
      : about.makerName
    : null;
  const row = "grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm";
  return (
    <CollapsibleSection id="about" title="About YoSched" description="Version and release" status="idle">
      <dl className="divide-y divide-slate-700/40">
        <div className={row}>
          <dt className="text-slate-400">Version</dt>
          <dd className="text-slate-100">
            {about.version ?? unknown}
            {about.build && <span className="ml-2 text-slate-500">(build {about.build})</span>}
          </dd>
        </div>
        <div className={row}>
          <dt className="text-slate-400">Release date</dt>
          <dd className="text-slate-100">{released ?? unknown}</dd>
        </div>
        <div className={row}>
          <dt className="text-slate-400">Copyright</dt>
          <dd className="text-slate-100">
            {about.copyrightYear !== null || maker
              ? <>© {about.copyrightYear ?? unknown} {maker ?? unknown}</>
              : unknown}
          </dd>
        </div>
      </dl>
    </CollapsibleSection>
  );
}
const EMPTY_ABOUT: About = { version: null, build: null, releaseDate: null, copyrightYear: null, makerName: null, makerUrl: null };
// ─── end About ──────────────────────────────────────────────────────────────

// ─── Shift Types Section ────────────────────────────────────────────────────

function FieldRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div data-search-label={label} data-search-desc={description} className="flex items-start gap-4 py-3 border-b border-slate-700/50 last:border-0">
      <div className="w-48 shrink-0 pt-0.5">
        <div className="text-sm text-slate-200">{label}</div>
        <div className="text-xs text-slate-500 mt-0.5">{description}</div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

type FollowRuleState = {
  enabled: boolean;
  mode: "allow" | "block";
  allowOffShifts: boolean;
  checkedIds: Set<string>;
};

function FollowRulesEditor({ sourceShiftId, allShifts, state, onChange }: {
  sourceShiftId: string;
  allShifts: ShiftType[];
  state: FollowRuleState;
  onChange: (state: FollowRuleState) => void;
}) {
  const canEdit = useCanEdit();
  const candidates = allShifts.filter((s) => !s.isOffShift);

  return (
    <div className="space-y-2">
      <FieldRow label="Restrict follow shifts" description="Limit which shifts can be assigned the day after this one">
        <input
          type="checkbox"
          disabled={!canEdit}
          checked={state.enabled}
          onChange={(e) => onChange(e.target.checked
            ? { enabled: true, mode: "allow", allowOffShifts: true, checkedIds: new Set() }
            : { enabled: false, mode: "allow", allowOffShifts: false, checkedIds: new Set() }
          )}
          className="rounded border-slate-600 w-4 h-4 disabled:opacity-50"
        />
      </FieldRow>
      {state.enabled && (
        <div className="ml-4 pl-4 border-l-2 border-slate-700 space-y-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => canEdit && onChange({ ...state, mode: "allow", checkedIds: new Set(), allowOffShifts: false })}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors ${state.mode === "allow" ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30" : "bg-slate-700 text-slate-400 hover:bg-slate-600 border border-transparent"} ${!canEdit ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              Allow
            </button>
            <button
              type="button"
              onClick={() => canEdit && onChange({ ...state, mode: "block", checkedIds: new Set(), allowOffShifts: false })}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors ${state.mode === "block" ? "bg-red-600/20 text-red-400 border border-red-500/30" : "bg-slate-700 text-slate-400 hover:bg-slate-600 border border-transparent"} ${!canEdit ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              Block
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={state.allowOffShifts}
              onChange={(e) => onChange({ ...state, allowOffShifts: e.target.checked })}
              className="rounded border-slate-600 w-3.5 h-3.5 disabled:opacity-50"
            />
            <span className="text-slate-300">{state.mode === "allow" ? "Any off-shift" : "Block off-shifts"}</span>
          </label>
          {candidates.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={state.checkedIds.has(s.id)}
                onChange={(e) => {
                  const next = new Set(state.checkedIds);
                  if (e.target.checked) next.add(s.id);
                  else next.delete(s.id);
                  onChange({ ...state, checkedIds: next });
                }}
                className="rounded border-slate-600 w-3.5 h-3.5 disabled:opacity-50"
              />
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-slate-300">{s.code}</span>
              <span className="text-slate-600 text-xs">{s.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Card #177: "avoid after this shift" — soft, so any shift may be ticked (off and leave too).
function FollowAvoidEditor({ allShifts, checkedIds, onChange }: {
  allShifts: ShiftType[];
  checkedIds: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const canEdit = useCanEdit();
  return (
    <div className="space-y-2">
      <FieldRow label="Avoid after this shift (soft)" description="The scheduler steers away from these the day after, but still uses one when it's the only way to fill a day.">
        <span />
      </FieldRow>
      <div className="ml-4 pl-4 border-l-2 border-slate-700 space-y-2">
        {allShifts.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={checkedIds.has(s.id)}
              onChange={(e) => {
                const next = new Set(checkedIds);
                if (e.target.checked) next.add(s.id);
                else next.delete(s.id);
                onChange(next);
              }}
              className="rounded border-slate-600 w-3.5 h-3.5 disabled:opacity-50"
            />
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-slate-300">{s.code}</span>
            <span className="text-slate-600 text-xs">{s.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

type RequiredFollowerState = {
  enabled: boolean;
  followerShiftId: string;
  scope: "each_day" | "each_run";
  countsTowardTargets: boolean;
};

function RequiredFollowerEditor({ sourceShiftId, allShifts, state, onChange }: {
  sourceShiftId: string;
  allShifts: ShiftType[];
  state: RequiredFollowerState;
  onChange: (state: RequiredFollowerState) => void;
}) {
  const canEdit = useCanEdit();
  const candidates = allShifts.filter((s) => s.id !== sourceShiftId);

  return (
    <div className="space-y-2">
      <FieldRow label="Requires a follower" description="Auto-place another shift on the next eligible day (e.g. CALL → ADM, ORC → day off). Skipped with a warning if that day can't take it.">
        <input
          type="checkbox"
          disabled={!canEdit}
          checked={state.enabled}
          onChange={(e) => onChange(e.target.checked
            ? { ...state, enabled: true, followerShiftId: state.followerShiftId || (candidates[0]?.id ?? "") }
            : { ...state, enabled: false })}
          className="rounded border-slate-600 w-4 h-4 disabled:opacity-50"
        />
      </FieldRow>
      {state.enabled && (
        <div className="ml-4 pl-4 border-l-2 border-slate-700 space-y-2">
          <FieldRow label="Follower shift" description="Which shift is placed after this one">
            <select
              disabled={!canEdit}
              value={state.followerShiftId}
              onChange={(e) => onChange({ ...state, followerShiftId: e.target.value })}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm disabled:opacity-50"
            >
              {candidates.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="Placement" description="After every occurrence, or once after a consecutive run (e.g. one ADM after a whole CALL weekend)">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => canEdit && onChange({ ...state, scope: "each_day" })}
                className={`px-2.5 py-1 text-[11px] rounded transition-colors ${state.scope === "each_day" ? "bg-sky-600/20 text-sky-400 border border-sky-500/30" : "bg-slate-700 text-slate-400 hover:bg-slate-600 border border-transparent"} ${!canEdit ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                After each day
              </button>
              <button
                type="button"
                onClick={() => canEdit && onChange({ ...state, scope: "each_run" })}
                className={`px-2.5 py-1 text-[11px] rounded transition-colors ${state.scope === "each_run" ? "bg-sky-600/20 text-sky-400 border border-sky-500/30" : "bg-slate-700 text-slate-400 hover:bg-slate-600 border border-transparent"} ${!canEdit ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                After a run
              </button>
            </div>
          </FieldRow>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={state.countsTowardTargets}
              onChange={(e) => onChange({ ...state, countsTowardTargets: e.target.checked })}
              className="rounded border-slate-600 w-3.5 h-3.5 disabled:opacity-50"
            />
            <span className="text-slate-300">Counts toward staffing &amp; targets</span>
            <span className="text-slate-600 text-xs">(off = mandatory extra; hours still count toward FTE)</span>
          </label>
        </div>
      )}
    </div>
  );
}

// The shift list lives in SettingsPage state (`shifts` / `onShiftsChange`), so sibling
// sections that show shift codes (Staffing Rules headers etc.) see a saved rename at once.
type ActivationChoice = { version: string; eligibleStaffIds: string[]; defaultEmploymentTypeIds: string[] };
type ActivationUndo = { version: string; inverse: { autoSchedulable: boolean; eligibleStaffIds: string[]; defaultEmploymentTypeIds: string[] } };
type ActivationData = {
  version: string;
  people: { id: string; initials: string; name: string; employmentTypeId: string; isAutoScheduled: boolean; eligibleNow: boolean; workedCount: number; lastWorked: string | null; hasRules: boolean }[];
  types: { id: string; name: string; defaultNow: boolean }[];
  defaults: { worked: "eligible" | "not_eligible" | "keep"; never: "eligible" | "not_eligible" | "keep"; newHire: "keep" | "match" | "none" | "all" };
};
const GROUP_LABELS = { eligible: "Eligible", not_eligible: "Not eligible", keep: "Leave as saved" } as const;
const NEW_HIRE_LABELS = { keep: "Leave as saved", match: "Types of the people ticked", none: "None", all: "All types" } as const;

// Card #75: who becomes eligible when a shift's Auto-schedule is turned on. Starting ticks come
// from Settings → Scheduling (people who have worked the shift / everyone else / new hires);
// every row can be changed. Cancel saves nothing.
// onConfirm resolves to null when saved (the parent then closes the panel and the edit window
// together) or to an error message, shown here with the panel left open (card #77).
function ActivationPanel({ shift, committed, onCancel, onConfirm }: { shift: ShiftType; committed: boolean; onCancel: () => void; onConfirm: (c: ActivationChoice) => Promise<string | null> }) {
  const [data, setData] = useState<ActivationData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  async function confirm(c: ActivationChoice) {
    setSaving(true);
    setSaveError("");
    const err = await onConfirm(c);
    if (err) { setSaveError(err); setSaving(false); }
  }
  const [worked, setWorked] = useState<ActivationData["defaults"]["worked"]>("eligible");
  const [never, setNever] = useState<ActivationData["defaults"]["never"]>("not_eligible");
  const [newHire, setNewHire] = useState<ActivationData["defaults"]["newHire"]>("keep");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [typeTicks, setTypeTicks] = useState<Set<string> | null>(null); // null = follow the new-hire rule
  useEscape(() => { if (!saving) onCancel(); });

  useEffect(() => {
    let live = true;
    fetch(`/api/settings/shift-types/activation?id=${encodeURIComponent(shift.id)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? "Failed to load"); return j as ActivationData; })
      .then((d) => {
        if (!live) return;
        setData(d);
        setWorked(d.defaults.worked); setNever(d.defaults.never); setNewHire(d.defaults.newHire);
        setTicked(groupTicks(d, d.defaults.worked, d.defaults.never));
      })
      .catch((e) => { if (live) setLoadError(e instanceof Error ? e.message : "Failed to load"); });
    return () => { live = false; };
  }, [shift.id]);

  function groupTicks(d: ActivationData, w: typeof worked, n: typeof never) {
    const out = new Set<string>();
    for (const p of d.people) {
      const rule = p.workedCount > 0 ? w : n;
      if (rule === "keep" ? p.eligibleNow : rule === "eligible") out.add(p.id);
    }
    return out;
  }
  const typesTicked = useMemo(() => {
    if (!data) return new Set<string>();
    if (typeTicks) return typeTicks;
    const out = new Set<string>();
    for (const t of data.types) {
      const on = newHire === "keep" ? t.defaultNow : newHire === "all" ? true : newHire === "none" ? false
        : data.people.some((p) => ticked.has(p.id) && p.employmentTypeId === t.id);
      if (on) out.add(t.id);
    }
    return out;
  }, [data, typeTicks, newHire, ticked]);

  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const workedPeople = data?.people.filter((p) => p.workedCount > 0) ?? [];
  const neverPeople = data?.people.filter((p) => p.workedCount === 0) ?? [];
  const unticksWithRules = data?.people.filter((p) => p.hasRules && !ticked.has(p.id)) ?? [];

  const row = (p: ActivationData["people"][number]) => (
    <label key={p.id} className="flex items-center gap-2 py-1 text-sm">
      <input type="checkbox" checked={ticked.has(p.id)} onChange={() => setTicked((cur) => toggle(cur, p.id))} className="rounded border-slate-600 w-4 h-4" />
      <span className="font-mono w-12">{p.initials}</span>
      <span className="text-slate-400 flex-1 truncate">{p.name}</span>
      <span className="text-xs text-slate-500">
        {p.workedCount > 0 ? `worked ${p.workedCount}×, last ${p.lastWorked}` : "never"}
        {!p.isAutoScheduled && " · not auto-scheduled"}
        {p.hasRules && " · has rules for this shift"}
      </span>
    </label>
  );

  return (
    // z-[60]: above the shift's edit window (z-50), which stays open behind it so Cancel returns there.
    // Light backdrop: the edit window (already dimmed) stays visible behind the panel.
    <div className="fixed inset-0 z-[60] bg-black/30 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Turn on ${shift.code}`}>
      <div className="bg-slate-900 border border-slate-700 rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="p-4 border-b border-slate-700">
          <h3 className="text-lg font-semibold">Turn on auto-scheduling for {shift.code}</h3>
          <p className="text-sm text-slate-400 mt-1">Choose who the scheduler may give {shift.code} to. Nothing is saved until you press Turn on.</p>
        </div>
        {/* Fixed minimum height: the panel opens at its size instead of growing once the list loads. */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4 min-h-[20rem]">
          {loadError && <p className="text-red-400 text-sm">{loadError}</p>}
          {!data && !loadError && <p className="text-slate-400 text-sm">Finding who has worked {shift.code}…</p>}
          {committed && (
            <p className="text-amber-300 text-sm">Who gets {shift.code} is saved, and its auto-schedule is on. The rest of the shift&apos;s settings did not save; press Retry to save them.</p>
          )}
          {data && (
            <fieldset disabled={committed || saving} className="space-y-4 min-w-0">
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-sm">People who have worked {shift.code} ({workedPeople.length})
                  <select value={worked} onChange={(e) => { const v = e.target.value as typeof worked; setWorked(v); setTicked(groupTicks(data, v, never)); }} className="mt-1 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1">
                    {(["eligible", "not_eligible", "keep"] as const).map((k) => <option key={k} value={k}>{GROUP_LABELS[k]}</option>)}
                  </select>
                </label>
                <label className="text-sm">Everyone else ({neverPeople.length})
                  <select value={never} onChange={(e) => { const v = e.target.value as typeof never; setNever(v); setTicked(groupTicks(data, worked, v)); }} className="mt-1 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1">
                    {(["eligible", "not_eligible", "keep"] as const).map((k) => <option key={k} value={k}>{GROUP_LABELS[k]}</option>)}
                  </select>
                </label>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-300">Have worked {shift.code}</h4>
                {workedPeople.length ? workedPeople.map(row) : <p className="text-xs text-slate-500">Nobody yet.</p>}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-300">Never worked it</h4>
                {neverPeople.length ? neverPeople.map(row) : <p className="text-xs text-slate-500">Nobody.</p>}
              </div>
              {unticksWithRules.length > 0 && (
                <p className="text-xs text-amber-400">{unticksWithRules.map((p) => p.initials).join(", ")}: their rules for {shift.code} are kept but ignored while they are not eligible; ticking them again brings the rules back.</p>
              )}
              <div className="border-t border-slate-700 pt-3">
                <label className="text-sm">New hires get {shift.code} by default for
                  <select value={newHire} onChange={(e) => { setNewHire(e.target.value as typeof newHire); setTypeTicks(null); }} className="mt-1 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1">
                    {(["keep", "match", "none", "all"] as const).map((k) => <option key={k} value={k}>{NEW_HIRE_LABELS[k]}</option>)}
                  </select>
                </label>
                <div className="mt-2 flex flex-wrap gap-x-4">
                  {data.types.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm py-1">
                      <input type="checkbox" checked={typesTicked.has(t.id)} onChange={() => setTypeTicks(toggle(typesTicked, t.id))} className="rounded border-slate-600 w-4 h-4" />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
            </fieldset>
          )}
        </div>
        <div className="p-4 border-t border-slate-700 flex items-center justify-end gap-2">
          {saveError && <p className="text-red-400 text-sm mr-auto">{saveError}</p>}
          <button onClick={onCancel} disabled={saving} className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm disabled:opacity-50">Cancel</button>
          <button
            disabled={!data || saving}
            onClick={() => data && !saving && void confirm({ version: data.version, eligibleStaffIds: [...ticked], defaultEmploymentTypeIds: [...typesTicked] })}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm disabled:opacity-50"
          >{saving ? "Saving…" : committed ? "Retry" : `Turn on (${ticked.size} eligible)`}</button>
        </div>
      </div>
    </div>
  );
}

function ShiftTypesSection({ shifts, onShiftsChange: setShifts, pushUndo, initialFollowRules, initialFollowAvoids, initialRequiredFollowers }: { shifts: ShiftType[]; onShiftsChange: React.Dispatch<React.SetStateAction<ShiftType[]>>; pushUndo: (a: UndoAction) => void; initialFollowRules: FollowRuleData[]; initialFollowAvoids: FollowAvoidData[]; initialRequiredFollowers: RequiredFollowerData[] }) {
  const tuning = useTuning(); // card #215: saved weekend / spacing values for the help text
  const canEdit = useCanEdit();
  // Each shift as last SAVED (not page-load props): Cancel reverts to it and Undo restores it.
  const [lastSaved, setLastSaved] = useState(shifts);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [followRules, setFollowRules] = useState(initialFollowRules);
  // The avoid rows as last SAVED: the editor resets from these, and Save compares against them.
  const [followAvoids, setFollowAvoids] = useState(initialFollowAvoids);
  const [requiredFollowers, setRequiredFollowers] = useState(initialRequiredFollowers);
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  function handleDragStart(idx: number) {
    dragIdx.current = idx;
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current !== null && dragIdx.current !== idx) {
      setDragOverIdx(idx);
    }
  }

  async function handleDrop(idx: number) {
    const from = dragIdx.current;
    if (from === null || from === idx) { dragIdx.current = null; setDragOverIdx(null); return; }
    const reordered = [...shifts];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(idx, 0, moved);
    setShifts(reordered);
    dragIdx.current = null;
    setDragOverIdx(null);
    await fetch("/api/settings/shift-types/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: reordered.map((s) => s.id) }),
    });
  }

  function handleDragEnd() {
    dragIdx.current = null;
    setDragOverIdx(null);
  }

  // Card #75: turning Auto-schedule ON opens the activation panel first (who becomes eligible,
  // which employment types give it to new hires); the save then goes through its endpoint.
  const [activating, setActivating] = useState<ShiftType | null>(null);
  // Card #78: the panel's choice that is already saved (who gets the shift) when a LATER step of
  // the same save failed. A retry then redoes only the remaining steps, never the activation
  // again (its version is spent: it would 409).
  const [committed, setCommitted] = useState<CommittedActivation>(null);
  const pendingActivationUndo = useRef<UndoAction | null>(null);

  // The Undo of a committed activation: puts back the flag, the shift's other fields, everyone's
  // eligibility and the new-hire defaults (refused, 409, when anyone changed them since).
  // Card #80: HELD while the panel is open (its toast would be covered and its countdown would run
  // out during slow remaining steps or a Retry); offered when the panel closes.
  function pushActivationUndo(prev: ShiftType, undo: ActivationUndo, shift: ShiftType) {
      pendingActivationUndo.current = {
        label: `Turned on ${shift.code}`,
        execute: async () => {
          // Puts back the flag, everyone's eligibility and the new-hire defaults — refused (409)
          // when anyone changed them since, and then nothing is reverted.
          const res = await fetch("/api/settings/shift-types/activation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: prev.id, version: undo.version, ...undo.inverse, shift: prev }),
          }).catch(() => null);
          if (!res?.ok) {
            const j = await res?.json().catch(() => null);
            setError(j?.error ?? "Undo failed");
            setStatus("error");
            return;
          }
          window.dispatchEvent(new CustomEvent(TYPE_DEFAULTS_EVENT, { detail: { shiftTypeId: prev.id, typeIds: undo.inverse.defaultEmploymentTypeIds } }));
          setShifts((cur) => cur.map((s) => s.id === prev.id ? prev : s));
          setLastSaved((cur) => cur.map((s) => s.id === prev.id ? prev : s));
        },
      };
  }

  function offerHeldActivationUndo() {
    const held = pendingActivationUndo.current;
    pendingActivationUndo.current = null;
    if (held) pushUndo(held);
  }

  // Resolves to null when saved, else the error message (the activation panel shows it).
  async function saveShift(shift: ShiftType, activation?: ActivationChoice): Promise<string | null> {
    const prev = lastSaved.find((s) => s.id === shift.id) ?? shifts.find((s) => s.id === shift.id);
    if (!activation && prev && !prev.autoSchedulable && shift.autoSchedulable) {
      setCommitted(null);
      setActivating(shift);
      return null;
    }
    setStatus("saving");
    try {
      const alreadyCommitted = activationAlreadyCommitted(committed, shift.id, activation?.version);
      if (activation && !alreadyCommitted) {
        const res = await fetch("/api/settings/shift-types/activation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: shift.id, version: activation.version, autoSchedulable: true, eligibleStaffIds: activation.eligibleStaffIds, defaultEmploymentTypeIds: activation.defaultEmploymentTypeIds, shift }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error ?? `Save failed (${res.status})`);
        const activationUndo: ActivationUndo = { inverse: j.inverse, version: j.state.version };
        window.dispatchEvent(new CustomEvent(TYPE_DEFAULTS_EVENT, { detail: { shiftTypeId: shift.id, typeIds: activation.defaultEmploymentTypeIds } }));
        // Saved: from here on the shift IS on. Record it (a retry skips this step), make it the
        // saved row (Cancel returns to it) and offer its Undo now, whatever the later steps do.
        setCommitted({ shiftId: shift.id, version: activation.version });
        setLastSaved((cur) => cur.some((s) => s.id === shift.id) ? cur.map((s) => s.id === shift.id ? shift : s) : [...cur, shift]);
        if (prev) pushActivationUndo(prev, activationUndo, shift);
      } else if (!activation) {
        const res = await fetch("/api/settings/shift-types", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(shift),
        });
        if (!res.ok) throw new Error(await res.text());
      }

      const frRules: Array<{ allowedShiftId: string | null; allowOffShifts: boolean }> = [];
      if (followRuleState.enabled) {
        if (followRuleState.allowOffShifts) frRules.push({ allowedShiftId: null, allowOffShifts: true });
        for (const id of followRuleState.checkedIds) frRules.push({ allowedShiftId: id, allowOffShifts: false });
      }
      const frRes = await fetch("/api/settings/shift-follow-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceShiftId: shift.id, mode: followRuleState.mode, rules: frRules }),
      });
      if (frRes.ok) {
        const saved = await frRes.json() as Array<{ id: string; sourceShiftId: string; allowedShiftId: string | null; allowOffShifts: boolean; mode: string }>;
        setFollowRules((prev) => [
          ...prev.filter((r) => r.sourceShiftId !== shift.id),
          ...saved.map((r) => ({ id: r.id, sourceShiftId: r.sourceShiftId, allowedShiftId: r.allowedShiftId, allowOffShifts: r.allowOffShifts, mode: r.mode })),
        ]);
      }

      // Card #177: soft avoids — written only when the ticked set differs from the saved rows.
      if (followAvoidsChanged(followAvoids, shift.id, avoidIds)) {
        const faRes = await fetch("/api/settings/shift-follow-avoids", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceShiftId: shift.id, avoidShiftIds: [...avoidIds] }),
        });
        if (!faRes.ok) throw new Error(await faRes.text());
        const saved = await faRes.json() as FollowAvoidData[];
        setFollowAvoids((prev) => [
          ...prev.filter((r) => r.sourceShiftId !== shift.id),
          ...saved.map((r) => ({ id: r.id, sourceShiftId: r.sourceShiftId, avoidShiftId: r.avoidShiftId })),
        ]);
      }

      // Required follower: upsert when enabled, otherwise clear any existing rule.
      // A non-OK response throws so the save is reported as an error, not "saved".
      if (requiredFollowerState.enabled && requiredFollowerState.followerShiftId) {
        const rfRes = await fetch("/api/settings/required-followers", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceShiftId: shift.id,
            followerShiftId: requiredFollowerState.followerShiftId,
            scope: requiredFollowerState.scope,
            countsTowardTargets: requiredFollowerState.countsTowardTargets,
          }),
        });
        if (!rfRes.ok) throw new Error(await rfRes.text());
        const saved = await rfRes.json() as RequiredFollowerData;
        setRequiredFollowers((prev) => [
          ...prev.filter((r) => r.sourceShiftId !== shift.id),
          { id: saved.id, sourceShiftId: saved.sourceShiftId, followerShiftId: saved.followerShiftId, scope: saved.scope, countsTowardTargets: saved.countsTowardTargets },
        ]);
      } else {
        const rfRes = await fetch("/api/settings/required-followers", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceShiftId: shift.id }),
        });
        if (!rfRes.ok) throw new Error(await rfRes.text());
        setRequiredFollowers((prev) => prev.filter((r) => r.sourceShiftId !== shift.id));
      }

      setStatus("saved");
      setCommitted(null);
      offerHeldActivationUndo(); // the panel closes now (its parent awaits this save)
      setEditingId(null);
      setLastSaved((cur) => cur.some((s) => s.id === shift.id) ? cur.map((s) => s.id === shift.id ? shift : s) : [...cur, shift]);
      setTimeout(() => setStatus("idle"), 2000);

      if (!activation && prev) {
        pushUndo({
          label: `Updated ${shift.code}`,
          execute: async () => {
            await fetch("/api/settings/shift-types", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(prev),
            });
            setShifts((cur) => cur.map((s) => s.id === prev.id ? prev : s));
            setLastSaved((cur) => cur.map((s) => s.id === prev.id ? prev : s));
          },
        });
      }
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setError(msg);
      setStatus("error");
      return msg;
    }
  }

  async function deleteShift(id: string) {
    if (!confirm("Delete this shift type?")) return;
    const deleted = shifts.find((s) => s.id === id);
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/shift-types", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      setShifts((prev) => prev.filter((s) => s.id !== id));
      setLastSaved((prev) => prev.filter((s) => s.id !== id));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);

      if (deleted) {
        pushUndo({
          label: `Deleted ${deleted.code}`,
          execute: async () => {
            const res = await fetch("/api/settings/shift-types", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(deleted),
            });
            if (!res.ok) return;
            const created = await res.json();
            // Card #75: a re-created shift always comes back with Auto-schedule off (the server
            // forces it); turning it on again opens the panel that chooses who gets it.
            const back = { ...deleted, id: created.id, autoSchedulable: !!created.autoSchedulable };
            setShifts((cur) => [...cur, back]);
            setLastSaved((cur) => [...cur, back]);
          },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  async function addShift() {
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/shift-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "NEW",
          name: "New Shift",
          defaultHours: 8,
          category: "work",
          color: "#6b7280",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      const newShift: ShiftType = {
        id: created.id,
        code: created.code,
        name: created.name,
        defaultHours: created.defaultHours,
        defaultHoursWeekend: created.defaultHoursWeekend ?? 0,
        defaultHoursHoliday: created.defaultHoursHoliday ?? 0,
        countsTowardFte: created.countsTowardFte,
        countsAsHolidayWork: created.countsAsHolidayWork ?? true,
        isLeave: created.isLeave,
        isPaid: created.isPaid,
        category: created.category,
        color: created.color ?? "#6b7280",
        sortOrder: created.sortOrder,
        schedulePriority: created.schedulePriority ?? null,
        isOffShift: created.isOffShift ?? false,
        isFillShift: created.isFillShift ?? false,
        weekendPaired: created.weekendPaired ?? false,
        holidayWeekendPaired: created.holidayWeekendPaired ?? false,
        spreadOverMonth: created.spreadOverMonth ?? false,
        evenAcrossMonths: created.evenAcrossMonths ?? false,
        minGapDays: created.minGapDays ?? null,
        minGapStrength: created.minGapStrength ?? "preference",
        ignoresWorkingDays: created.ignoresWorkingDays ?? false,
        autoSchedulable: created.autoSchedulable ?? false,
        hotkey: created.hotkey ?? null,
        dedicatedColumn: created.dedicatedColumn ?? false,
        boldOnSchedule: created.boldOnSchedule ?? false,
        printBackgroundColor: created.printBackgroundColor ?? null,
      };
      setShifts((prev) => [...prev, newShift]);
      setLastSaved((prev) => [...prev, newShift]);
      setEditingId(created.id);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);

      pushUndo({
        label: "Added new shift type",
        execute: async () => {
          await fetch("/api/settings/shift-types", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: created.id }),
          });
          setShifts((cur) => cur.filter((s) => s.id !== created.id));
          setLastSaved((cur) => cur.filter((s) => s.id !== created.id));
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  function updateField(id: string, field: keyof ShiftType, value: unknown) {
    setShifts((prev) => prev.map((s) => s.id === id ? { ...s, [field]: value } : s));
  }

  const cancelEdit = useCallback(() => {
    if (!editingId) return;
    const orig = lastSaved.find((s) => s.id === editingId);
    if (orig) setShifts((prev) => prev.map((s) => s.id === editingId ? orig : s));
    setEditingId(null);
  }, [editingId, lastSaved, setShifts]);
  // While the activation panel is open, Escape closes only the panel (not the edit window too).
  useEscape(() => { if (!activating) cancelEdit(); });

  const editingShift = editingId ? shifts.find((s) => s.id === editingId) : null;

  const [followRuleState, setFollowRuleState] = useState<FollowRuleState>({ enabled: false, mode: "allow", allowOffShifts: false, checkedIds: new Set() });

  useEffect(() => {
    if (!editingId) return;
    const rules = followRules.filter((r) => r.sourceShiftId === editingId);
    if (rules.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset editor state when the edited shift changes
      setFollowRuleState({
        enabled: true,
        mode: (rules[0].mode as "allow" | "block") || "allow",
        allowOffShifts: rules.some((r) => r.allowOffShifts),
        checkedIds: new Set(rules.map((r) => r.allowedShiftId).filter(Boolean) as string[]),
      });
    } else {
      setFollowRuleState({ enabled: false, mode: "allow", allowOffShifts: false, checkedIds: new Set() });
    }
  }, [editingId, followRules]);

  const [avoidIds, setAvoidIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!editingId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset editor state when the edited shift changes
    setAvoidIds(new Set(followAvoids.filter((r) => r.sourceShiftId === editingId).map((r) => r.avoidShiftId)));
  }, [editingId, followAvoids]);

  const [requiredFollowerState, setRequiredFollowerState] = useState<RequiredFollowerState>({ enabled: false, followerShiftId: "", scope: "each_day", countsTowardTargets: false });

  useEffect(() => {
    if (!editingId) return;
    const rule = requiredFollowers.find((r) => r.sourceShiftId === editingId);
    // Mirrors the sibling followRuleState effect: reset editor state when the edited
    // shift changes. Same set-state-in-effect shape as the existing follow-rule editor.
    if (rule) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRequiredFollowerState({
        enabled: true,
        followerShiftId: rule.followerShiftId,
        scope: rule.scope === "each_run" ? "each_run" : "each_day",
        countsTowardTargets: rule.countsTowardTargets,
      });
    } else {
      setRequiredFollowerState({ enabled: false, followerShiftId: "", scope: "each_day", countsTowardTargets: false });
    }
  }, [editingId, requiredFollowers]);

  return (
    <>
    {activating && (
      <ActivationPanel
        shift={activating}
        committed={committed?.shiftId === activating.id}
        onCancel={() => { setCommitted(null); setActivating(null); offerHeldActivationUndo(); }}
        onConfirm={async (c) => {
          // The panel stays open ("Saving…") until the save finishes; then it and the edit window
          // close together. On an error it stays open with the message (card #77).
          const err = await saveShift(activating, c);
          if (!err) setActivating(null);
          return err;
        }}
      />
    )}
    <CollapsibleSection
      id="shift-types"
      title="Shift Types"
      description="Configure shift codes, durations, and rules"
      status={status}
      error={error}
    >

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 uppercase tracking-wider">
              <th className="py-2 px-1 w-8" />
              <th className="text-left py-2 px-2 w-16">Code</th>
              <th className="text-left py-2 px-2">Name</th>
              <th className="text-center py-2 px-2 w-16">Hours</th>
              <th className="text-center py-2 px-2 w-20">Category</th>
              <th className="text-center py-2 px-2 w-12">Color</th>
              <th className="text-center py-2 px-2 w-28">Auto-schedule</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {shifts.map((st, i) => (
              <tr
                key={st.id}
                draggable={canEdit}
                onDragStart={() => canEdit && handleDragStart(i)}
                onDragOver={(e) => canEdit && handleDragOver(e, i)}
                onDrop={() => canEdit && handleDrop(i)}
                onDragEnd={handleDragEnd}
                className={`transition-colors ${canEdit ? "cursor-pointer" : ""} ${dragOverIdx === i ? "bg-blue-900/30 border-t border-blue-500" : "hover:bg-slate-700/30"}`}
                onClick={() => canEdit && setEditingId(st.id)}
              >
                <td className={`py-2 px-1 w-8 text-center ${canEdit ? "cursor-grab" : ""}`} onClick={(e) => e.stopPropagation()}>
                  <span className="text-slate-600 text-xs select-none">⠿</span>
                </td>
                <td className="py-2 px-2">
                  <span className="font-mono font-bold" style={{ color: st.color }}>{st.code}</span>
                </td>
                <td className="py-2 px-2 text-slate-300">{st.name}</td>
                <td className="py-2 px-2 text-center text-slate-300 font-mono">{st.defaultHours}</td>
                <td className="py-2 px-2 text-center text-xs text-slate-400">{st.category}</td>
                <td className="py-2 px-2 text-center">
                  <span className="inline-block w-4 h-4 rounded" style={{ backgroundColor: st.color }} />
                </td>
                <td className="py-2 px-2 text-center text-xs text-slate-500">
                  {st.schedulePriority != null ? `#${st.schedulePriority}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingShift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => cancelEdit()}>
          <div
            className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <div className="flex items-center gap-3">
                <span className="inline-block w-4 h-4 rounded" style={{ backgroundColor: editingShift.color }} />
                <span className="font-mono font-bold text-lg" style={{ color: editingShift.color }}>{editingShift.code}</span>
                <span className="text-slate-400">{editingShift.name}</span>
              </div>
              <button onClick={cancelEdit} className="text-slate-500 hover:text-slate-300 text-lg">x</button>
            </div>

            <div className="px-6 py-4">
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Basic Info</div>
              <FieldRow label="Code" description="Short code shown on the grid">
                <input disabled={!canEdit} className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm font-mono disabled:opacity-50" value={editingShift.code} onChange={(e) => updateField(editingShift.id, "code", e.target.value.toUpperCase())} />
              </FieldRow>
              <FieldRow label="Name" description="Full name of this shift type">
                <input disabled={!canEdit} className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm disabled:opacity-50" value={editingShift.name} onChange={(e) => updateField(editingShift.id, "name", e.target.value)} />
              </FieldRow>
              <FieldRow label="Hours per shift (weekdays)" description="How many hours this shift counts for on a weekday">
                <DecimalField disabled={!canEdit} aria-label="Hours per shift on weekdays" min={0} decimals={2} className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center disabled:opacity-50" value={editingShift.defaultHours} onValueChange={(v) => updateField(editingShift.id, "defaultHours", v ?? 0)} />
              </FieldRow>
              <FieldRow label="Hours per shift (weekends)" description={`Hours this shift counts for on a weekend day (${weekendLabel(tuning.weekendStartDow)}). 0 = does not accrue weekend hours.`}>
                <DecimalField disabled={!canEdit} aria-label="Hours per shift on weekends" min={0} decimals={2} className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center disabled:opacity-50" value={editingShift.defaultHoursWeekend} onValueChange={(v) => updateField(editingShift.id, "defaultHoursWeekend", v ?? 0)} />
              </FieldRow>
              <FieldRow label="Hours per shift (holidays)" description="Hours this shift counts for on a holiday (takes precedence over weekend). 0 = does not accrue holiday hours.">
                <DecimalField disabled={!canEdit} aria-label="Hours per shift on holidays" min={0} decimals={2} className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center disabled:opacity-50" value={editingShift.defaultHoursHoliday} onValueChange={(v) => updateField(editingShift.id, "defaultHoursHoliday", v ?? 0)} />
              </FieldRow>
              <FieldRow label="Category" description="Work shifts, leave, or other">
                <select disabled={!canEdit} className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm disabled:opacity-50" value={editingShift.category} onChange={(e) => updateField(editingShift.id, "category", e.target.value)}>
                  <option value="work">Work</option>
                  <option value="leave">Leave</option>
                  <option value="other">Other</option>
                </select>
              </FieldRow>
              <FieldRow label="Color" description="Display color on the grid">
                <input disabled={!canEdit} type="color" className="w-8 h-8 rounded cursor-pointer border-0 disabled:opacity-50 disabled:cursor-not-allowed" value={editingShift.color} onChange={(e) => updateField(editingShift.id, "color", e.target.value)} />
              </FieldRow>
              <FieldRow label="Print background" description="Background color for this shift's cells on the PRINTED schedule only (on-screen grid is unaffected). Default: none.">
                <div className="flex items-center gap-2">
                  <input
                    disabled={!canEdit}
                    type="checkbox"
                    checked={editingShift.printBackgroundColor != null}
                    onChange={(e) => updateField(editingShift.id, "printBackgroundColor", e.target.checked ? (editingShift.printBackgroundColor ?? "#abcde2") : null)}
                    className="rounded border-slate-600 w-4 h-4 disabled:opacity-50"
                  />
                  {editingShift.printBackgroundColor != null && (
                    <input
                      disabled={!canEdit}
                      type="color"
                      className="w-8 h-8 rounded cursor-pointer border-0 disabled:opacity-50 disabled:cursor-not-allowed"
                      value={editingShift.printBackgroundColor}
                      onChange={(e) => updateField(editingShift.id, "printBackgroundColor", e.target.value)}
                    />
                  )}
                </div>
              </FieldRow>
              <FieldRow label="Bold on schedule" description="Print this shift's code in bold on the printed schedule (e.g. call shifts that should stand out). Default on for CALL, ORC, and ORL.">
                <input disabled={!canEdit} type="checkbox" checked={editingShift.boldOnSchedule} onChange={(e) => updateField(editingShift.id, "boldOnSchedule", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
              <FieldRow label="Quick key" description="Single letter to assign this shift from the keyboard">
                <input disabled={!canEdit} className="w-12 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm font-mono text-center uppercase disabled:opacity-50" maxLength={1} value={editingShift.hotkey ?? ""} onChange={(e) => updateField(editingShift.id, "hotkey", e.target.value.toUpperCase().slice(0, 1) || null)} />
              </FieldRow>
              <FieldRow label="This is a leave type" description="Check if this represents time off (AL, SL, etc.)">
                <input disabled={!canEdit} type="checkbox" checked={editingShift.isLeave} onChange={(e) => updateField(editingShift.id, "isLeave", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
              <FieldRow label="Counts toward FTE hours" description="Include these hours in pay period totals">
                <input disabled={!canEdit} type="checkbox" checked={editingShift.countsTowardFte} onChange={(e) => updateField(editingShift.id, "countsTowardFte", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
              <FieldRow label="Counts as holiday work" description="When worked on a holiday, this shift counts toward the holiday-burden equity metric. Includes call/duty shifts that don't accrue FTE hours; uncheck for shifts that shouldn't count (e.g. routine clinic).">
                <input disabled={!canEdit} type="checkbox" checked={editingShift.countsAsHolidayWork} onChange={(e) => updateField(editingShift.id, "countsAsHolidayWork", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
              <FollowRulesEditor
                sourceShiftId={editingShift.id}
                allShifts={shifts}
                state={followRuleState}
                onChange={setFollowRuleState}
              />
              <FollowAvoidEditor allShifts={shifts} checkedIds={avoidIds} onChange={setAvoidIds} />
              <RequiredFollowerEditor
                sourceShiftId={editingShift.id}
                allShifts={shifts}
                state={requiredFollowerState}
                onChange={setRequiredFollowerState}
              />
            </div>

            <div className="px-6 py-4 border-t border-slate-700">
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Auto-Scheduling Behavior</div>
              <FieldRow label="Auto-schedulable" description="Allow the auto-scheduler to assign this shift. Disable for rare or manually-assigned shifts.">
                <input disabled={!canEdit} type="checkbox" checked={editingShift.autoSchedulable} onChange={(e) => updateField(editingShift.id, "autoSchedulable", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
              <FieldRow label="Scheduling order" description="When auto-scheduling, which shifts get assigned first. Lower numbers go first. Leave blank if this shift should not be auto-scheduled.">
                <DecimalField disabled={!canEdit} integer allowNegative min={-999} max={999} aria-label="Scheduling order" className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center disabled:opacity-50" value={editingShift.schedulePriority ?? null} placeholder="None" onValueChange={(v) => updateField(editingShift.id, "schedulePriority", v)} />
              </FieldRow>
              <FieldRow label="Pair the two weekend days" description={`Assign the same person to both ${WEEKDAY_NAMES[tuning.weekendStartDow]} and ${WEEKDAY_NAMES[weekendSecondDow(tuning.weekendStartDow)]} when filling this shift on weekends`}>
                <input disabled={!canEdit} type="checkbox" checked={editingShift.weekendPaired} onChange={(e) => updateField(editingShift.id, "weekendPaired", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
              <FieldRow label="Pair with leading or following holiday" description={`When ${weekendLabel(tuning.weekendStartDow)} are paired, also assign the same person to an adjacent holiday (the ${WEEKDAY_NAMES[(tuning.weekendStartDow + 6) % 7]} before or ${WEEKDAY_NAMES[(tuning.weekendStartDow + 2) % 7]} after) so a 3-day holiday weekend is covered by one staff member`}>
                <input disabled={!canEdit || !editingShift.weekendPaired} type="checkbox" checked={editingShift.holidayWeekendPaired} onChange={(e) => updateField(editingShift.id, "holidayWeekendPaired", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
              <FieldRow label="Spread out as much as possible" description={`For each person, the scheduler keeps the shifts marked this way — together — as far apart as it can, looking ${tuning.spreadRadiusDays} days either side (Settings › Scheduler tuning), including last month's and next month's. It decides among people whose counts are even; it never gives anyone extra.`}>
                <input disabled={!canEdit} type="checkbox" checked={!!editingShift.spreadOverMonth} onChange={(e) => updateField(editingShift.id, "spreadOverMonth", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
              <FieldRow label="Minimum days between two" description="For one person, two of this shift are at least this many days apart (7 = the same weekday the next week). Days in a row count as one stretch, measured from its last day. Includes last month's and next month's. Prefer: the scheduler chooses people and days that keep the gap, and warns when it can't. Hard: never closer — a day stays short instead, with a warning. Two in the same pay period can't be further apart than the pay period allows. Blank = off.">
                <div className="flex items-center gap-2">
                  <DecimalField disabled={!canEdit} integer min={2} max={60} aria-label="Minimum days between two" className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center disabled:opacity-50" value={editingShift.minGapDays ?? null} placeholder="Off" onValueChange={(v) => updateField(editingShift.id, "minGapDays", v)} />
                  <select disabled={!canEdit || editingShift.minGapDays == null} value={editingShift.minGapStrength === "rule" ? "rule" : "preference"} onChange={(e) => updateField(editingShift.id, "minGapStrength", e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm disabled:opacity-50" title="Hard or Prefer">
                    <option value="preference">Prefer</option>
                    <option value="rule">Hard</option>
                  </select>
                </div>
              </FieldRow>
              <FieldRow label="Keep counts even across months" description={`Each month this shift is shared out evenly first, as usual. Among people within ${tuning.evenBandCalls} shift${tuning.evenBandCalls === 1 ? "" : "s"} of each other this month (Settings › Scheduler tuning), whoever is owed most from earlier months (since the date under Settings › Scheduling › Scheduled shift share) goes first: a tie-break only. People are owed a share only of days they could have worked it, and new staff start level.`}>
                <input disabled={!canEdit} type="checkbox" checked={!!editingShift.evenAcrossMonths} onChange={(e) => updateField(editingShift.id, "evenAcrossMonths", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
              <FieldRow label="Can be assigned on days off" description="Allow this shift to be assigned even on a staff's non-working days (e.g., weekend call)">
                <input disabled={!canEdit} type="checkbox" checked={editingShift.ignoresWorkingDays} onChange={(e) => updateField(editingShift.id, "ignoresWorkingDays", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
              <FieldRow label="Default shift for filling hours" description="Use this shift to fill remaining hours when a staff is under their pay period target">
                <input disabled={!canEdit} type="checkbox" checked={editingShift.isFillShift} onChange={(e) => updateField(editingShift.id, "isFillShift", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
              <FieldRow label="Represents a day off" description="This shift means the staff is not working (used for post-shift recovery days)">
                <input disabled={!canEdit} type="checkbox" checked={editingShift.isOffShift} onChange={(e) => updateField(editingShift.id, "isOffShift", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
              <FieldRow label="Dedicated column" description="Add a column on the schedule (left of the count columns) showing the initials of whoever is covering this shift each day. This is in addition to the normal shift display in the grid.">
                <input disabled={!canEdit} type="checkbox" checked={editingShift.dedicatedColumn} onChange={(e) => updateField(editingShift.id, "dedicatedColumn", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700">
              {canEdit && (
                <button
                  onClick={() => deleteShift(editingShift.id)}
                  className="px-3 py-1.5 text-sm bg-red-900/50 hover:bg-red-800 text-red-300 rounded transition-colors"
                >
                  Delete Shift Type
                </button>
              )}
              {!canEdit && <div />}
              <div className="flex gap-2">
                <button
                  onClick={cancelEdit}
                  className="px-4 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  {canEdit ? "Cancel" : "Close"}
                </button>
                {canEdit && (
                  <button
                    onClick={() => saveShift(editingShift)}
                    className="px-4 py-1.5 text-sm bg-blue-700 hover:bg-blue-600 rounded transition-colors font-medium"
                  >
                    Save Changes
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {canEdit && (
        <button
          onClick={addShift}
          className="mt-3 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300"
        >
          + Add Shift Type
        </button>
      )}
    </CollapsibleSection>
    </>
  );
}

// ─── Staffing Rules Section ─────────────────────────────────────────────────

const DAY_KEYS = ["1", "2", "3", "4", "5", "6", "0", "holiday"];
const DAY_LABELS: Record<string, string> = {
  "1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu", "5": "Fri",
  "6": "Sat", "0": "Sun", "holiday": "Holiday",
};

function StaffingSection({
  initial,
  shiftTypes,
  pushUndo,
}: {
  initial: StaffingReq[];
  shiftTypes: ShiftType[];
  pushUndo: (a: UndoAction) => void;
}) {
  const canEdit = useCanEdit();
  const { weekendStartDow } = useTuning(); // card #215
  const [grid, setGrid] = useState(() => {
    const map: Record<string, number> = {};
    for (const r of initial) map[`${r.shiftTypeId}:${r.dayKey}`] = r.minCount;
    return map;
  });
  // Preferred (safe) headcount per cell — the auto-scheduler's day-balance
  // threshold. 0 = no preference.
  const [prefGrid, setPrefGrid] = useState(() => {
    const map: Record<string, number> = {};
    for (const r of initial) map[`${r.shiftTypeId}:${r.dayKey}`] = r.preferredCount ?? 0;
    return map;
  });

  // Most staff on the shift that day; null = no limit.
  const [maxGrid, setMaxGrid] = useState(() => {
    const map: Record<string, number | null> = {};
    for (const r of initial) map[`${r.shiftTypeId}:${r.dayKey}`] = r.maxCount ?? null;
    return map;
  });
  // The table as last SAVED (not page-load props): a column the user removed since is
  // sent as `removedColumns` (only explicit removals delete rows), and Undo restores it.
  type SavedStaffing = { columns: string[]; min: Record<string, number>; pref: Record<string, number>; max: Record<string, number | null> };
  const [saved, setSaved] = useState<SavedStaffing>(() => {
    const min: Record<string, number> = {}, pref: Record<string, number> = {}, max: Record<string, number | null> = {};
    for (const r of initial) {
      const k = `${r.shiftTypeId}:${r.dayKey}`;
      min[k] = r.minCount; pref[k] = r.preferredCount ?? 0; max[k] = r.maxCount ?? null;
    }
    return { columns: [...new Set(initial.map((r) => r.shiftTypeId))], min, pref, max };
  });

  // Columns are shift IDs; the code shown in the header is looked up from the current
  // shift list, so a rename elsewhere on the page shows here at once.
  const [columns, setColumns] = useState(() => {
    const ids = [...new Set(initial.map((r) => r.shiftTypeId))];
    if (ids.length === 0) {
      return shiftTypes
        .filter((st) => st.schedulePriority != null)
        .sort((a, b) => (a.schedulePriority ?? 0) - (b.schedulePriority ?? 0))
        .map((st) => st.id);
    }
    return ids.sort((a, b) => {
      const stA = shiftTypes.find((st) => st.id === a);
      const stB = shiftTypes.find((st) => st.id === b);
      return (stA?.schedulePriority ?? 999) - (stB?.schedulePriority ?? 999);
    });
  });
  const codeOf = (shiftTypeId: string) => shiftTypes.find((st) => st.id === shiftTypeId)?.code ?? "?";

  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const addPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editingCol && !showAddPicker) return;
    function handleClick(e: MouseEvent) {
      if (editingCol && pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setEditingCol(null);
      }
      if (showAddPicker && addPickerRef.current && !addPickerRef.current.contains(e.target as Node)) {
        setShowAddPicker(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setEditingCol(null); setShowAddPicker(false); }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [editingCol, showAddPicker]);

  const availableShiftTypes = (excludeId?: string) =>
    shiftTypes.filter((st) => st.category === "work" && (st.id === excludeId || !columns.includes(st.id)));

  function addColumn(shiftTypeId: string) {
    setColumns((prev) => [...prev, shiftTypeId]);
    for (const day of DAY_KEYS) {
      setGrid((prev) => ({ ...prev, [`${shiftTypeId}:${day}`]: 0 }));
      setPrefGrid((prev) => ({ ...prev, [`${shiftTypeId}:${day}`]: 0 }));
      setMaxGrid((prev) => ({ ...prev, [`${shiftTypeId}:${day}`]: null }));
    }
    setShowAddPicker(false);
  }

  function swapColumn(oldId: string, newId: string) {
    setColumns((prev) => prev.map((c) => c === oldId ? newId : c));
    const move = <T,>(empty: T) => (prev: Record<string, T>) => {
      const next = { ...prev };
      for (const day of DAY_KEYS) {
        next[`${newId}:${day}`] = next[`${oldId}:${day}`] ?? empty;
        delete next[`${oldId}:${day}`];
      }
      return next;
    };
    setGrid(move<number>(0));
    setPrefGrid(move<number>(0));
    setMaxGrid(move<number | null>(null));
    setEditingCol(null);
  }

  function removeColumn(shiftTypeId: string) {
    setColumns((prev) => prev.filter((c) => c !== shiftTypeId));
    const drop = <T,>(prev: Record<string, T>) => {
      const next = { ...prev };
      for (const day of DAY_KEYS) delete next[`${shiftTypeId}:${day}`];
      return next;
    };
    setGrid(drop);
    setPrefGrid(drop);
    setMaxGrid(drop);
    setEditingCol(null);
  }

  function updateCell(shiftTypeId: string, dayKey: string, value: number) {
    setGrid((prev) => ({ ...prev, [`${shiftTypeId}:${dayKey}`]: value }));
  }
  function updatePrefCell(shiftTypeId: string, dayKey: string, value: number) {
    setPrefGrid((prev) => ({ ...prev, [`${shiftTypeId}:${dayKey}`]: value }));
  }
  function updateMaxCell(shiftTypeId: string, dayKey: string, raw: string) {
    const n = parseInt(raw);
    setMaxGrid((prev) => ({ ...prev, [`${shiftTypeId}:${dayKey}`]: raw.trim() === "" || Number.isNaN(n) ? null : Math.max(0, n) }));
  }

  async function save() {
    const before = saved;
    const after: SavedStaffing = { columns: [...columns], min: { ...grid }, pref: { ...prefGrid }, max: { ...maxGrid } };
    setStatus("saving");
    try {
      const requirements = columns.flatMap((shiftTypeId) =>
        DAY_KEYS.map((day) => ({
          shiftTypeId,
          dayKey: day,
          minCount: grid[`${shiftTypeId}:${day}`] ?? 0,
          preferredCount: prefGrid[`${shiftTypeId}:${day}`] ?? 0,
          maxCount: maxGrid[`${shiftTypeId}:${day}`] ?? null,
        })),
      );
      const removedColumns = before.columns.filter((c) => !columns.includes(c));

      const res = await fetch("/api/settings/staffing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements, columns, removedColumns }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      setSaved(after);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);

      pushUndo({
        label: "Updated staffing rules",
        execute: async () => {
          // Undo restores the table as saved BEFORE this save (values and columns);
          // columns this save added are removed explicitly.
          const oldReqs = before.columns.flatMap((shiftTypeId) =>
            DAY_KEYS.map((day) => ({
              shiftTypeId,
              dayKey: day,
              minCount: before.min[`${shiftTypeId}:${day}`] ?? 0,
              preferredCount: before.pref[`${shiftTypeId}:${day}`] ?? 0,
              maxCount: before.max[`${shiftTypeId}:${day}`] ?? null,
            })),
          );
          const res = await fetch("/api/settings/staffing", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requirements: oldReqs, columns: before.columns, removedColumns: after.columns.filter((c) => !before.columns.includes(c)) }),
          });
          if (!res.ok) throw new Error(`Undo failed (${res.status})`);
          setGrid(before.min);
          setPrefGrid(before.pref);
          setMaxGrid(before.max);
          setColumns(before.columns);
          setSaved(before);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  return (
    <CollapsibleSection
      id="staffing-rules"
      title="Staffing Rules"
      description="Minimum, preferred and maximum staff per shift type per day of the week. Minimum is always filled first. Preferred is the safe headcount: the auto-scheduler spends free days off on days already at or above it before touching a lighter day (0 = no preference). Maximum is never exceeded, by the auto-scheduler or by hand (blank = no limit; removing a shift's column removes its limits too)."
      status={status}
      error={error}
    >

      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr>
              <th className="text-left py-2 px-3 text-xs text-slate-400 font-medium w-20">Day</th>
              {columns.map((id) => {
                const st = shiftTypes.find((s) => s.id === id);
                const isEditing = editingCol === id;
                return (
                  <th key={id} colSpan={3} className="py-2 px-2 text-center relative">
                    <button
                      onClick={() => canEdit && setEditingCol(isEditing ? null : id)}
                      className={`px-2 py-1 text-xs font-bold font-mono rounded transition-colors ${canEdit ? "hover:brightness-125" : ""}`}
                      style={{ backgroundColor: (st?.color ?? "#94a3b8") + "30", color: st?.color ?? "#94a3b8" }}
                    >
                      {st?.code ?? "?"}
                    </button>
                    {isEditing && (
                      <div ref={pickerRef} className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-20 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-2 min-w-[200px] max-h-[400px] overflow-y-auto">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 py-1">Replace with</div>
                        <div className="grid grid-cols-3 gap-0.5">
                          {availableShiftTypes(id).filter((s) => s.id !== id).map((s) => (
                            <button
                              key={s.id}
                              onClick={() => swapColumn(id, s.id)}
                              className="w-full px-2 py-1.5 text-xs font-bold rounded text-center transition-colors hover:brightness-125"
                              style={{ backgroundColor: s.color + "30", color: s.color }}
                            >
                              {s.code}
                            </button>
                          ))}
                        </div>
                        <div className="border-t border-slate-700 mt-2 pt-1">
                          <button
                            onClick={() => removeColumn(id)}
                            className="w-full px-2 py-1.5 text-xs text-red-400 hover:bg-red-900/30 rounded transition-colors"
                          >
                            Remove column
                          </button>
                        </div>
                      </div>
                    )}
                  </th>
                );
              })}
              {canEdit && (
                <th className="py-2 px-2 w-12">
                  <button
                    onClick={() => setShowAddPicker(!showAddPicker)}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                    title="Add shift column"
                  >
                    +
                  </button>
                </th>
              )}
            </tr>
            <tr>
              <th />
              {columns.map((id) => (
                <Fragment key={`${id}:sub`}>
                  <th className="pb-1 px-1 text-[10px] uppercase tracking-wider text-slate-500 font-medium text-center" title="Minimum — always filled first">Min</th>
                  <th className="pb-1 px-1 text-[10px] uppercase tracking-wider text-slate-500 font-medium text-center" title="Preferred (safe) headcount — free days off avoid days below this">Pref</th>
                  <th className="pb-1 px-1 text-[10px] uppercase tracking-wider text-slate-500 font-medium text-center" title="Maximum — never more than this many on the shift that day. Blank = no limit">Max</th>
                </Fragment>
              ))}
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {DAY_KEYS.map((day) => {
              const isWeekend = day !== "holiday" && isWeekendDow(Number(day), weekendStartDow);
              const isHoliday = day === "holiday";
              return (
                <tr
                  key={day}
                  className={[
                    isWeekend ? "bg-slate-800/40" : "",
                    isHoliday ? "bg-amber-950/20 border-t border-slate-600" : "",
                  ].join(" ")}
                >
                  <td className="py-1.5 px-3 text-sm text-slate-300 font-medium">
                    {DAY_LABELS[day]}
                  </td>
                  {columns.map((id) => (
                    <Fragment key={`${id}:${day}`}>
                      <td className="py-1.5 pl-2 pr-1 text-center">
                        <DecimalField
                          integer
                          required
                          min={0}
                          max={999}
                          disabled={!canEdit}
                          aria-label={`${codeOf(id)} ${DAY_LABELS[day]} minimum`}
                          className="w-12 bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-sm text-center font-mono disabled:opacity-50"
                          value={grid[`${id}:${day}`] ?? 0}
                          onValueChange={(v) => updateCell(id, day, v ?? 0)}
                        />
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        <DecimalField
                          integer
                          required
                          min={0}
                          max={999}
                          disabled={!canEdit}
                          aria-label={`${codeOf(id)} ${DAY_LABELS[day]} preferred`}
                          className="w-12 bg-slate-700/60 border border-slate-600/70 rounded px-1.5 py-1 text-sm text-center font-mono text-slate-300 disabled:opacity-50"
                          value={prefGrid[`${id}:${day}`] ?? 0}
                          onValueChange={(v) => updatePrefCell(id, day, v ?? 0)}
                        />
                      </td>
                      <td className="py-1.5 pl-1 pr-2 text-center">
                        <DecimalField
                          integer
                          min={0}
                          max={999}
                          disabled={!canEdit}
                          aria-label={`${codeOf(id)} ${DAY_LABELS[day]} maximum`}
                          placeholder="–"
                          title="Blank = no limit"
                          className="w-12 bg-slate-700/60 border border-slate-600/70 rounded px-1.5 py-1 text-sm text-center font-mono text-slate-300 placeholder:text-slate-500 disabled:opacity-50"
                          value={maxGrid[`${id}:${day}`] ?? null}
                          onValueChange={(v) => updateMaxCell(id, day, v == null ? "" : String(v))}
                        />
                      </td>
                    </Fragment>
                  ))}
                  <td />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canEdit && showAddPicker && (
        <div ref={addPickerRef} className="mt-2 p-2 bg-slate-800 border border-slate-600 rounded-lg shadow-xl min-w-[200px]">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 py-1">Add column</div>
          <div className="grid grid-cols-3 gap-0.5">
            {availableShiftTypes().filter((st) => !columns.includes(st.id)).map((st) => (
              <button
                key={st.id}
                onClick={() => addColumn(st.id)}
                className="w-full px-2 py-1.5 text-xs font-bold rounded text-center transition-colors hover:brightness-125"
                style={{ backgroundColor: st.color + "30", color: st.color }}
              >
                {st.code}
              </button>
            ))}
          </div>
          {availableShiftTypes().filter((st) => !columns.includes(st.id)).length === 0 && (
            <p className="text-xs text-slate-500 italic px-2 py-1">All work shifts already added</p>
          )}
        </div>
      )}

      {canEdit && (
        <button
          onClick={save}
          className="mt-4 px-4 py-2 text-sm bg-blue-700 hover:bg-blue-600 rounded transition-colors font-medium"
        >
          Save Staffing Rules
        </button>
      )}
    </CollapsibleSection>
  );
}

// ─── Pay Periods Section ────────────────────────────────────────────────────

function formatDateStr(dateStr: string, fmt: DateFormatKey): string {
  const d = new Date(dateStr + "T12:00:00");
  return formatDate(d, fmt);
}

function PayPeriodsSection({ initial, initialAnchor, initialLengthDays, pushUndo, dateFormat }: { initial: PayPeriod[]; initialAnchor: string | null; initialLengthDays: number; pushUndo: (a: UndoAction) => void; dateFormat: DateFormatKey }) {
  const canEdit = useCanEdit();
  const [periods, setPeriods] = useState(initial);
  const [anchorDate, setAnchorDate] = useState(initialAnchor ?? initial[0]?.startDate ?? "");
  const [lengthDays, setLengthDays] = useState(initialLengthDays);
  const [savedAnchor, setSavedAnchor] = useState<{ anchor: string; length: number } | null>(initialAnchor ? { anchor: initialAnchor, length: initialLengthDays } : null);
  const [baseHours, setBaseHours] = useState(initial[0]?.targetHours ?? 80);
  const [hoursStatus, setHoursStatus] = useState<SaveStatus>("idle");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  async function saveBaseHours() {
    const prevHours = periods[0]?.targetHours ?? 80;
    setHoursStatus("saving");
    try {
      const res = await fetch("/api/settings/pay-periods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetHours: baseHours }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPeriods(data);
      setHoursStatus("saved");
      setTimeout(() => setHoursStatus("idle"), 2000);
      pushUndo({
        label: `Changed hours per pay period to ${baseHours}`,
        execute: async () => {
          const res = await fetch("/api/settings/pay-periods", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetHours: prevHours }),
          });
          const data = await res.json();
          setPeriods(data);
          setBaseHours(prevHours);
        },
      });
    } catch (e) {
      setHoursStatus("error");
    }
  }

  async function applyLadder(anchor: string, length: number): Promise<PayPeriod[]> {
    const res = await fetch("/api/settings/pay-periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchorDate: anchor, periodLengthDays: length }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function regenerate() {
    if (!anchorDate) {
      setError("Enter an anchor date (any real pay period start)");
      setStatus("error");
      return;
    }
    if (!confirm(`This will regenerate all pay periods from the ${lengthDays}-day ladder anchored at ${formatDateStr(anchorDate, dateFormat)}. Continue?`)) return;
    const prev = savedAnchor;
    setStatus("saving");
    setError("");
    try {
      const data = await applyLadder(anchorDate, lengthDays);
      setPeriods(data);
      setSavedAnchor({ anchor: anchorDate, length: lengthDays });
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);

      // Undo can only restore a previous ladder — before the first anchor is set
      // there is no ladder to return to, so no undo entry.
      if (prev) {
        pushUndo({
          label: `Regenerated pay periods (anchor ${anchorDate}, ${lengthDays} days)`,
          execute: async () => {
            const data = await applyLadder(prev.anchor, prev.length);
            setPeriods(data);
            setAnchorDate(prev.anchor);
            setLengthDays(prev.length);
            setSavedAnchor(prev);
          },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  return (
    <CollapsibleSection
      id="pay-periods"
      title="Pay Periods"
      description="Biweekly pay period dates"
      status={status}
      error={error}
    >

      <div className="mb-4">
        <label className="text-xs text-slate-400 block mb-1">Hours per Pay Period (1.0 FTE)</label>
        <div className="flex gap-2 items-center">
          <DecimalField
            aria-label="Hours per pay period"
            required
            min={0}
            decimals={2}
            disabled={!canEdit}
            className="w-24 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm font-mono disabled:opacity-50"
            value={baseHours}
            onValueChange={(v) => { if (v != null && v > 0) setBaseHours(v); }}
          />
          {canEdit && (
            <button
              onClick={saveBaseHours}
              className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 rounded transition-colors"
            >
              {hoursStatus === "saving" ? "Saving…" : hoursStatus === "saved" ? "Saved" : "Save"}
            </button>
          )}
          <span className="text-xs text-slate-500">Fractional FTE hours are computed from this value</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
        <div>
          <label className="text-xs text-slate-400 block mb-1">Anchor Date (any real period start)</label>
          <input
            type="date"
            disabled={!canEdit}
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm disabled:opacity-50"
            value={anchorDate}
            onChange={(e) => setAnchorDate(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Period Length (days)</label>
          <div className="flex gap-2">
            <DecimalField
              integer
              required
              min={7}
              max={56}
              aria-label="Period length in days"
              disabled={!canEdit}
              className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm disabled:opacity-50"
              value={lengthDays}
              onValueChange={(v) => v != null && setLengthDays(v)}
            />
            {canEdit && (
              <button
                onClick={regenerate}
                className="px-3 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 rounded transition-colors"
              >
                Regenerate
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Periods extend automatically from year to year — no counting needed. Numbering restarts each year:
        the first period starting on/after Jan 1 is that year&rsquo;s PP 1; the period straddling New
        Year&rsquo;s is the previous year&rsquo;s last.
      </p>

      <div className="border-t border-slate-700 pt-3">
        <p className="text-xs text-slate-500 mb-2">{periods.length} pay periods configured</p>
        <ScrollContainer maxClass="max-h-[280px]">
          <div className="grid grid-cols-3 gap-1 text-xs">
            <span className="text-slate-500 font-medium">Period</span>
            <span className="text-slate-500 font-medium">Start</span>
            <span className="text-slate-500 font-medium">End</span>
            {periods.map((pp) => {
              const label = payPeriodLabel(pp.startDate, periodLengthOf(pp));
              return (
                <Fragment key={pp.id}>
                  <span className="text-slate-400">{label.year} PP {label.number}</span>
                  <span className="text-slate-300 font-mono">{formatDateStr(pp.startDate, dateFormat)}</span>
                  <span className="text-slate-300 font-mono">{formatDateStr(pp.endDate, dateFormat)}</span>
                </Fragment>
              );
            })}
          </div>
        </ScrollContainer>
      </div>
    </CollapsibleSection>
  );
}


// ─── Holidays Section ───────────────────────────────────────────────────────

// Card #210: the holidays list, the holiday types and the holiday rules share one state owner so a
// type rename/delete shows everywhere at once.
function HolidaysBlock({ initialHolidays, initialTypes, initialRules, shiftTypes, payPeriods, pushUndo, dateFormat }: {
  initialHolidays: Holiday[]; initialTypes: HolidayTypeData[]; initialRules: { version: string; rules: HolidayRuleSpec[] };
  shiftTypes: ShiftType[]; payPeriods: PayPeriod[]; pushUndo: (a: UndoAction) => void; dateFormat: DateFormatKey;
}) {
  const [holidays, setHolidays] = useState(initialHolidays);
  const [types, setTypes] = useState(initialTypes);
  // Bumped when a type is deleted (its rules go with it): the rules section re-reads the server.
  const [rulesReload, setRulesReload] = useState(0);
  return (
    <>
      <HolidaysSection holidays={holidays} setHolidays={setHolidays} types={types} payPeriods={payPeriods} pushUndo={pushUndo} dateFormat={dateFormat} />
      <HolidayTypesSection types={types} setTypes={setTypes} holidays={holidays} setHolidays={setHolidays} onTypeDeleted={() => setRulesReload((n) => n + 1)} />
      <HolidayRulesSection initial={initialRules} reloadKey={rulesReload} types={types} holidays={holidays} shiftTypes={shiftTypes} dateFormat={dateFormat} />
    </>
  );
}

function HolidaysSection({ holidays, setHolidays, types, payPeriods, pushUndo, dateFormat }: {
  holidays: Holiday[]; setHolidays: React.Dispatch<React.SetStateAction<Holiday[]>>; types: HolidayTypeData[];
  payPeriods: PayPeriod[]; pushUndo: (a: UndoAction) => void; dateFormat: DateFormatKey;
}) {
  const canEdit = useCanEdit();
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  const coveredYears = useMemo(() => {
    if (payPeriods.length === 0) return [new Date().getFullYear()];
    const startYear = parseInt(payPeriods[0].startDate.split("-")[0]);
    const endYear = parseInt(payPeriods[payPeriods.length - 1].endDate.split("-")[0]);
    const years: number[] = [];
    for (let y = startYear; y <= endYear; y++) years.push(y);
    return years;
  }, [payPeriods]);

  async function autoPopulate() {
    setStatus("saving");
    const prevHolidays = [...holidays];
    try {
      const res = await fetch("/api/settings/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auto-populate", years: coveredYears }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created: Holiday[] = await res.json();
      setHolidays((prev) => {
        const existing = new Set(prev.map((h) => h.date));
        const newOnes = created.filter((c) => !existing.has(c.date));
        return [...prev, ...newOnes].sort((a, b) => a.date.localeCompare(b.date));
      });
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);

      pushUndo({
        label: `Auto-populated ${coveredYears.join(", ")} holidays`,
        execute: async () => {
          const addedDates = created.map((c) => c.date);
          const toRemove = created.filter((c) => !prevHolidays.some((p) => p.date === c.date));
          for (const h of toRemove) {
            await fetch("/api/settings/holidays", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: h.id }),
            });
          }
          setHolidays(prevHolidays);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  async function addHoliday() {
    if (!newDate || !newName) return;
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newDate, name: newName }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      setHolidays((prev) => [...prev, created].sort((a, b) => a.date.localeCompare(b.date)));
      setNewDate("");
      setNewName("");
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);

      pushUndo({
        label: `Added ${created.name}`,
        execute: async () => {
          await fetch("/api/settings/holidays", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: created.id }),
          });
          setHolidays((cur) => cur.filter((h) => h.id !== created.id));
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  // Card #210: which kind of holiday a row is (rules link to the type). null = no type.
  async function setHolidayType(h: Holiday, holidayTypeId: string | null) {
    const before = h.holidayTypeId ?? null;
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: h.date, name: h.name, holidayTypeId }),
      });
      if (!res.ok) throw new Error(saveErrorMessage(res.status, await res.text()));
      const saved: Holiday = await res.json();
      setHolidays((cur) => cur.map((x) => (x.id === h.id ? { ...x, holidayTypeId: saved.holidayTypeId ?? null } : x)));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
      pushUndo({
        label: `Changed the type of ${h.name}`,
        execute: async () => {
          const r = await fetch("/api/settings/holidays", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: h.date, name: h.name, holidayTypeId: before }),
          });
          if (r.ok) setHolidays((cur) => cur.map((x) => (x.id === h.id ? { ...x, holidayTypeId: before } : x)));
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  async function removeHoliday(id: string) {
    const removed = holidays.find((h) => h.id === id);
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/holidays", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(await res.text());
      setHolidays((prev) => prev.filter((h) => h.id !== id));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);

      if (removed) {
        pushUndo({
          label: `Removed ${removed.name}`,
          execute: async () => {
            const res = await fetch("/api/settings/holidays", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ date: removed.date, name: removed.name, holidayTypeId: removed.holidayTypeId ?? null }),
            });
            const restored = await res.json();
            setHolidays((cur) => [...cur, restored].sort((a, b) => a.date.localeCompare(b.date)));
          },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  return (
    <CollapsibleSection
      id="holidays"
      title="Holidays"
      description="Days with special staffing rules (reduced coverage, no ORL)"
      status={status}
      error={error}
    >

      {canEdit && (
        <div className="mb-4">
          <button
            onClick={autoPopulate}
            className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300"
          >
            Auto-populate federal holidays ({coveredYears.join(", ")})
          </button>
        </div>
      )}

      {canEdit && (
        <div className="flex gap-2 mb-4">
          <input
            type="date"
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
          />
          <input
            type="text"
            placeholder="Holiday name"
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm flex-1 max-w-xs"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addHoliday()}
          />
          <button
            onClick={addHoliday}
            disabled={!newDate || !newName}
            className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors"
          >
            Add
          </button>
        </div>
      )}

      {holidays.length === 0 ? (
        <p className="text-sm text-slate-500 italic">No holidays configured</p>
      ) : (
        <ScrollContainer maxClass="max-h-[432px]">
          <div className="space-y-1">
            {holidays.map((h) => (
              <div key={h.id} className="flex items-center justify-between py-1.5 px-3 rounded hover:bg-slate-700/30">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-slate-400">{formatDateStr(h.date, dateFormat)}</span>
                  <span className="text-sm text-slate-200">{h.name}</span>
                </div>
                <div className="flex items-center gap-3">
                <select
                  aria-label={`Type of ${h.name}`}
                  disabled={!canEdit}
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-300 disabled:opacity-50"
                  value={h.holidayTypeId ?? ""}
                  onChange={(e) => setHolidayType(h, e.target.value || null)}
                >
                  <option value="">No type</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {canEdit && (
                  <button
                    onClick={() => removeHoliday(h.id)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Remove
                  </button>
                )}
                </div>
              </div>
            ))}
          </div>
        </ScrollContainer>
      )}
    </CollapsibleSection>
  );
}

// ─── Holiday Types (card #210) ──────────────────────────────────────────────

function HolidayTypesSection({ types, setTypes, holidays, setHolidays, onTypeDeleted }: {
  types: HolidayTypeData[]; setTypes: React.Dispatch<React.SetStateAction<HolidayTypeData[]>>;
  holidays: Holiday[]; setHolidays: React.Dispatch<React.SetStateAction<Holiday[]>>; onTypeDeleted: () => void;
}) {
  const canEdit = useCanEdit();
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const sorted = [...types].sort((a, b) => a.name.localeCompare(b.name));

  async function call(method: string, body: unknown): Promise<HolidayTypeData | null> {
    setStatus("saving");
    setError("");
    const res = await fetch("/api/settings/holiday-types", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      setError(saveErrorMessage(res.status, await res.text()));
      setStatus("error");
      return null;
    }
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
    return method === "DELETE" ? null : ((await res.json()) as HolidayTypeData);
  }
  async function add() {
    const name = newName.trim();
    if (!name) return;
    const t = await call("POST", { name });
    if (t) { setTypes((cur) => [...cur, t]); setNewName(""); }
  }
  async function rename(t: HolidayTypeData) {
    const name = (drafts[t.id] ?? t.name).trim();
    if (name === t.name) return;
    const saved = await call("PATCH", { id: t.id, name });
    if (saved) setTypes((cur) => cur.map((x) => (x.id === t.id ? saved : x)));
    setDrafts((d) => { const n = { ...d }; delete n[t.id]; return n; });
  }
  async function remove(t: HolidayTypeData) {
    const used = holidays.filter((h) => h.holidayTypeId === t.id).length;
    if (!confirm(`Delete the holiday type "${t.name}"? Its holiday rules are deleted too, and ${used} holiday${used === 1 ? "" : "s"} in the list will have no type.`)) return;
    setStatus("saving");
    const res = await fetch("/api/settings/holiday-types", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id }) });
    if (!res.ok) { setError(saveErrorMessage(res.status, await res.text())); setStatus("error"); return; }
    setTypes((cur) => cur.filter((x) => x.id !== t.id));
    setHolidays((cur) => cur.map((h) => (h.holidayTypeId === t.id ? { ...h, holidayTypeId: null } : h)));
    onTypeDeleted();
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <CollapsibleSection
      id="holiday-types"
      title="Holiday Types"
      description="What each holiday is, so a rule applies to it every year (for example Thanksgiving Day). Each holiday in the list above has a type."
      status={status}
      error={error}
    >
      {canEdit && (
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            maxLength={60}
            placeholder="New holiday type"
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm flex-1 max-w-xs"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button onClick={add} disabled={!newName.trim()} className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors">Add</button>
        </div>
      )}
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-500 italic">No holiday types</p>
      ) : (
        <ScrollContainer maxClass="max-h-[320px]">
          <div className="space-y-1">
            {sorted.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 py-1 px-3 rounded hover:bg-slate-700/30">
                <input
                  aria-label={`Name of ${t.name}`}
                  disabled={!canEdit}
                  maxLength={60}
                  className="bg-transparent border border-transparent hover:border-slate-600 focus:border-slate-500 rounded px-2 py-0.5 text-sm text-slate-200 flex-1 max-w-sm disabled:opacity-80"
                  value={drafts[t.id] ?? t.name}
                  onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                  onBlur={() => rename(t)}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
                <span className="text-xs text-slate-500">{holidays.filter((h) => h.holidayTypeId === t.id).length} in the list</span>
                {canEdit && <button onClick={() => remove(t)} className="text-xs text-red-400 hover:text-red-300 transition-colors">Delete</button>}
              </div>
            ))}
          </div>
        </ScrollContainer>
      )}
    </CollapsibleSection>
  );
}

// ─── Holiday Rules (card #210) ──────────────────────────────────────────────

type RuleDraft = { key: string; id?: string; name: string; holidayTypeId: string; days: { offset: number; shiftTypeId: string }[] };
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let ruleDraftSeq = 0;
const EMPTY_HOLIDAY_RULES = { version: holidayRulesVersion([]), rules: [] as HolidayRuleSpec[] };
const toDrafts = (rules: HolidayRuleSpec[]): RuleDraft[] =>
  rules.map((r) => ({ key: r.id, id: r.id, name: r.name, holidayTypeId: r.holidayTypeId, days: r.days.map((d) => ({ ...d })) }));

function HolidayRulesSection({ initial, reloadKey, types, holidays, shiftTypes, dateFormat }: {
  initial: { version: string; rules: HolidayRuleSpec[] }; reloadKey: number; types: HolidayTypeData[];
  holidays: Holiday[]; shiftTypes: ShiftType[]; dateFormat: DateFormatKey;
}) {
  const { zone } = useTimeZone();
  const canEdit = useCanEdit();
  const [saved, setSaved] = useState(initial);
  const [drafts, setDrafts] = useState<RuleDraft[]>(() => toDrafts(initial.rules));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const dirty = JSON.stringify(drafts.map(({ key: _k, ...r }) => r)) !== JSON.stringify(toDrafts(saved.rules).map(({ key: _k, ...r }) => r));

  // A deleted holiday type took its rules with it: re-read the saved rules (and drop the draft).
  useEffect(() => {
    if (reloadKey === 0) return;
    let live = true;
    fetch("/api/settings/holiday-rules").then(async (res) => {
      if (!live || !res.ok) return;
      const next = (await res.json()) as { version: string; rules: HolidayRuleSpec[] };
      if (!live) return;
      setSaved(next);
      setDrafts(toDrafts(next.rules));
    }).catch(() => {});
    return () => { live = false; };
  }, [reloadKey]);

  const workShifts = shiftTypes.filter((s) => !s.isOffShift && !s.isLeave);
  const codeOf = (id: string) => shiftTypes.find((s) => s.id === id)?.code ?? "?";
  const today = dateInZone(new Date(), zone); // card #348: the Settings time zone, not UTC
  const preview = (r: RuleDraft): string | null => {
    const next = holidays.filter((h) => h.holidayTypeId === r.holidayTypeId && h.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!next || r.days.length === 0) return null;
    const [g] = buildHolidayGroups([{ date: next.date, holidayTypeId: r.holidayTypeId }], [{ id: "p", name: r.name, holidayTypeId: r.holidayTypeId, days: r.days }]);
    if (!g) return null;
    return g.slots.map((s) => `${WEEKDAY_SHORT[new Date(s.date + "T12:00:00").getDay()]} ${formatDateStr(s.date, dateFormat)} ${codeOf(s.shiftTypeId)}`).join(" + ");
  };
  const update = (key: string, fn: (r: RuleDraft) => RuleDraft) => setDrafts((cur) => cur.map((r) => (r.key === key ? fn(r) : r)));

  function addRule() {
    const typeId = types[0]?.id ?? "";
    const shiftId = workShifts[0]?.id ?? "";
    setDrafts((cur) => [...cur, { key: `new-${++ruleDraftSeq}`, name: "", holidayTypeId: typeId, days: [{ offset: 0, shiftTypeId: shiftId }, { offset: 1, shiftTypeId: shiftId }] }]);
  }
  async function save() {
    setStatus("saving");
    setError("");
    const res = await fetch("/api/settings/holiday-rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseVersion: saved.version, rules: drafts.map((r) => ({ id: r.id, name: r.name, holidayTypeId: r.holidayTypeId, days: r.days })) }),
    });
    if (!res.ok) {
      setError(saveErrorMessage(res.status, await res.text()));
      setStatus("error");
      return;
    }
    const next = (await res.json()) as { version: string; rules: HolidayRuleSpec[] };
    setSaved(next);
    setDrafts(toDrafts(next.rules));
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  }

  const weekendPaired = shiftTypes.filter((s) => s.weekendPaired && s.holidayWeekendPaired);
  return (
    <CollapsibleSection
      id="holiday-rules"
      title="Holiday Rules"
      description="Days around a holiday that go to the same person. Each rule has a name you choose, the holiday it belongs to, and its days counted from the holiday (0 = the holiday, 1 = the day after, -1 = the day before), each with its shift. The scheduler keeps them together unless someone changes them by hand."
      status={status}
      error={error}
    >
      {drafts.length === 0 && <p className="text-sm text-slate-500 italic mb-3">No holiday rules</p>}
      <div className="space-y-3">
        {drafts.map((r) => {
          const pv = preview(r);
          return (
            <div key={r.key} className="border border-slate-700 rounded p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Rule name"
                  disabled={!canEdit}
                  maxLength={RULE_NAME_MAX}
                  placeholder="Rule name (for example Thanksgiving 1)"
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm flex-1 min-w-[12rem] max-w-xs disabled:opacity-50"
                  value={r.name}
                  onChange={(e) => update(r.key, (x) => ({ ...x, name: e.target.value }))}
                />
                <select
                  aria-label="Holiday"
                  disabled={!canEdit}
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm disabled:opacity-50"
                  value={r.holidayTypeId}
                  onChange={(e) => update(r.key, (x) => ({ ...x, holidayTypeId: e.target.value }))}
                >
                  {!types.some((t) => t.id === r.holidayTypeId) && <option value="">Choose a holiday</option>}
                  {[...types].sort((a, b) => a.name.localeCompare(b.name)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {canEdit && <button onClick={() => setDrafts((cur) => cur.filter((x) => x.key !== r.key))} className="text-xs text-red-400 hover:text-red-300 ml-auto">Remove rule</button>}
              </div>
              {r.days.map((d, i) => (
                <div key={i} className="flex items-center gap-2 pl-2">
                  <span className="text-xs text-slate-400 w-10">Day</span>
                  <DecimalField
                    aria-label="Days from the holiday"
                    integer
                    required
                    allowNegative
                    min={RULE_OFFSET_MIN}
                    max={RULE_OFFSET_MAX}
                    disabled={!canEdit}
                    className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-sm text-center disabled:opacity-50"
                    value={d.offset}
                    onValueChange={(v) => v != null && update(r.key, (x) => ({ ...x, days: x.days.map((y, j) => (j === i ? { ...y, offset: v } : y)) }))}
                  />
                  <select
                    aria-label="Shift"
                    disabled={!canEdit}
                    className="bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-sm disabled:opacity-50"
                    value={d.shiftTypeId}
                    onChange={(e) => update(r.key, (x) => ({ ...x, days: x.days.map((y, j) => (j === i ? { ...y, shiftTypeId: e.target.value } : y)) }))}
                  >
                    {!workShifts.some((s) => s.id === d.shiftTypeId) && <option value={d.shiftTypeId}>{codeOf(d.shiftTypeId)}</option>}
                    {workShifts.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
                  </select>
                  {canEdit && r.days.length > 2 && (
                    <button onClick={() => update(r.key, (x) => ({ ...x, days: x.days.filter((_, j) => j !== i) }))} className="text-xs text-slate-400 hover:text-red-300">Remove day</button>
                  )}
                </div>
              ))}
              {canEdit && (
                <button
                  onClick={() => update(r.key, (x) => ({ ...x, days: [...x.days, { offset: Math.min(RULE_OFFSET_MAX, Math.max(...x.days.map((y) => y.offset)) + 1), shiftTypeId: x.days[x.days.length - 1]?.shiftTypeId ?? workShifts[0]?.id ?? "" }] }))}
                  className="text-xs text-blue-300 hover:text-blue-200 pl-2"
                >
                  + Add a day
                </button>
              )}
              <p className="text-xs text-slate-400 pl-2">{pv ? `Next: ${pv}` : "No upcoming holiday of this type in the list."}</p>
            </div>
          );
        })}
      </div>
      {canEdit && (
        <div className="flex items-center gap-2 mt-3">
          <button onClick={addRule} disabled={types.length === 0} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded transition-colors text-slate-300">+ Add rule</button>
          <button onClick={save} disabled={!dirty} className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors">Save rules</button>
          {dirty && <button onClick={() => setDrafts(toDrafts(saved.rules))} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">Discard changes</button>}
        </div>
      )}
      <p className="text-xs text-slate-500 mt-4">
        {weekendPaired.length > 0
          ? `Also kept together: ${weekendPaired.map((s) => s.code).join(", ")} on a Friday or Monday holiday and its weekend (the shift's "Holiday weekend paired" setting under Shift Types).`
          : `A shift's "Holiday weekend paired" setting (under Shift Types) keeps a Friday or Monday holiday with its weekend.`}
      </p>
    </CollapsibleSection>
  );
}

// ─── Shift Desirability Section ─────────────────────────────────────────────

const WEEKDAY_KEYS = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_LABELS: Record<number, string> = {
  0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat",
};
const WEIGHT_LABELS: Record<number, string> = {
  [-5]: "Terrible", [-4]: "Very Bad", [-3]: "Bad", [-2]: "Poor", [-1]: "Slightly Bad",
  0: "",
  1: "Slightly Good", 2: "Fair", 3: "Good", 4: "Very Good", 5: "Great",
};
const WEIGHT_BG: Record<number, string> = {
  [-5]: "bg-red-900/60", [-4]: "bg-red-900/50", [-3]: "bg-red-900/40", [-2]: "bg-red-900/30", [-1]: "bg-red-900/20",
  0: "",
  1: "bg-emerald-900/20", 2: "bg-emerald-900/30", 3: "bg-emerald-900/40", 4: "bg-emerald-900/50", 5: "bg-emerald-900/60",
};

function DesirabilitySection({
  initial,
  shiftTypes,
  pushUndo,
}: {
  initial: DesirabilityWeight[];
  shiftTypes: ShiftType[];
  pushUndo: (a: UndoAction) => void;
}) {
  const canEdit = useCanEdit();
  const workShifts = shiftTypes.filter((st) => st.category === "work");

  const [grid, setGrid] = useState(() => {
    const map: Record<string, number> = {};
    for (const w of initial) map[`${w.shiftTypeId}:${w.dayOfWeek}`] = w.weight;
    return map;
  });
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  function getWeight(shiftTypeId: string, day: number): number {
    return grid[`${shiftTypeId}:${day}`] ?? 0;
  }

  function setWeight(shiftTypeId: string, day: number, weight: number) {
    setGrid((prev) => ({ ...prev, [`${shiftTypeId}:${day}`]: weight }));
  }

  async function save() {
    const prevGrid = { ...grid };
    setStatus("saving");
    try {
      const weights = workShifts.flatMap((st) =>
        WEEKDAY_KEYS.map((day) => ({
          shiftTypeId: st.id,
          dayOfWeek: day,
          weight: getWeight(st.id, day),
        }))
      );
      const res = await fetch("/api/settings/desirability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weights }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
      pushUndo({
        label: "Updated desirability weights",
        execute: async () => {
          const oldWeights = workShifts.flatMap((st) =>
            WEEKDAY_KEYS.map((day) => ({
              shiftTypeId: st.id,
              dayOfWeek: day,
              weight: prevGrid[`${st.id}:${day}`] ?? 0,
            }))
          );
          await fetch("/api/settings/desirability", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ weights: oldWeights }),
          });
          setGrid(prevGrid);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  return (
    <CollapsibleSection
      id="shift-desirability"
      title="Shift Desirability"
      description="Rate how desirable each shift is per day of week. Used by the equity engine and auto-scheduler."
      status={status}
      error={error}
    >
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr>
              <th className="text-left py-2 px-3 text-xs text-slate-400 font-medium w-24">Shift</th>
              {WEEKDAY_KEYS.map((day) => (
                <th key={day} className="py-2 px-1 text-center text-xs text-slate-400 font-medium w-[72px]">
                  {WEEKDAY_LABELS[day]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {workShifts.map((st) => (
              <tr key={st.id}>
                <td className="py-1.5 px-3">
                  <span className="font-mono font-bold text-sm" style={{ color: st.color }}>{st.code}</span>
                  <span className="ml-2 text-xs text-slate-500">{st.name}</span>
                </td>
                {WEEKDAY_KEYS.map((day) => {
                  const w = getWeight(st.id, day);
                  return (
                    <td key={day} className={`py-1.5 px-1 text-center ${WEIGHT_BG[w] ?? ""}`}>
                      <select
                        disabled={!canEdit}
                        className="bg-transparent border border-slate-600 rounded px-1.5 py-0.5 text-xs text-center cursor-pointer hover:border-slate-400 transition-colors w-14 disabled:opacity-50 disabled:cursor-not-allowed"
                        value={w}
                        onChange={(e) => setWeight(st.id, day, parseInt(e.target.value))}
                        title={WEIGHT_LABELS[w] || "Neutral"}
                      >
                        <option value={-5}>-5</option>
                        <option value={-4}>-4</option>
                        <option value={-3}>-3</option>
                        <option value={-2}>-2</option>
                        <option value={-1}>-1</option>
                        <option value={0}>0</option>
                        <option value={1}>+1</option>
                        <option value={2}>+2</option>
                        <option value={3}>+3</option>
                        <option value={4}>+4</option>
                        <option value={5}>+5</option>
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4 mt-4">
        {canEdit && (
          <button
            onClick={save}
            className="px-4 py-2 text-sm bg-blue-700 hover:bg-blue-600 rounded transition-colors font-medium"
          >
            Save Desirability
          </button>
        )}
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="inline-block w-3 h-3 rounded bg-red-900/60" /> Terrible (-5)
          <span className="inline-block w-3 h-3 rounded bg-red-900/30" /> Poor (-2)
          <span className="inline-block w-3 h-3 rounded border border-slate-600" /> Neutral (0)
          <span className="inline-block w-3 h-3 rounded bg-emerald-900/30" /> Fair (+2)
          <span className="inline-block w-3 h-3 rounded bg-emerald-900/60" /> Great (+5)
        </div>
      </div>
    </CollapsibleSection>
  );
}

// ─── Auto-Generation Priority (drag-to-reorder, Slice 1 / #252) ──────────────

type AutoGenFactorData = {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  enabled: boolean;
  hardness: string;
  hoursPolicy: HoursPolicy; // meaningful only on overHours / underHours
};

type AutoGenProfileData = {
  id: string;
  name: string;
  order: string[];
  createdByName: string;
  createdAt: string; // ISO
};

const sameOrder = (a: AutoGenFactorData[], b: AutoGenFactorData[]) =>
  a.length === b.length && a.every((f, i) => f.key === b[i].key);

// Same pay-period hours policies on the two hours rows (order-independent).
const samePolicies = (a: AutoGenFactorData[], b: AutoGenFactorData[]) =>
  HOURS_POLICY_KEYS.every((k) => a.find((f) => f.key === k)?.hoursPolicy === b.find((f) => f.key === k)?.hoursPolicy);

const HOURS_POLICY_LABELS: Record<HoursPolicy, { label: string; hint: string }> = {
  prohibited: { label: "Prohibited", hint: "Never crossed, wherever it sits in the list; a gap it causes is flagged instead. If both hours rows are Prohibited and they collide, the higher one wins." },
  discouraged: { label: "Discouraged", hint: "Anything ranked above it may push past it; each time is flagged." },
  allowed: { label: "Allowed", hint: "Doesn't block anything." },
};

// Format a save stamp as `YYYY-MM-DD HH:mm ZZZ`, 24-hour, in the Settings time zone (card #320).
function formatProfileStamp(iso: string, zone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const w = wallClock(d, zone);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${p(w.month)}-${p(w.day)} ${formatClock(d, zone)}`;
}

// Surfaces the order auto-generation applies its factors and the constraints it can
// never trade away. The pinned constraints stay read-only; an admin can drag the
// negotiable factors to re-rank them. Reordering changes how schedules are GRADED
// (multi-option selection + Live re-solve) AND, since Slice 2b, how the builder places
// shifts (coverage may exceed soft hours / a hard max when ranked above them).
//
// Reordering is STAGED, not auto-saved (#252): a drag only edits a local draft, and the
// new order reaches the engine only after an explicit Save — this guards against a stray
// drag silently changing department-wide scheduling. Named profiles snapshot the current
// order (stamped with who saved it and when) so an arrangement can be restored later.
// Label/description come from FACTOR_META; order + enabled state are the live DB rows.
function AutoGenPrioritySection({
  initial,
  initialProfiles,
  canEdit,
}: {
  initial: AutoGenFactorData[];
  initialProfiles: AutoGenProfileData[];
  // Editing the priority order is gated by its own admin-level permission
  // (settings:autogen-priority), independent of the general settings:edit context.
  canEdit: boolean;
}) {
  const { zone } = useTimeZone(); // card #320
  const [factors, setFactors] = useState(initial); // working draft
  const [savedFactors, setSavedFactors] = useState(initial); // last persisted order
  const [profiles, setProfiles] = useState(initialProfiles);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [profileName, setProfileName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const dirty = !sameOrder(factors, savedFactors) || !samePolicies(factors, savedFactors);

  function setPolicy(key: string, policy: HoursPolicy) {
    setFactors((prev) => prev.map((f) => (f.key === key ? { ...f, hoursPolicy: policy } : f)));
  }

  function metaFor(f: AutoGenFactorData): FactorMeta {
    return FACTOR_META[f.key] ?? { label: f.label, description: "" };
  }

  // Commit the staged order. The active order is only ever changed here (and the engine
  // only reads AutoGenFactor.sortOrder), so nothing takes effect until the admin saves.
  async function save() {
    setStatus("saving");
    setError("");
    try {
      const res = await fetch("/api/settings/autogen-factors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: factors.map((f) => f.key),
          policies: Object.fromEntries(
            factors.filter((f) => isHoursPolicyKey(f.key)).map((f) => [f.key, f.hoursPolicy]),
          ),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const saved: AutoGenFactorData[] = ((await res.json()) as (Omit<AutoGenFactorData, "hoursPolicy"> & { hoursPolicy: unknown })[])
        .map((f) => ({ ...f, hoursPolicy: parseHoursPolicy(f.hoursPolicy) }));
      setFactors(saved);
      setSavedFactors(saved);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setStatus("error");
    }
  }

  function cancel() {
    setFactors(savedFactors);
    setStatus("idle");
    setError("");
  }

  // Apply a saved profile into the DRAFT only (staged) — the admin still has to Save to
  // activate it. reconcileOrder keeps this safe if the factor catalog has since changed.
  function applyProfile(p: AutoGenProfileData) {
    // Profiles snapshot the ORDER only; the hours policies in the draft are kept as they are.
    const order = reconcileOrder(p.order, factors.map((f) => f.key));
    const byKey = new Map(factors.map((f) => [f.key, f]));
    setFactors(order.map((k) => byKey.get(k)!));
    setStatus("idle");
    setError("");
  }

  async function saveAsProfile() {
    const name = profileName.trim();
    if (!name || savingProfile) return;
    setSavingProfile(true);
    setError("");
    try {
      const res = await fetch("/api/settings/autogen-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, order: factors.map((f) => f.key) }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created: AutoGenProfileData = await res.json();
      setProfiles((prev) => [created, ...prev]);
      setProfileName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile");
      setStatus("error");
    } finally {
      setSavingProfile(false);
    }
  }

  async function deleteProfile(id: string, name: string) {
    if (!confirm(`Delete the priority profile "${name}"? This cannot be undone.`)) return;
    const prev = profiles;
    setProfiles((p) => p.filter((x) => x.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/settings/autogen-profiles/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      setProfiles(prev); // roll back
      setError(e instanceof Error ? e.message : "Failed to delete profile");
      setStatus("error");
    }
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current !== null && dragIdx.current !== idx) setDragOverIdx(idx);
  }

  function handleDrop(idx: number) {
    const from = dragIdx.current;
    dragIdx.current = null;
    setDragOverIdx(null);
    // Drag only edits the local draft now — no network write. Save/Cancel control the
    // commit (#252), so a stray drag is harmless until the admin explicitly saves.
    if (status === "saving" || from === null || from === idx) return;
    const reordered = [...factors];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(idx, 0, moved);
    setFactors(reordered);
  }

  return (
    <CollapsibleSection
      id="autogen-priority"
      title="Auto-Generation Priority"
      description="How auto-generation decides what to schedule when goals compete. Higher items win — a factor is never traded away to improve one below it. Drag to re-rank, then Save."
      status={status}
      error={error}
    >

      {!canEdit && (
        <p className="mt-3 px-3 py-2 bg-slate-900/40 border border-slate-700/50 rounded text-xs text-slate-400">
          🔒 Admin only — you can view the priority order but not change it.
        </p>
      )}

      <div className="mt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Always enforced
        </h3>
        <div className="space-y-1.5">
          {PINNED_CONSTRAINTS.map((c) => (
            <div
              key={c.key}
              className="flex items-start gap-3 bg-slate-900/40 border border-slate-700/40 rounded-lg px-4 py-2"
            >
              <span className="text-slate-500 mt-[1px] shrink-0" title="Pinned — not reorderable">🔒</span>
              <div className="min-w-0">
                <span className="text-sm text-slate-200 font-medium">{c.label}</span>
                <p className="text-xs text-slate-500 mt-0.5">{c.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Priority order
        </h3>
        <div className="space-y-1.5">
          {factors.map((f, idx) => {
            const meta = metaFor(f);
            return (
              <div
                key={f.key}
                draggable={canEdit && status !== "saving"}
                onDragStart={() => { dragIdx.current = idx; }}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                onDragEnd={() => { dragIdx.current = null; setDragOverIdx(null); }}
                className={[
                  "flex items-start gap-3 bg-slate-700/30 border rounded-lg px-4 py-2.5 transition-colors",
                  dragOverIdx === idx ? "border-blue-500" : "border-slate-600/50",
                  !canEdit ? "" : status === "saving" ? "cursor-wait opacity-70" : "cursor-grab active:cursor-grabbing",
                ].join(" ")}
              >
                {canEdit && (
                  <span className="shrink-0 text-slate-500 mt-[2px] select-none" title="Drag to reorder">⋮⋮</span>
                )}
                <span className="shrink-0 w-6 h-6 rounded-full bg-slate-800 border border-slate-600 text-xs text-slate-300 flex items-center justify-center font-semibold mt-[1px]">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-slate-200 font-medium">
                    {isHoursPolicyKey(f.key) && f.hoursPolicy === "prohibited" && (
                      <span className="mr-1" title="Prohibited — never crossed, wherever it sits">🔒</span>
                    )}
                    {meta.label}
                  </span>
                  {meta.description && <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>}
                  {isHoursPolicyKey(f.key) && (
                    <p className="text-xs text-slate-400 mt-0.5">{HOURS_POLICY_LABELS[f.hoursPolicy].hint}</p>
                  )}
                </div>
                {isHoursPolicyKey(f.key) && (
                  <select
                    value={f.hoursPolicy}
                    disabled={!canEdit || status === "saving"}
                    onChange={(e) => setPolicy(f.key, parseHoursPolicy(e.target.value))}
                    // Keep a drag from starting on the control.
                    onMouseDown={(e) => e.stopPropagation()}
                    draggable={false}
                    aria-label={`${meta.label} policy`}
                    className="shrink-0 px-2 py-1 rounded-md text-xs bg-slate-900/60 border border-slate-600 text-slate-200 focus:outline-none focus:border-blue-500 disabled:opacity-60"
                  >
                    {HOURS_POLICIES.map((p) => (
                      <option key={p} value={p}>{HOURS_POLICY_LABELS[p].label}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>

        {canEdit && (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={save}
              disabled={!dirty || status === "saving"}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
            >
              {status === "saving" ? "Saving…" : "Save"}
            </button>
            <button
              onClick={cancel}
              disabled={!dirty || status === "saving"}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
            {dirty && <span className="text-xs text-amber-400">Unsaved changes — Save to apply.</span>}
          </div>
        )}
      </div>

      {/* Named profiles — snapshot/restore the order, stamped with who saved it and when (#252) */}
      <div className="mt-6 border-t border-slate-700/50 pt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Saved profiles
        </h3>

        {canEdit && (
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveAsProfile(); }}
              placeholder="Name this priority order…"
              maxLength={MAX_PROFILE_NAME_LENGTH}
              className="flex-1 min-w-0 px-3 py-1.5 rounded-md text-sm bg-slate-900/60 border border-slate-600 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={saveAsProfile}
              disabled={!profileName.trim() || savingProfile}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {savingProfile ? "Saving…" : "Save as profile"}
            </button>
          </div>
        )}

        {profiles.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No saved profiles yet.</p>
        ) : (
          <div className="space-y-1.5">
            {profiles.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 bg-slate-700/30 border border-slate-600/50 rounded-lg px-4 py-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-slate-200 font-medium truncate">{p.name}</span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Saved by {p.createdByName} · {formatProfileStamp(p.createdAt, zone)}
                  </p>
                </div>
                {canEdit && (
                  <>
                    <button
                      onClick={() => applyProfile(p)}
                      className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-700 hover:bg-blue-600 text-slate-200 transition-colors shrink-0"
                      title="Load this order into the list (you still need to Save to apply)"
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => deleteProfile(p.id, p.name)}
                      className="px-2.5 py-1 rounded-md text-xs font-medium text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors shrink-0"
                      title="Delete profile"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500 italic border-t border-slate-700/50 pt-3">
        {PRIORITY_ROADMAP_NOTE}
      </p>
    </CollapsibleSection>
  );
}

// ─── Scheduling Preferences Section ─────────────────────────────────────────

// Equity factors are linked to the shift's ID. `shifts` is the page's shared shift list, so a
// rename in Shift Types shows in a factor's label at once; saves send ids only.
function EquityFactorsSection({
  initial,
  shifts,
}: {
  initial: EquityFactorData[];
  shifts: ShiftType[];
}) {
  const canEdit = useCanEdit();
  const [factors, setFactors] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  // Only working shifts can carry an equity factor (off/leave shifts never did).
  const pickable = shifts.filter((st) => !st.isOffShift && !st.isLeave);
  const codeOf = (id: string | null) => (id ? shifts.find((st) => st.id === id)?.code ?? "?" : "?");

  function factorLabel(f: EquityFactorData): string {
    if (f.factorType === "desirability") return "Shift Desirability";
    if (f.factorType === "holiday") return "Holiday Work";
    if (f.factorType === "shift") return `${codeOf(f.shiftTypeId)} Count`;
    return f.factorType;
  }

  function updateFactor(idx: number, updates: Partial<EquityFactorData>) {
    setFactors((prev) => prev.map((f, i) => (i === idx ? { ...f, ...updates } : f)));
  }

  function removeFactor(idx: number) {
    setFactors((prev) => prev.filter((_, i) => i !== idx));
  }

  function addShiftFactor() {
    const usedIds = new Set(factors.filter((f) => f.factorType === "shift").map((f) => f.shiftTypeId));
    const available = pickable.filter((st) => !usedIds.has(st.id));
    if (available.length === 0) return;
    setFactors((prev) => [
      ...prev,
      { id: "", factorType: "shift", shiftTypeId: available[0].id, shiftCode: available[0].code, weight: 1.0, enabled: true, sortOrder: prev.length },
    ]);
  }

  function addBuiltinFactor(type: "desirability" | "holiday") {
    if (factors.some((f) => f.factorType === type)) return;
    setFactors((prev) => [
      ...prev,
      { id: "", factorType: type, shiftTypeId: null, shiftCode: null, weight: 1.0, enabled: true, sortOrder: prev.length },
    ]);
  }

  async function save() {
    setStatus("saving");
    try {
      // Ids only — the code is display state and never travels in a write (a server could
      // resolve a renamed-and-reused code to the wrong shift). A pre-slice server has no
      // such route and answers 404: the message asks for a reload, nothing changes.
      const res = await fetch(EQUITY_FACTORS_SAVE_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildEquityFactorsSave(factors)),
      });
      if (!res.ok) throw new Error(equitySaveErrorMessage(res.status, await res.text()));
      const saved = await res.json();
      setFactors(saved);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  const totalWeight = factors.filter((f) => f.enabled).reduce((s, f) => s + f.weight, 0) || 1;
  const usedShiftIds = new Set(factors.filter((f) => f.factorType === "shift").map((f) => f.shiftTypeId));
  const canAddShift = pickable.some((st) => !usedShiftIds.has(st.id));
  const hasDesirability = factors.some((f) => f.factorType === "desirability");
  const hasHoliday = factors.some((f) => f.factorType === "holiday");

  return (
    <CollapsibleSection
      id="equity-factors"
      title="Equity Factors"
      description="Configure which metrics factor into the equity score and their relative weights. All values are FTE-normalized."
      status={status}
      error={error}
    >
      <div className="mt-4 space-y-2">
        {factors.map((f, idx) => (
          <div key={idx} className="flex items-center gap-3 bg-slate-700/30 border border-slate-600/50 rounded-lg px-4 py-2.5">
            <button
              onClick={() => canEdit && updateFactor(idx, { enabled: !f.enabled })}
              className={[
                "w-8 h-[20px] rounded-full transition-colors shrink-0 relative",
                f.enabled ? "bg-blue-600" : "bg-slate-600",
                !canEdit ? "opacity-50 cursor-not-allowed" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "absolute top-[2px] left-[2px] w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                  f.enabled ? "translate-x-[14px]" : "translate-x-0",
                ].join(" ")}
              />
            </button>

            <div className="flex-1 min-w-0">
              {f.factorType === "shift" ? (
                <select
                  disabled={!canEdit}
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-sm text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  value={f.shiftTypeId ?? ""}
                  onChange={(e) => updateFactor(idx, { shiftTypeId: e.target.value, shiftCode: codeOf(e.target.value) })}
                >
                  {f.shiftTypeId && !pickable.some((st) => st.id === f.shiftTypeId) && (
                    <option value={f.shiftTypeId}>{codeOf(f.shiftTypeId)} Count</option>
                  )}
                  {pickable.map((st) => (
                    <option key={st.id} value={st.id} disabled={usedShiftIds.has(st.id) && st.id !== f.shiftTypeId}>
                      {st.code} Count
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-slate-200 font-medium">{factorLabel(f)}</span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-slate-500">Weight:</span>
              <DecimalField
                aria-label="Factor weight"
                required
                min={0.1}
                max={10}
                decimals={2}
                disabled={!canEdit}
                className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-sm text-center text-slate-200 disabled:opacity-50"
                value={f.weight}
                onValueChange={(v) => { if (v != null) updateFactor(idx, { weight: v }); }}
              />
              <span className="text-[10px] text-slate-500 w-10 text-right">
                {f.enabled ? `${((f.weight / totalWeight) * 100).toFixed(0)}%` : "off"}
              </span>
            </div>

            {canEdit && (
              <button
                onClick={() => removeFactor(idx)}
                className="text-slate-600 hover:text-red-400 transition-colors text-sm"
                title="Remove factor"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {canEdit && canAddShift && (
          <button
            onClick={addShiftFactor}
            className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded transition-colors text-slate-300"
          >
            + Shift code
          </button>
        )}
        {canEdit && !hasDesirability && (
          <button
            onClick={() => addBuiltinFactor("desirability")}
            className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded transition-colors text-slate-300"
          >
            + Shift Desirability
          </button>
        )}
        {canEdit && !hasHoliday && (
          <button
            onClick={() => addBuiltinFactor("holiday")}
            className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded transition-colors text-slate-300"
          >
            + Holiday Work
          </button>
        )}
        <div className="flex-1" />
        {canEdit && (
          <button
            onClick={save}
            disabled={status === "saving"}
            className="px-4 py-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors font-medium"
          >
            {status === "saving" ? "Saving..." : "Save"}
          </button>
        )}
      </div>
    </CollapsibleSection>
  );
}

// Card #320: the one time zone every time in YoSched is shown and asked in. Until one is saved,
// YoSched works in UTC (as before) and this asks for one, suggesting this computer's zone; nothing
// is saved until Save. Saving converts the automatic backup time so the next backup keeps its moment.
function TimeZoneSection() {
  const canEdit = useCanEdit();
  const tz = useTimeZone();
  const choices = useMemo(() => zoneChoices(), []);
  const browserZone = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } }, []);
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const shown = draft ?? tz.storedZone ?? (choices.includes(browserZone) ? browserZone : "UTC");
  const dirty = tz.loaded && shown !== tz.storedZone;

  async function save() {
    setStatus("saving"); setError("");
    try {
      const res = await fetch("/api/settings/time-zone", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeZone: shown, zoneAtLoad: tz.storedZone }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; autoTime?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? `The server answered ${res.status}`); setStatus("error");
        if (res.status === 409) { setDraft(null); await tz.refresh(); }
        return;
      }
      setDraft(null);
      window.dispatchEvent(new Event(TIME_ZONE_EVENT)); // every open part of this tab rereads the zone
      setStatus("saved"); setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed"); setStatus("error");
    }
  }

  return (
    <CollapsibleSection
      id="time-zone"
      title="Time Zone"
      description="Every time YoSched shows or asks for (backups, requests, printouts, logins, versions) is in this zone."
      status={status}
      error={error}
    >
      <div className="mt-4 space-y-2 text-sm">
        {tz.loaded && tz.storedZone === null && (
          <p className="text-amber-400">No time zone is chosen yet, so times are in UTC. Choose yours and press Save.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100 disabled:opacity-50"
            value={shown} onChange={(e) => setDraft(e.target.value)} disabled={!canEdit || status === "saving"}
          >
            {choices.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          <span className="text-slate-400">now {formatClock(new Date(), shown)}</span>
          <button type="button" className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-white"
            disabled={!canEdit || !dirty || status === "saving"} onClick={() => void save()}>Save</button>
        </div>
        <p className="text-xs text-slate-500">Changing it keeps the automatic backup at the same moment; its time is shown in the new zone.</p>
      </div>
    </CollapsibleSection>
  );
}

function DateFormatSection({ selected, onChange }: { selected: string; onChange: (fmt: string) => void }) {
  const canEdit = useCanEdit();
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  async function save(format: string) {
    const prev = selected;
    onChange(format);
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFormat: format }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      onChange(prev);
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  return (
    <CollapsibleSection
      id="date-format"
      title="Date Format"
      description="Choose how dates are displayed throughout the application."
      status={status}
      error={error}
    >
      <div className="grid grid-cols-3 gap-2 mt-4">
        {DATE_FORMAT_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => canEdit && save(opt.key)}
            disabled={!canEdit}
            className={[
              "flex items-center justify-between px-4 py-3 rounded-lg border text-sm transition-colors",
              selected === opt.key
                ? "bg-blue-600/20 border-blue-500 text-blue-300"
                : "bg-slate-700/30 border-slate-600/50 text-slate-300 hover:border-slate-500",
              !canEdit ? "disabled:opacity-60 disabled:cursor-not-allowed" : "",
            ].join(" ")}
          >
            <span className="font-medium">{opt.label}</span>
            <span className="text-xs text-slate-500 ml-3">{opt.key}</span>
          </button>
        ))}
      </div>
    </CollapsibleSection>
  );
}

function SchedulingPrefsSection({ initial, shiftTypes }: { initial: SchedulingPrefs; shiftTypes: ShiftType[] }) {
  const canEdit = useCanEdit();
  const [prefs, setPrefs] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  // Leave types offered as LEAVE:<id> rows in the day-off order editor.
  const leaveTypes = useMemo(() => shiftTypes.filter((s) => s.isLeave && !s.isOffShift), [shiftTypes]);

  const [offStatus, setOffStatus] = useState<SaveStatus>("idle");
  async function saveOffOrder(next: string[]) {
    const prev = prefs.defaultOffStrategyOrder;
    setPrefs((p) => ({ ...p, defaultOffStrategyOrder: next }));
    setOffStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultOffStrategyOrder: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      setOffStatus("saved");
      setTimeout(() => setOffStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, defaultOffStrategyOrder: prev }));
      setOffStatus("error");
    }
  }

  async function toggle(key: keyof SchedulingPrefs) {
    const newValue = !prefs[key];
    const prev = { ...prefs };
    setPrefs((p) => ({ ...p, [key]: newValue }));
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: newValue }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setPrefs(prev);
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  const items: { key: keyof SchedulingPrefs; label: string; description: string }[] = [
    { key: "prefer3DayWeekends", label: "Prefer 3-day weekends", description: "Place days off adjacent to weekends when possible" },
    { key: "prefer4DayWeekends", label: "Prefer 4-day weekends", description: "Cluster two days off next to a weekend for longer breaks" },
    { key: "preferSequentialOff", label: "Prefer sequential days off", description: "Group days off together rather than scattering them through the week" },
  ];

  const [modeStatus, setModeStatus] = useState<SaveStatus>("idle");
  async function saveMode(value: PendingRequestMode) {
    const prev = prefs.pendingRequestMode;
    setPrefs((p) => ({ ...p, pendingRequestMode: value }));
    setModeStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingRequestMode: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setModeStatus("saved");
      setTimeout(() => setModeStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, pendingRequestMode: prev }));
      setModeStatus("error");
    }
  }

  const MODE_LABELS: Record<PendingRequestMode, { label: string; hint: string }> = {
    off: { label: "Only approved", hint: "Ignore pending requests entirely" },
    soft: { label: "As preferences", hint: "Honor pending as soft nudges (never hard blocks)" },
    full: { label: "Full strength", hint: "Honor pending exactly like approved requests" },
  };

  const [policyStatus, setPolicyStatus] = useState<SaveStatus>("idle");
  async function savePolicy(value: RequestConflictPolicy) {
    const prev = prefs.requestConflictPolicy;
    setPrefs((p) => ({ ...p, requestConflictPolicy: value }));
    setPolicyStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestConflictPolicy: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setPolicyStatus("saved");
      setTimeout(() => setPolicyStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, requestConflictPolicy: prev }));
      setPolicyStatus("error");
    }
  }

  const [approvalPolicyStatus, setApprovalPolicyStatus] = useState<SaveStatus>("idle");
  async function saveApprovalPolicy(value: ApprovalConflictPolicy) {
    const prev = prefs.approvalConflictPolicy;
    setPrefs((p) => ({ ...p, approvalConflictPolicy: value }));
    setApprovalPolicyStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalConflictPolicy: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setApprovalPolicyStatus("saved");
      setTimeout(() => setApprovalPolicyStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, approvalConflictPolicy: prev }));
      setApprovalPolicyStatus("error");
    }
  }

  // Card #332: the Requests archive settings.
  const [archiveStatus, setArchiveStatus] = useState<SaveStatus>("idle");
  const [archiveDaysText, setArchiveDaysText] = useState(String(prefs.requestArchiveDays));
  async function saveArchive(patch: { requestArchiveDays?: number; archiveLeaveMetBy?: ArchiveLeaveRule }) {
    const prev = { requestArchiveDays: prefs.requestArchiveDays, archiveLeaveMetBy: prefs.archiveLeaveMetBy };
    setPrefs((p) => ({ ...p, ...patch }));
    setArchiveStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await res.text());
      setArchiveStatus("saved");
      setTimeout(() => setArchiveStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, ...prev }));
      setArchiveDaysText(String(prev.requestArchiveDays));
      setArchiveStatus("error");
    }
  }
  function commitArchiveDays() {
    const n = Number(archiveDaysText.trim());
    if (archiveDaysText.trim() === "" || !isValidArchiveDays(n)) {
      setArchiveDaysText(String(prefs.requestArchiveDays));
      return;
    }
    if (n !== prefs.requestArchiveDays) void saveArchive({ requestArchiveDays: n });
  }
  const ARCHIVE_LEAVE_LABELS: Record<ArchiveLeaveRule, { label: string; hint: string }> = {
    exact: { label: "The leave type asked for", hint: "Met only when the person got the leave type they asked for" },
    "any-leave": { label: "Any leave", hint: "Met when the person got any leave type that day" },
    "any-off": { label: "Any day off", hint: "Met when the person was not working that day: any leave, a day off, or nothing scheduled" },
  };

  const APPROVAL_POLICY_LABELS: Record<ApprovalConflictPolicy, { label: string; hint: string }> = {
    "resolve-pp": { label: "Re-arrange the day, then the pay period", hint: "Move auto-placed shifts on the day; if that is not enough, widen to the rest of the pay period. Hand-placed, locked and other approved shifts never move" },
    "resolve-day": { label: "Re-arrange the day only", hint: "Move auto-placed shifts on the requested day only; anything wider flags the request" },
    flag: { label: "Never move anyone — flag it", hint: "A full day never changes; the request stays pending and is marked as needing resolving" },
  };

  const [shareStatus, setShareStatus] = useState<SaveStatus>("idle");
  async function saveShareBasis(value: ShiftShareBasis) {
    const prev = prefs.shiftShareBasis;
    setPrefs((p) => ({ ...p, shiftShareBasis: value }));
    setShareStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftShareBasis: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setShareStatus("saved");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, shiftShareBasis: prev }));
      setShareStatus("error");
    }
  }

  // Card #203: "Count shifts from" — the first day "Keep counts even across months" counts.
  const [balanceStatus, setBalanceStatus] = useState<SaveStatus>("idle");
  async function saveBalanceFrom(value: string | null) {
    const prev = prefs.shiftBalanceFrom ?? null;
    setPrefs((p) => ({ ...p, shiftBalanceFrom: value }));
    setBalanceStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftBalanceFrom: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setBalanceStatus("saved");
      setTimeout(() => setBalanceStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, shiftBalanceFrom: prev }));
      setBalanceStatus("error");
    }
  }

  const [holidayStatus, setHolidayStatus] = useState<SaveStatus>("idle");
  async function saveHolidayPolicy(value: HolidayPolicy) {
    const prev = prefs.holidayPolicy;
    setPrefs((p) => ({ ...p, holidayPolicy: value }));
    setHolidayStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holidayPolicy: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setHolidayStatus("saved");
      setTimeout(() => setHolidayStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, holidayPolicy: prev }));
      setHolidayStatus("error");
    }
  }

  // Card #349: the usual-weekday share (%) for holiday pay.
  const [usualPctStatus, setUsualPctStatus] = useState<SaveStatus>("idle");
  const [usualPctDraft, setUsualPctDraft] = useState<string | null>(null);
  async function saveUsualPct(raw: string) {
    setUsualPctDraft(null);
    const value = Number(raw);
    if (!isHolidayUsualWeekdayPct(value) || value === prefs.holidayUsualWeekdayPct) return;
    const prev = prefs.holidayUsualWeekdayPct;
    setPrefs((p) => ({ ...p, holidayUsualWeekdayPct: value }));
    setUsualPctStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holidayUsualWeekdayPct: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setUsualPctStatus("saved");
      setTimeout(() => setUsualPctStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, holidayUsualWeekdayPct: prev }));
      setUsualPctStatus("error");
    }
  }

  // Card #207: which shift is credited on a holiday (by id).
  const [holidayShiftStatus, setHolidayShiftStatus] = useState<SaveStatus>("idle");
  async function saveHolidayShift(value: string | null) {
    const prev = prefs.holidayShiftId;
    setPrefs((p) => ({ ...p, holidayShiftId: value }));
    setHolidayShiftStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holidayShiftId: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setHolidayShiftStatus("saved");
      setTimeout(() => setHolidayShiftStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, holidayShiftId: prev }));
      setHolidayShiftStatus("error");
    }
  }

  // Card #175: how requested leave is charged.
  const [leaveStatus, setLeaveStatus] = useState<SaveStatus>("idle");
  async function saveLeavePolicy(value: LeavePolicy) {
    const prev = prefs.leaveHoursPolicy;
    setPrefs((p) => ({ ...p, leaveHoursPolicy: value }));
    setLeaveStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveHoursPolicy: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setLeaveStatus("saved");
      setTimeout(() => setLeaveStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, leaveHoursPolicy: prev }));
      setLeaveStatus("error");
    }
  }
  const LEAVE_LABELS: Record<LeavePolicy, { label: string; hint: string }> = {
    "up-to-target": { label: "Up to the hours target", hint: "Leave only on days the person would have worked, and never past their pay-period target; other requested leave days become X (still honored — they are off)" },
    always: { label: "Every requested day", hint: "Leave on every requested day, even a normal day off or past the pay-period target" },
  };

  const HOLIDAY_LABELS: Record<HolidayPolicy, { label: string; hint: string }> = {
    entitlement: { label: "Scheduled workday", hint: "Anyone normally scheduled on the holiday's weekday who is not working gets the holiday shift on that day; it counts toward pay-period hours and replaces a work day. Staff working the holiday keep their shift" },
    fill: { label: "Hours fill only", hint: "The holiday shift only when the hours fill happens to land on the holiday; staff already at target get X" },
    none: { label: "None", hint: "The auto-scheduler never places the holiday shift; a holiday is a plain day off" },
  };

  const SHARE_LABELS: Record<ShiftShareBasis, { label: string; hint: string }> = {
    fte: { label: "Proportional to FTE", hint: "A 0.5 FTE carries half as many CALL/ORC/ORL slots as a 1.0 FTE; matches the FTE-normalized equity report" },
    head: { label: "Equal per person", hint: "Every eligible staffer takes the same number of slots regardless of FTE" },
  };

  const POLICY_LABELS: Record<RequestConflictPolicy, { label: string; hint: string }> = {
    reconcile: { label: "Reconcile (first-come)", hint: "Place requests tentatively; grant each only if conflict-free, earliest request wins a contended slot" },
    "honor-always": { label: "Honor always", hint: "Force every requested shift first and keep it, even past the staffer's hour cap" },
  };

  // Card #75: the starting ticks of the shift activation panel.
  const [activationStatus, setActivationStatus] = useState<SaveStatus>("idle");
  async function saveActivation<K extends "activationWorkedDefault" | "activationNeverDefault" | "activationNewHireDefault">(key: K, value: SchedulingPrefs[K]) {
    const prev = prefs[key];
    setPrefs((p) => ({ ...p, [key]: value }));
    setActivationStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setActivationStatus("saved");
      setTimeout(() => setActivationStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, [key]: prev }));
      setActivationStatus("error");
    }
  }

  const [leapStatus, setLeapStatus] = useState<SaveStatus>("idle");
  async function saveMaxLeave(value: number) {
    const prev = prefs.maxLeavePerDay;
    setPrefs((p) => ({ ...p, maxLeavePerDay: value }));
    setLeapStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxLeavePerDay: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setLeapStatus("saved");
      setTimeout(() => setLeapStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, maxLeavePerDay: prev }));
      setLeapStatus("error");
    }
  }

  const [scopeStatus, setScopeStatus] = useState<SaveStatus>("idle");
  async function saveLiveScope(value: LiveScope) {
    const prev = prefs.defaultLiveScope;
    setPrefs((p) => ({ ...p, defaultLiveScope: value }));
    setScopeStatus("saving");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultLiveScope: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setScopeStatus("saved");
      setTimeout(() => setScopeStatus("idle"), 2000);
    } catch {
      setPrefs((p) => ({ ...p, defaultLiveScope: prev }));
      setScopeStatus("error");
    }
  }
  return (
    <CollapsibleSection
      id="scheduling-preferences"
      title="Scheduling Preferences"
      description="Controls how the auto-scheduler places days off. Staffing requirements are always respected first."
      status={status}
      error={error}
    >
      <div className="space-y-4 mt-4">
        {items.map(({ key, label, description }) => (
          <label key={key} className="flex items-start gap-3 cursor-pointer group">
            <button
              onClick={() => canEdit && toggle(key)}
              className={[
                "mt-0.5 w-10 h-[22px] rounded-full transition-colors shrink-0 relative",
                prefs[key] ? "bg-blue-600" : "bg-slate-600",
                !canEdit ? "opacity-50 cursor-not-allowed" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                  prefs[key] ? "translate-x-[18px]" : "translate-x-0",
                ].join(" ")}
              />
            </button>
            <div>
              <div className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">{label}</div>
              <div className="text-xs text-slate-400">{description}</div>
            </div>
          </label>
        ))}

        <div className="flex items-start gap-3 pt-2 border-t border-slate-700/50">
          <div className="flex-1">
            <div className="text-sm font-medium text-slate-200">Soft leave limit per day</div>
            <div className="text-xs text-slate-400">
              Warn (don&apos;t block) when this many staff already have leave on a date. 0 = no limit.
              {leapStatus === "saving" && <span className="ml-2 text-slate-500">Saving…</span>}
              {leapStatus === "saved" && <span className="ml-2 text-emerald-400">Saved</span>}
              {leapStatus === "error" && <span className="ml-2 text-rose-400">Failed</span>}
            </div>
          </div>
          <DecimalField
            integer
            required
            min={0}
            max={999}
            aria-label="Most people on leave per day"
            value={prefs.maxLeavePerDay}
            disabled={!canEdit}
            onValueChange={(v) => v != null && setPrefs((p) => ({ ...p, maxLeavePerDay: v }))}
            onBlur={() => canEdit && saveMaxLeave(prefs.maxLeavePerDay)}
            className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 text-center focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          />
        </div>

        <div className="pt-2 border-t border-slate-700/50">
          <div className="text-sm font-medium text-slate-200">Default scope of live changes</div>
          <div className="text-xs text-slate-400">
            When you edit a generated schedule, how much of the rest the engine re-solves to compensate. Schedulers can change it per session. &ldquo;Limited&rdquo; disturbs the fewest cells but may leave pay-period hours unbalanced; &ldquo;Pay period&rdquo; rebalances hours.
            {scopeStatus === "saving" && <span className="ml-2 text-slate-500">Saving…</span>}
            {scopeStatus === "saved" && <span className="ml-2 text-emerald-400">Saved</span>}
            {scopeStatus === "error" && <span className="ml-2 text-rose-400">Failed</span>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {LIVE_SCOPES.map((scope) => (
              <button
                key={scope}
                onClick={() => canEdit && saveLiveScope(scope)}
                disabled={!canEdit}
                title={LIVE_SCOPE_HINTS[scope]}
                className={[
                  "flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors",
                  prefs.defaultLiveScope === scope
                    ? "bg-blue-600/20 border-blue-500 text-blue-300"
                    : "bg-slate-700/30 border-slate-600/50 text-slate-300 hover:border-slate-500",
                  !canEdit ? "opacity-60 cursor-not-allowed" : "",
                ].join(" ")}
              >
                <span className="text-sm font-medium">{LIVE_SCOPE_LABELS[scope]}</span>
                <span className="text-[11px] text-slate-500 mt-0.5">{LIVE_SCOPE_HINTS[scope]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-700/50">
          <div className="text-sm font-medium text-slate-200">Pending requests in the auto-schedule</div>
          <div className="text-xs text-slate-400">
            How unapproved (pending) staff requests affect generated schedules. Approved requests always apply at their declared strength. Conflicts and rule breaks are always flagged.
            {modeStatus === "saving" && <span className="ml-2 text-slate-500">Saving…</span>}
            {modeStatus === "saved" && <span className="ml-2 text-emerald-400">Saved</span>}
            {modeStatus === "error" && <span className="ml-2 text-rose-400">Failed</span>}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {PENDING_REQUEST_MODES.map((mode) => (
              <button
                key={mode}
                onClick={() => canEdit && saveMode(mode)}
                disabled={!canEdit}
                title={MODE_LABELS[mode].hint}
                className={[
                  "flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors",
                  prefs.pendingRequestMode === mode
                    ? "bg-blue-600/20 border-blue-500 text-blue-300"
                    : "bg-slate-700/30 border-slate-600/50 text-slate-300 hover:border-slate-500",
                  !canEdit ? "opacity-60 cursor-not-allowed" : "",
                ].join(" ")}
              >
                <span className="text-sm font-medium">{MODE_LABELS[mode].label}</span>
                <span className="text-[11px] text-slate-500 mt-0.5">{MODE_LABELS[mode].hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-700/50">
          <div className="text-sm font-medium text-slate-200">Scheduled shift share</div>
          <div className="text-xs text-slate-400">
            How the auto-scheduler splits a scheduled shift&apos;s slots (CALL, ORC, ORL…) across eligible staff within a run. Shifts a staffer already holds in the window (requests, manual entries) count toward their share. Hard per-staff limits and requests always rank above this.
            {shareStatus === "saving" && <span className="ml-2 text-slate-500">Saving…</span>}
            {shareStatus === "saved" && <span className="ml-2 text-emerald-400">Saved</span>}
            {shareStatus === "error" && <span className="ml-2 text-rose-400">Failed</span>}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {SHIFT_SHARE_BASES.map((basis) => (
              <button
                key={basis}
                onClick={() => canEdit && saveShareBasis(basis)}
                disabled={!canEdit}
                title={SHARE_LABELS[basis].hint}
                className={[
                  "flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors",
                  prefs.shiftShareBasis === basis
                    ? "bg-blue-600/20 border-blue-500 text-blue-300"
                    : "bg-slate-700/30 border-slate-600/50 text-slate-300 hover:border-slate-500",
                  !canEdit ? "opacity-60 cursor-not-allowed" : "",
                ].join(" ")}
              >
                <span className="text-sm font-medium">{SHARE_LABELS[basis].label}</span>
                <span className="text-[11px] text-slate-500 mt-0.5">{SHARE_LABELS[basis].hint}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="shift-balance-from" className="text-sm text-slate-300">Count shifts from</label>
            <input
              id="shift-balance-from"
              type="date"
              disabled={!canEdit}
              value={prefs.shiftBalanceFrom ?? ""}
              onChange={(e) => canEdit && saveBalanceFrom(e.target.value || null)}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm disabled:opacity-50"
            />
            {balanceStatus === "saving" && <span className="text-xs text-slate-500">Saving…</span>}
            {balanceStatus === "saved" && <span className="text-xs text-emerald-400">Saved</span>}
            {balanceStatus === "error" && <span className="text-xs text-rose-400">Failed</span>}
            <span className="w-full text-xs text-slate-400">
              For shifts marked &quot;Keep counts even across months&quot; (Settings › Shift types): shifts from this day on decide ties between people whose counts this month are even. Blank = each month on its own.
            </span>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-700/50">
          <div className="text-sm font-medium text-slate-200">Holidays</div>
          <div className="text-xs text-slate-400">
            On a date in the Holidays list, who the auto-scheduler gives the holiday shift. Approved leave, manual entries and work shifts already on the holiday are never replaced; staff with no pay-period target (fee basis) get nothing. Its hours come from the holiday shift&apos;s holiday hours.
            {holidayStatus === "saving" && <span className="ml-2 text-slate-500">Saving…</span>}
            {holidayStatus === "saved" && <span className="ml-2 text-emerald-400">Saved</span>}
            {holidayStatus === "error" && <span className="ml-2 text-rose-400">Failed</span>}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {HOLIDAY_POLICIES.map((policy) => (
              <button
                key={policy}
                onClick={() => canEdit && saveHolidayPolicy(policy)}
                disabled={!canEdit}
                title={HOLIDAY_LABELS[policy].hint}
                className={[
                  "flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors",
                  prefs.holidayPolicy === policy
                    ? "bg-blue-600/20 border-blue-500 text-blue-300"
                    : "bg-slate-700/30 border-slate-600/50 text-slate-300 hover:border-slate-500",
                  !canEdit ? "opacity-60 cursor-not-allowed" : "",
                ].join(" ")}
              >
                <span className="text-sm font-medium">{HOLIDAY_LABELS[policy].label}</span>
                <span className="text-[11px] text-slate-500 mt-0.5">{HOLIDAY_LABELS[policy].hint}</span>
              </button>
            ))}
          </div>
          {prefs.holidayPolicy === "entitlement" && (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <label htmlFor="holiday-usual-pct" className="text-xs text-slate-300">Part-timers: usually works that weekday at</label>
                <input
                  id="holiday-usual-pct"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  disabled={!canEdit}
                  value={usualPctDraft ?? String(prefs.holidayUsualWeekdayPct)}
                  onChange={(e) => setUsualPctDraft(e.target.value)}
                  onBlur={(e) => canEdit && saveUsualPct(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 disabled:opacity-60"
                />
                <span className="text-xs text-slate-300">% of weeks</span>
                {usualPctStatus === "saving" && <span className="text-xs text-slate-500">Saving…</span>}
                {usualPctStatus === "saved" && <span className="text-xs text-emerald-400">Saved</span>}
                {usualPctStatus === "error" && <span className="text-xs text-rose-400">Failed</span>}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Full-time staff always get the holiday. A part-timer gets it if they worked that weekday in at least this share of the last 26 weeks (leave counts as worked). Otherwise they get it only if the schedule, planned as if the holiday were an ordinary day, would have them working it; if not, the day is off and they work their hours on other days. 0 gives the holiday to every part-timer available that day.
              </div>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <label htmlFor="holiday-shift" className="text-xs text-slate-300">Shift credited on holidays</label>
            <select
              id="holiday-shift"
              value={prefs.holidayShiftId ?? ""}
              disabled={!canEdit}
              onChange={(e) => canEdit && saveHolidayShift(e.target.value === "" ? null : e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 disabled:opacity-60"
            >
              <option value="">None</option>
              {shiftTypes.filter(isHolidayCreditShift).map((st) => (
                <option key={st.id} value={st.id}>{st.code} — {st.name}</option>
              ))}
              {prefs.holidayShiftId && !shiftTypes.some((st) => st.id === prefs.holidayShiftId && isHolidayCreditShift(st)) && (
                <option value={prefs.holidayShiftId}>(no longer a leave shift that counts toward hours)</option>
              )}
            </select>
            {holidayShiftStatus === "saving" && <span className="text-xs text-slate-500">Saving…</span>}
            {holidayShiftStatus === "saved" && <span className="text-xs text-emerald-400">Saved</span>}
            {holidayShiftStatus === "error" && <span className="text-xs text-rose-400">Failed</span>}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-700/50">
          <div className="text-sm font-medium text-slate-200">Requested leave</div>
          <div className="text-xs text-slate-400">
            How requested leave (AL and other leave shifts) is charged when the auto-scheduler places it or a request is approved. Leave already on the schedule is not changed.
            {leaveStatus === "saving" && <span className="ml-2 text-slate-500">Saving…</span>}
            {leaveStatus === "saved" && <span className="ml-2 text-emerald-400">Saved</span>}
            {leaveStatus === "error" && <span className="ml-2 text-rose-400">Failed</span>}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {LEAVE_POLICIES.map((policy) => (
              <button
                key={policy}
                onClick={() => canEdit && saveLeavePolicy(policy)}
                disabled={!canEdit}
                title={LEAVE_LABELS[policy].hint}
                className={[
                  "flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors",
                  prefs.leaveHoursPolicy === policy
                    ? "bg-blue-600/20 border-blue-500 text-blue-300"
                    : "bg-slate-700/30 border-slate-600/50 text-slate-300 hover:border-slate-500",
                  !canEdit ? "opacity-60 cursor-not-allowed" : "",
                ].join(" ")}
              >
                <span className="text-sm font-medium">{LEAVE_LABELS[policy].label}</span>
                <span className="text-[11px] text-slate-500 mt-0.5">{LEAVE_LABELS[policy].hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-700/50">
          <div className="text-sm font-medium text-slate-200">Conflicting shift requests</div>
          <div className="text-xs text-slate-400">
            How the auto-scheduler resolves requested shifts that contend for a scarce slot or would push a staffer past their pay-period hours. Approved (human-decided) requests are always honored and never revoked.
            {policyStatus === "saving" && <span className="ml-2 text-slate-500">Saving…</span>}
            {policyStatus === "saved" && <span className="ml-2 text-emerald-400">Saved</span>}
            {policyStatus === "error" && <span className="ml-2 text-rose-400">Failed</span>}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {REQUEST_CONFLICT_POLICIES.map((policy) => (
              <button
                key={policy}
                onClick={() => canEdit && savePolicy(policy)}
                disabled={!canEdit}
                title={POLICY_LABELS[policy].hint}
                className={[
                  "flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors",
                  prefs.requestConflictPolicy === policy
                    ? "bg-blue-600/20 border-blue-500 text-blue-300"
                    : "bg-slate-700/30 border-slate-600/50 text-slate-300 hover:border-slate-500",
                  !canEdit ? "opacity-60 cursor-not-allowed" : "",
                ].join(" ")}
              >
                <span className="text-sm font-medium">{POLICY_LABELS[policy].label}</span>
                <span className="text-[11px] text-slate-500 mt-0.5">{POLICY_LABELS[policy].hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-700/50">
          <div className="text-sm font-medium text-slate-200">When an approved request lands on a full day</div>
          <div className="text-xs text-slate-400">
            A maximum is never broken. Approving a request for a day that already has its full count either re-arranges auto-placed shifts so every rule still holds, or flags the request as needing resolving. Hand-placed, locked, imported and other approved shifts are never moved.
            {approvalPolicyStatus === "saving" && <span className="ml-2 text-slate-500">Saving…</span>}
            {approvalPolicyStatus === "saved" && <span className="ml-2 text-emerald-400">Saved</span>}
            {approvalPolicyStatus === "error" && <span className="ml-2 text-rose-400">Failed</span>}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {APPROVAL_CONFLICT_POLICIES.map((policy) => (
              <button
                key={policy}
                onClick={() => canEdit && saveApprovalPolicy(policy)}
                disabled={!canEdit}
                title={APPROVAL_POLICY_LABELS[policy].hint}
                className={[
                  "flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors",
                  prefs.approvalConflictPolicy === policy
                    ? "bg-blue-600/20 border-blue-500 text-blue-300"
                    : "bg-slate-700/30 border-slate-600/50 text-slate-300 hover:border-slate-500",
                  !canEdit ? "opacity-60 cursor-not-allowed" : "",
                ].join(" ")}
              >
                <span className="text-sm font-medium">{APPROVAL_POLICY_LABELS[policy].label}</span>
                <span className="text-[11px] text-slate-500 mt-0.5">{APPROVAL_POLICY_LABELS[policy].hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-700/50">
          <div className="text-sm font-medium text-slate-200">Requests archive</div>
          <div className="text-xs text-slate-400">
            When a month is over, its requests leave the Requests list and move to the Archive, marked met or not met from the schedule as it stands. The schedule stays editable: changing a past month changes its archive at once.
            {archiveStatus === "saving" && <span className="ml-2 text-slate-500">Saving…</span>}
            {archiveStatus === "saved" && <span className="ml-2 text-emerald-400">Saved</span>}
            {archiveStatus === "error" && <span className="ml-2 text-rose-400">Failed</span>}
          </div>
          <label className="flex items-center gap-2 mt-3 text-sm text-slate-300">
            Archive a month&apos;s requests
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={archiveDaysText}
              disabled={!canEdit}
              onChange={(e) => setArchiveDaysText(e.target.value)}
              onBlur={commitArchiveDays}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              aria-label="Days after the month ends before its requests are archived"
              className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 disabled:opacity-60"
            />
            days after the month ends (0 = the next day)
          </label>
          <div className="text-xs text-slate-400 mt-3">When a month is archived, a leave request counts as met by …</div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {ARCHIVE_LEAVE_RULES.map((rule) => (
              <button
                key={rule}
                onClick={() => canEdit && rule !== prefs.archiveLeaveMetBy && saveArchive({ archiveLeaveMetBy: rule })}
                disabled={!canEdit}
                title={ARCHIVE_LEAVE_LABELS[rule].hint}
                className={[
                  "flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors",
                  prefs.archiveLeaveMetBy === rule
                    ? "bg-blue-600/20 border-blue-500 text-blue-300"
                    : "bg-slate-700/30 border-slate-600/50 text-slate-300 hover:border-slate-500",
                  !canEdit ? "opacity-60 cursor-not-allowed" : "",
                ].join(" ")}
              >
                <span className="text-sm font-medium">{ARCHIVE_LEAVE_LABELS[rule].label}</span>
                <span className="text-[11px] text-slate-500 mt-0.5">{ARCHIVE_LEAVE_LABELS[rule].hint}</span>
              </button>
            ))}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">This only decides the archive&apos;s met / not met. Approving requests and building the schedule are unchanged.</div>
        </div>

        <div className="pt-2 border-t border-slate-700/50">
          <div className="text-sm font-medium text-slate-200">Default day-off fulfillment order</div>
          <div className="text-xs text-slate-400">
            When staff request the day off, the order the auto-scheduler tries to free it — earlier methods first. Staff can override this per request. Always a best-effort preference: it never overrides staffing coverage.
            {offStatus === "saving" && <span className="ml-2 text-slate-500">Saving…</span>}
            {offStatus === "saved" && <span className="ml-2 text-emerald-400">Saved</span>}
            {offStatus === "error" && <span className="ml-2 text-rose-400">Failed</span>}
          </div>
          <div className="mt-3 max-w-md">
            <OffStrategyEditor
              order={prefs.defaultOffStrategyOrder}
              onChange={(next) => canEdit && saveOffOrder(next)}
              leaveTypes={leaveTypes}
              disabled={!canEdit}
            />
          </div>
        </div>

        <div className="pt-2 border-t border-slate-700/50">
          <div className="text-sm font-medium text-slate-200">When a shift&apos;s Auto-schedule is turned on</div>
          <div className="text-xs text-slate-400">
            Who starts ticked in the panel that opens when you turn on a shift&apos;s Auto-schedule (Shift Types). You can change any person there before saving. &ldquo;Worked it&rdquo; means at least one saved assignment of that shift, on any date.
            {activationStatus === "saving" && <span className="ml-2 text-slate-500">Saving…</span>}
            {activationStatus === "saved" && <span className="ml-2 text-emerald-400">Saved</span>}
            {activationStatus === "error" && <span className="ml-2 text-rose-400">Failed</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <label className="text-xs text-slate-400 flex flex-col gap-1">
              People who have worked it
              <select
                value={prefs.activationWorkedDefault}
                disabled={!canEdit}
                onChange={(e) => canEdit && saveActivation("activationWorkedDefault", e.target.value as SchedulingPrefs["activationWorkedDefault"])}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 disabled:opacity-50"
              >
                {(["eligible", "not_eligible", "keep"] as const).map((k) => <option key={k} value={k}>{GROUP_LABELS[k]}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400 flex flex-col gap-1">
              Everyone else
              <select
                value={prefs.activationNeverDefault}
                disabled={!canEdit}
                onChange={(e) => canEdit && saveActivation("activationNeverDefault", e.target.value as SchedulingPrefs["activationNeverDefault"])}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 disabled:opacity-50"
              >
                {(["eligible", "not_eligible", "keep"] as const).map((k) => <option key={k} value={k}>{GROUP_LABELS[k]}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400 flex flex-col gap-1">
              New hires get it by employment type
              <select
                value={prefs.activationNewHireDefault}
                disabled={!canEdit}
                onChange={(e) => canEdit && saveActivation("activationNewHireDefault", e.target.value as SchedulingPrefs["activationNewHireDefault"])}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 disabled:opacity-50"
              >
                {(["keep", "match", "none", "all"] as const).map((k) => <option key={k} value={k}>{NEW_HIRE_LABELS[k]}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
}

// ─── Pay-period preferences (department-wide, per-FTE shift targets) ─────────

type DeptTargetData = DeptTargetRow;

// Department-wide shift count targets expressed PER 1.0 FTE. Reuses the same
// FrequencyPicker (min/max + window) used for per-staff targets; adds a soft/hard
// toggle. The scheduler scales each target to a staffer's FTE and lets any
// per-staff target override the department default. One target per shift type
// here (the common case); the unique key on the server is (shift, window, count).
function PayPeriodPrefsSection({ initial, shiftTypes }: { initial: DeptTargetData[]; shiftTypes: ShiftType[] }) {
  const canEdit = useCanEdit();
  const [rows, setRows] = useState<DeptTargetData[]>(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  // Only auto-schedulable work shifts: a target on a shift the auto-scheduler
  // never places would be a no-op, so don't offer it here.
  const workShifts = shiftTypes.filter((st) => !st.isOffShift && !st.isLeave && st.autoSchedulable);
  const rowFor = (shiftTypeId: string) => rows.find((r) => r.shiftTypeId === shiftTypeId);

  async function save(shiftTypeId: string, target: DeptPickerTarget | undefined) {
    const existing = rowFor(shiftTypeId);
    setStatus("saving");
    setError("");
    try {
      if (!target) {
        if (existing) {
          const res = await fetch("/api/settings/department-shift-targets", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: existing.id }),
          });
          if (!res.ok) throw new Error(await res.text());
          setRows((rs) => rs.filter((r) => r.id !== existing.id));
        }
      } else {
        const windowCount = target.window === "days" ? 1 : target.windowCount ?? 1;
        // Changing the window/period creates a different unique key on the server;
        // drop the old row first so a shift never accumulates orphaned targets.
        if (existing && (existing.window !== target.window || (existing.windowCount ?? 1) !== windowCount)) {
          await fetch("/api/settings/department-shift-targets", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: existing.id }),
          });
        }
        const res = await fetch("/api/settings/department-shift-targets", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          // Card #258: the picker's Hard/Prefer choice is what is saved.
          body: JSON.stringify(deptTargetPutBody(shiftTypeId, target, existing)),
        });
        if (!res.ok) throw new Error(await res.text());
        const saved = (await res.json()) as DeptTargetData;
        setRows((rs) => [...rs.filter((r) => r.shiftTypeId !== shiftTypeId), saved]);
      }
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  return (
    <CollapsibleSection
      id="payperiod-preferences"
      title="Pay-period preferences"
      description="Department-wide shift targets, expressed per 1.0 FTE. The auto-scheduler scales each target to a staffer's FTE (e.g. 2 per 1.0 FTE → ~2 at 0.8 FTE) to bias the shift mix. Only affects staff who are eligible for that shift; a per-staff target for the same shift overrides the department default. Staffing requirements are always respected first."
      status={status}
      error={error}
    >
      <div className="space-y-2 mt-4">
        {workShifts.map((st) => {
          const row = rowFor(st.id);
          const target = row ? deptPickerTarget(row) : undefined;
          return (
            <div key={st.id} className="flex items-center gap-3 py-1.5 border-b border-slate-700/40 last:border-0">
              <div className="w-16 shrink-0 text-sm font-medium text-slate-200" title={st.name}>{st.code}</div>
              <div className="flex-1">
                <FrequencyPicker
                  shiftTypeId={st.id}
                  target={target}
                  defaultStrength={DEPT_DEFAULT_STRENGTH}
                  onChange={(t) => canEdit && save(st.id, t)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}

// ─── Email (SMTP) Section ───────────────────────────────────────────────────

function EmailSettingsSection() {
  const canEdit = useCanEdit();
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const [cfg, setCfg] = useState({ enabled: false, host: "", port: 587, secure: false, username: "", fromAddress: "", passwordConfigured: false });
  const [password, setPassword] = useState("");

  useEffect(() => {
    fetch("/api/settings/email")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setCfg({ enabled: d.enabled, host: d.host ?? "", port: d.port ?? 587, secure: d.secure, username: d.username ?? "", fromAddress: d.fromAddress ?? "", passwordConfigured: d.passwordConfigured });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save() {
    setStatus("saving"); setError("");
    const body: Record<string, unknown> = {
      enabled: cfg.enabled, host: cfg.host, port: cfg.port, secure: cfg.secure, username: cfg.username, fromAddress: cfg.fromAddress,
    };
    if (password) body.password = password;
    const res = await fetch("/api/settings/email", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Failed to save"); setStatus("error"); return; }
    const d = await res.json();
    setCfg((c) => ({ ...c, passwordConfigured: d.passwordConfigured }));
    setPassword("");
    setStatus("saved"); setTimeout(() => setStatus("idle"), 2000);
  }

  async function sendTest() {
    setTestMsg("Sending…");
    const res = await fetch("/api/settings/email/test", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setTestMsg(res.ok ? `Sent to ${d.sentTo}` : (d.error ?? "Send failed"));
  }

  const input = "w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50";

  return (
    <CollapsibleSection
      id="email-smtp"
      title="Email (SMTP)"
      description="Outbound mail for request confirmations. Nothing sends until this is filled in and enabled."
      status={status}
      error={error}
    >
      {!loaded ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-3 mt-2">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={cfg.enabled} disabled={!canEdit} onChange={(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))} className="accent-blue-500" />
            Enable outbound email
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-sm sm:col-span-2">
              <span className="block text-xs text-slate-400 mb-1">SMTP host</span>
              <input className={input} disabled={!canEdit} value={cfg.host} placeholder="smtp.example.com" onChange={(e) => setCfg((c) => ({ ...c, host: e.target.value }))} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-slate-400 mb-1">Port</span>
              <DecimalField className={input} disabled={!canEdit} integer required min={1} max={65535} aria-label="Port" value={cfg.port || null} onValueChange={(v) => v != null && setCfg((c) => ({ ...c, port: v }))} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={cfg.secure} disabled={!canEdit} onChange={(e) => setCfg((c) => ({ ...c, secure: e.target.checked }))} className="accent-blue-500" />
            Use implicit TLS (port 465). Leave off for STARTTLS (587).
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-slate-400 mb-1">Username</span>
              <input className={input} disabled={!canEdit} value={cfg.username} autoComplete="off" onChange={(e) => setCfg((c) => ({ ...c, username: e.target.value }))} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-slate-400 mb-1">Password {cfg.passwordConfigured && <span className="text-emerald-400">(configured)</span>}</span>
              <input className={input} disabled={!canEdit} type="password" value={password} autoComplete="new-password" placeholder={cfg.passwordConfigured ? "•••••••• (leave blank to keep)" : ""} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </div>
          <label className="text-sm block">
            <span className="block text-xs text-slate-400 mb-1">From address</span>
            <input className={input} disabled={!canEdit} value={cfg.fromAddress} placeholder="scheduler@example.com" onChange={(e) => setCfg((c) => ({ ...c, fromAddress: e.target.value }))} />
          </label>
          {canEdit && (
            <div className="flex items-center gap-3 pt-1">
              <button onClick={save} disabled={status === "saving"} className="px-4 py-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors font-medium disabled:opacity-50">
                {status === "saving" ? "Saving…" : "Save"}
              </button>
              <button onClick={sendTest} className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded transition-colors text-slate-300">
                Send test email
              </button>
              {testMsg && <span className="text-xs text-slate-400">{testMsg}</span>}
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

// ─── Employment Types Section ───────────────────────────────────────────────

const ET_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ET_DAY_INDICES = [0, 1, 2, 3, 4, 5, 6];
const ET_DAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

// A "plain" default rule is the trivial available/hard single-weekday every rule
// the quick-toggle manages. Routed through the WHEN model so an explicit
// ordinal/multi-day default (picker) is never hidden or clobbered by the toggle.
function defaultIsPlain(r: DefaultAvailabilityRule): boolean {
  return r.type === "available" && r.strength === "rule" && isPlainWeekdayWhen(ruleToWhen(r));
}

// Whether a default rule's recurrence covers this weekday — read through the
// WHEN model rather than the legacy dayOfWeek column so the quick-toggle stays
// correct once the legacy columns are gone (slice 7).
function defaultRuleCoversDay(r: DefaultAvailabilityRule, d: number): boolean {
  const days = ruleToWhen(r).daysOfWeek;
  return days.length === 0 || days.includes(d);
}

// Two-layer default-availability editor: quick day toggles (plain rules only) +
// an advanced rules list with the shared <RecurrencePicker>. Mirrors the staff
// AvailabilityEditor, minus per-staff conditions.
function DefaultAvailabilityEditor({
  rules,
  onChange,
  canEdit,
}: {
  rules: DefaultAvailabilityRule[];
  onChange: (next: DefaultAvailabilityRule[]) => void;
  canEdit: boolean;
}) {
  const advanced = rules.filter((r) => !defaultIsPlain(r));

  function toggleDay(d: number) {
    if (!canEdit) return;
    const plainForDay = rules.filter((r) => defaultIsPlain(r) && defaultRuleCoversDay(r, d));
    if (plainForDay.length > 0) {
      onChange(rules.filter((r) => !(defaultIsPlain(r) && defaultRuleCoversDay(r, d))));
    } else {
      onChange([...rules, { type: "available", strength: "rule", ...whenToColumns({ daysOfWeek: [d], kind: "every" }) }]);
    }
  }
  function updateAt(i: number, patch: Partial<DefaultAvailabilityRule>) {
    if (!canEdit) return;
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeAt(i: number) {
    if (!canEdit) return;
    onChange(rules.filter((_, idx) => idx !== i));
  }
  function addRule() {
    if (!canEdit) return;
    onChange([...rules, { type: "available", strength: "preference", ...whenToColumns({ daysOfWeek: [1], kind: "every" }) }]);
  }

  const selCls = "bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-xs text-slate-300 disabled:opacity-50";

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1.5">Default working days</div>
        <div className="flex gap-1">
          {ET_DAY_INDICES.map((d) => {
            const active = rules.some((r) => defaultIsPlain(r) && defaultRuleCoversDay(r, d));
            return (
              <button
                key={d}
                onClick={() => toggleDay(d)}
                disabled={!canEdit}
                className={[
                  "w-10 h-8 text-xs rounded font-medium transition-colors",
                  active ? "bg-blue-600/50 text-blue-200 border border-blue-500/50" : "bg-slate-700 text-slate-500 border border-slate-600",
                  canEdit ? "hover:brightness-125" : "opacity-50 cursor-not-allowed",
                ].join(" ")}
              >
                {ET_DAY_LABELS[d]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1.5">
          Advanced default rules {advanced.length > 0 && `(${advanced.length})`}
        </div>
        <div className="space-y-1.5">
          {rules.map((rule, i) => {
            if (defaultIsPlain(rule)) return null;
            return (
              <div key={i} className="bg-slate-700/30 border border-slate-600/50 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  <select className={selCls} value={rule.type} onChange={(e) => updateAt(i, { type: e.target.value })} disabled={!canEdit}>
                    <option value="available">Available</option>
                    <option value="unavailable">Not available</option>
                  </select>
                  <select className={selCls} value={rule.strength} onChange={(e) => updateAt(i, { strength: e.target.value })} disabled={!canEdit}>
                    <option value="rule">Hard rule</option>
                    <option value="preference">Soft preference</option>
                  </select>
                  {canEdit && (
                    <button onClick={() => removeAt(i)} className="text-slate-600 hover:text-red-400 ml-auto transition-colors" title="Remove rule">×</button>
                  )}
                </div>
                <RecurrencePicker
                  value={ruleToWhen(rule)}
                  onChange={(w) => updateAt(i, { ...whenToColumns(w) })}
                />
                <div className="text-[10px] text-slate-500 italic border-t border-slate-600/30 pt-1.5 mt-1">
                  {rule.type === "available" ? (rule.strength === "preference" ? "Prefers to work" : "Works") : (rule.strength === "preference" ? "Prefers not to work" : "Cannot work")}
                  {": "}{describeWhen(ruleToWhen(rule))}.
                </div>
              </div>
            );
          })}
        </div>
        {canEdit && (
          <button onClick={addRule} className="mt-2 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded transition-colors text-slate-300">
            + Add rule
          </button>
        )}
      </div>
    </div>
  );
}

function EmploymentTypesSection({ initial, pushUndo, shiftTypes }: { initial: EmploymentTypeData[]; pushUndo: (a: UndoAction) => void; shiftTypes: ShiftType[] }) {
  const canEdit = useCanEdit();
  const [types, setTypes] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingType = editingId ? types.find((t) => t.id === editingId) ?? null : null;

  // Card #75: the last SAVED row per type (not the page-load props): Cancel restores it, and each
  // save sends its new-hire shift list as the base so the server applies only this edit.
  const savedTypes = useRef(new Map(initial.map((t) => [t.id, t] as const)));
  useEffect(() => {
    // The activation panel (Shift types) rewrites one shift's new-hire defaults across types.
    const onDefaults = (e: Event) => {
      const { shiftTypeId, typeIds } = (e as CustomEvent<{ shiftTypeId: string; typeIds: string[] }>).detail;
      const apply = (t: EmploymentTypeData): EmploymentTypeData => {
        const has = t.defaultEligibleShiftTypeIds.includes(shiftTypeId);
        const want = typeIds.includes(t.id);
        if (has === want) return t;
        return { ...t, defaultEligibleShiftTypeIds: want ? [...t.defaultEligibleShiftTypeIds, shiftTypeId] : t.defaultEligibleShiftTypeIds.filter((id) => id !== shiftTypeId) };
      };
      for (const [id, t] of savedTypes.current) savedTypes.current.set(id, apply(t));
      setTypes((cur) => cur.map(apply));
    };
    window.addEventListener(TYPE_DEFAULTS_EVENT, onDefaults);
    return () => window.removeEventListener(TYPE_DEFAULTS_EVENT, onDefaults);
  }, []);

  function updateField(id: string, field: keyof EmploymentTypeData, value: unknown) {
    setTypes((prev) => prev.map((t) => t.id === id ? { ...t, [field]: value } : t));
  }

  const cancelEdit = useCallback(() => {
    if (!editingId) return;
    const orig = savedTypes.current.get(editingId);
    if (orig) setTypes((prev) => prev.map((t) => t.id === editingId ? orig : t));
    setEditingId(null);
  }, [editingId]);
  useEscape(cancelEdit);

  // PUT with the base list; returns the row with the server's canonical default-shift list.
  // Also returns the default-shift diff the server applied, so Undo reverses exactly this save.
  async function putType(body: EmploymentTypeData, base: readonly string[]): Promise<{ row: EmploymentTypeData; applied: ListApplied }> {
    const res = await fetch("/api/settings/employment-types", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, defaultEligibleShiftTypeIdsBase: base }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(j?.error ?? `Save failed (${res.status})`);
    }
    const saved = await res.json().catch(() => null) as { defaultEligibleShifts?: { shiftTypeId: string }[]; defaultEligibleShiftTypeIdsApplied?: unknown } | null;
    const ids = saved?.defaultEligibleShifts?.map((d) => d.shiftTypeId);
    const row = ids ? { ...body, defaultEligibleShiftTypeIds: ids } : body;
    return { row, applied: appliedDiff(saved?.defaultEligibleShiftTypeIdsApplied, body.defaultEligibleShiftTypeIds, base, row.defaultEligibleShiftTypeIds) };
  }

  async function saveType(et: EmploymentTypeData) {
    const prev = savedTypes.current.get(et.id);
    const warning = prev ? typeFlagChangeWarning(prev, et) : null;
    if (warning && !confirm(warning)) return;
    setStatus("saving");
    try {
      const { row: saved, applied } = await putType(et, (prev ?? et).defaultEligibleShiftTypeIds);
      savedTypes.current.set(saved.id, saved);
      setTypes((cur) => cur.map((t) => t.id === saved.id ? saved : t));
      setEditingId(null);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
      if (prev) {
        pushUndo({
          label: `Updated ${et.name}`,
          execute: async () => {
            try {
              // Only this save's own additions/removals are reversed; a shift activation made
              // elsewhere meanwhile (kept by the save) stays (Codex #385).
              const u = undoList(saved.defaultEligibleShiftTypeIds, applied);
              const { row: back } = await putType({ ...prev, defaultEligibleShiftTypeIds: u.list }, u.base);
              savedTypes.current.set(back.id, back);
              setTypes((cur) => cur.map((t) => t.id === back.id ? back : t));
            } catch (e) {
              setError(e instanceof Error ? e.message : "Undo failed");
              setStatus("error");
            }
          },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  async function addType() {
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/employment-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Type" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      const newType: EmploymentTypeData = {
        id: created.id,
        name: created.name,
        defaultIsAutoScheduled: created.defaultIsAutoScheduled,
        defaultFtePercentage: created.defaultFtePercentage,
        usesFtePercentage: created.usesFtePercentage,
        allowsFixedHours: created.allowsFixedHours,
        includedInFairness: created.includedInFairness,
        defaultEligibleShiftTypeIds: (created.defaultEligibleShifts ?? []).map((ds: { shiftTypeId: string }) => ds.shiftTypeId),
        defaultAvailabilityRules: (created.defaultAvailability ?? []).map((da: DefaultAvailabilityRule) => ({
          type: da.type, strength: da.strength,
          whenKind: da.whenKind, whenDays: da.whenDays, whenPpWeek: da.whenPpWeek, whenOrds: da.whenOrds,
          whenCycleUnit: da.whenCycleUnit, whenCycleN: da.whenCycleN, whenCycleOffset: da.whenCycleOffset,
        })),
        sortOrder: created.sortOrder,
        staffCount: 0,
      };
      savedTypes.current.set(newType.id, newType);
      setTypes((prev) => [...prev, newType]);
      setEditingId(created.id);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
      pushUndo({
        label: "Added employment type",
        execute: async () => {
          await fetch("/api/settings/employment-types", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: created.id }),
          });
          setTypes((cur) => cur.filter((t) => t.id !== created.id));
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  async function deleteType(id: string) {
    const et = types.find((t) => t.id === id);
    if (!et) return;
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/employment-types", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed");
      }
      setTypes((prev) => prev.filter((t) => t.id !== id));
      setEditingId(null);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
      pushUndo({
        label: `Removed ${et.name}`,
        execute: async () => {
          const res = await fetch("/api/settings/employment-types", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(et),
          });
          const created = await res.json();
          // POST gives a new type its own default shifts: keep the server's list.
          const back = { ...et, id: created.id, defaultEligibleShiftTypeIds: (created.defaultEligibleShifts ?? []).map((ds: { shiftTypeId: string }) => ds.shiftTypeId) };
          savedTypes.current.set(back.id, back);
          setTypes((cur) => [...cur, back]);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  const et = editingType;

  return (
    <CollapsibleSection
      id="employment-types"
      title="Employment Types"
      description="Define employment categories and their default scheduling values"
      status={status}
      error={error}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-400 uppercase tracking-wider">
            <th className="text-left py-2 px-2">Name</th>
            <th className="text-center py-2 px-2 w-16">Auto</th>
            <th className="text-center py-2 px-2 w-16">FTE%</th>
            <th className="text-left py-2 px-2">Ineligible</th>
            <th className="text-center py-2 px-2 w-14">Staff</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/50">
          {types.map((t) => (
            <tr
              key={t.id}
              className={`hover:bg-slate-700/30 ${canEdit ? "cursor-pointer" : ""} transition-colors`}
              onClick={() => canEdit && setEditingId(t.id)}
            >
              <td className="py-2 px-2 font-medium text-slate-200">{t.name}</td>
              <td className="py-2 px-2 text-center">
                <span className={t.defaultIsAutoScheduled ? "text-emerald-400" : "text-slate-600"}>
                  {t.defaultIsAutoScheduled ? "✓" : "—"}
                </span>
              </td>
              <td className="py-2 px-2 text-center font-mono text-slate-400">
                {t.usesFtePercentage ? `${(t.defaultFtePercentage * 100).toFixed(0)}%` : t.allowsFixedHours ? "fixed h" : "—"}
              </td>
              <td className="py-2 px-2">
                <div className="flex flex-wrap gap-1">
                  {shiftTypes
                    .filter((st) => !t.defaultEligibleShiftTypeIds.includes(st.id))
                    .map((st) => (
                      <span key={st.id} className="text-[10px] px-1.5 py-px rounded bg-slate-700/50 text-slate-500">
                        {st.code}
                      </span>
                    ))}
                </div>
              </td>
              <td className="py-2 px-2 text-center text-slate-500 text-xs">{t.staffCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {et && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={cancelEdit}>
          <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <span className="font-semibold text-slate-100">{et.name}</span>
              <button onClick={cancelEdit} className="text-slate-500 hover:text-slate-300 text-lg">×</button>
            </div>

            <div className="px-6 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-200">Name</span>
                <input disabled={!canEdit} className="w-40 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm disabled:opacity-50" value={et.name} onChange={(e) => updateField(et.id, "name", e.target.value)} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-200">Auto-schedule</div>
                  <div className="text-xs text-slate-500">Include in auto-scheduler by default</div>
                </div>
                <input disabled={!canEdit} type="checkbox" checked={et.defaultIsAutoScheduled} onChange={(e) => updateField(et.id, "defaultIsAutoScheduled", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-200">Has an FTE %</div>
                  <div className="text-xs text-slate-500">Staff have an FTE % and an hours target (pay period hours x FTE)</div>
                </div>
                <input
                  disabled={!canEdit}
                  type="checkbox"
                  aria-label="Has an FTE %"
                  checked={et.usesFtePercentage}
                  onChange={(e) => {
                    updateField(et.id, "usesFtePercentage", e.target.checked);
                    // An FTE % and fixed hours are mutually exclusive.
                    if (e.target.checked) updateField(et.id, "allowsFixedHours", false);
                  }}
                  className="rounded border-slate-600 w-4 h-4 disabled:opacity-50"
                />
              </div>
              {et.usesFtePercentage && (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-slate-200">FTE percentage</div>
                    <div className="text-xs text-slate-500">Default target hours ratio</div>
                  </div>
                  <select disabled={!canEdit} className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm disabled:opacity-50" value={et.defaultFtePercentage} onChange={(e) => updateField(et.id, "defaultFtePercentage", parseFloat(e.target.value))}>
                    {[1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0].map((v) => (
                      <option key={v} value={v}>{(v * 100).toFixed(0)}%</option>
                    ))}
                  </select>
                </div>
              )}
              {!et.usesFtePercentage && (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-slate-200">Fixed hours per pay period</div>
                    <div className="text-xs text-slate-500">Staff of this type can be given a fixed number of hours (off by default for each person)</div>
                  </div>
                  <input
                    disabled={!canEdit}
                    type="checkbox"
                    aria-label="Fixed hours per pay period"
                    checked={et.allowsFixedHours}
                    onChange={(e) => updateField(et.id, "allowsFixedHours", e.target.checked)}
                    className="rounded border-slate-600 w-4 h-4 disabled:opacity-50"
                  />
                </div>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-200">Included in fairness</div>
                  <div className="text-xs text-slate-500">Staff of this type count in equity / fairness</div>
                </div>
                <input
                  disabled={!canEdit}
                  type="checkbox"
                  aria-label="Included in fairness"
                  checked={et.includedInFairness}
                  onChange={(e) => updateField(et.id, "includedInFairness", e.target.checked)}
                  className="rounded border-slate-600 w-4 h-4 disabled:opacity-50"
                />
              </div>
              <div>
                <div className="text-sm text-slate-200 mb-1">Default eligible shifts</div>
                <div className="text-xs text-slate-500 mb-2">New staff with this type will be eligible for these shifts.</div>
                <div className="space-y-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">Work</div>
                    <div className="flex flex-wrap gap-1">
                      {shiftTypes.filter((st) => !st.isLeave).map((st) => {
                        const isEligible = et.defaultEligibleShiftTypeIds.includes(st.id);
                        return (
                          <button
                            key={st.id}
                            onClick={() => {
                              if (!canEdit) return;
                              const next = isEligible
                                ? et.defaultEligibleShiftTypeIds.filter((id) => id !== st.id)
                                : [...et.defaultEligibleShiftTypeIds, st.id];
                              updateField(et.id, "defaultEligibleShiftTypeIds", next);
                            }}
                            className={`px-2 py-0.5 text-xs font-bold rounded transition-colors border ${isEligible ? "" : "opacity-30"} ${!canEdit ? "cursor-not-allowed" : ""}`}
                            style={{
                              backgroundColor: isEligible ? st.color + "25" : undefined,
                              color: st.color,
                              borderColor: isEligible ? st.color + "50" : "transparent",
                            }}
                          >
                            {st.code}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {shiftTypes.some((st) => st.isLeave) && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">Leave</div>
                      <div className="flex flex-wrap gap-1">
                        {shiftTypes.filter((st) => st.isLeave).map((st) => {
                          const isEligible = et.defaultEligibleShiftTypeIds.includes(st.id);
                          return (
                            <button
                              key={st.id}
                              onClick={() => {
                                if (!canEdit) return;
                                const next = isEligible
                                  ? et.defaultEligibleShiftTypeIds.filter((id) => id !== st.id)
                                  : [...et.defaultEligibleShiftTypeIds, st.id];
                                updateField(et.id, "defaultEligibleShiftTypeIds", next);
                              }}
                              className={`px-2 py-0.5 text-xs font-bold rounded transition-colors border ${isEligible ? "" : "opacity-30"} ${!canEdit ? "cursor-not-allowed" : ""}`}
                              style={{
                                backgroundColor: isEligible ? st.color + "25" : undefined,
                                color: st.color,
                                borderColor: isEligible ? st.color + "50" : "transparent",
                              }}
                            >
                              {st.code}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-200 mb-2">Default availability</div>
                <DefaultAvailabilityEditor
                  rules={et.defaultAvailabilityRules}
                  onChange={(next) => updateField(et.id, "defaultAvailabilityRules", next)}
                  canEdit={canEdit}
                />
              </div>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700">
              {canEdit ? (
                <button
                  onClick={() => deleteType(et.id)}
                  disabled={et.staffCount > 0}
                  title={et.staffCount > 0 ? `${et.staffCount} staff member(s) use this type` : ""}
                  className="px-3 py-1.5 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-400 border border-red-800/50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Delete
                </button>
              ) : <div />}
              <div className="flex gap-2">
                <button onClick={cancelEdit} className="px-4 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors">{canEdit ? "Cancel" : "Close"}</button>
                {canEdit && <button onClick={() => saveType(et)} className="px-4 py-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors font-medium">Save</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {canEdit && (
        <button
          onClick={addType}
          className="mt-3 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300"
        >
          + Add Employment Type
        </button>
      )}
    </CollapsibleSection>
  );
}

// ─── Special column order (card #300) ───────────────────────────────────────
// One order across the schedule's special columns: the printed Additional (aggregate)
// columns, the shifts with their own column, and the Count columns. Screen + print.
// Unlisted columns (e.g. one just added) follow in the built-in order.
function SpecialColumnOrderSection({
  initial,
  aggColumns,
  dedicatedShifts,
  countColumns,
}: {
  initial: string[] | null;
  aggColumns: { id: string; label: string }[];
  dedicatedShifts: { id: string; code: string }[];
  countColumns: { id: string; label: string }[];
}) {
  const canEdit = useCanEdit();
  const [savedOrder, setSavedOrder] = useState<string[] | null>(initial);
  const resolve = (order: string[] | null) =>
    orderSpecialColumns({ agg: aggColumns, ded: dedicatedShifts, count: countColumns }, order).map((x) => ({
      key: x.key,
      label: x.kind === "agg" ? `${(x.col as { label: string }).label || "(untitled)"} · additional column (print only)`
        : x.kind === "ded" ? `${(x.col as { code: string }).code} · shift column`
        : `${(x.col as { label: string }).label || "#"} · count column`,
    }));
  const savedKeys = resolve(savedOrder).map((x) => x.key);
  const [draft, setDraft] = useState<string[] | null>(null); // null = showing the saved order
  const keys = draft ?? savedKeys;
  const labelByKey = new Map(resolve(null).map((x) => [x.key, x.label]));
  // A draft taken before a column was added/removed elsewhere on the page: keep its order
  // for the columns still there and append new ones (same rule as the schedule).
  const shown = orderSpecialColumns(
    { agg: aggColumns, ded: dedicatedShifts, count: countColumns },
    keys,
  ).map((x) => x.key);
  const dirty = draft !== null && shown.join("|") !== savedKeys.join("|");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const saving = status === "saving";

  function move(idx: number, dir: -1 | 1) {
    if (saving) return;
    const j = idx + dir;
    if (j < 0 || j >= shown.length) return;
    const next = [...shown];
    [next[idx], next[j]] = [next[j], next[idx]];
    setDraft(next);
  }

  async function put(value: string[] | null) {
    setStatus("saving");
    setError("");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specialColumnOrder: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedOrder(value);
      setDraft(null);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setStatus("error");
    }
  }

  return (
    <CollapsibleSection
      id="special-column-order"
      title="Column Order"
      description="The order of the extra columns to the right of the staff: Additional Columns (printed only), shifts with their own column, and Count Columns. Used on screen and on the printed schedule. A column added later goes last until you move it."
      status={status}
      error={error}
    >
      {shown.length === 0 ? (
        <p className="text-xs text-slate-500">No extra columns are set up.</p>
      ) : (
        <ol className="space-y-1">
          {shown.map((key, idx) => (
            <li key={key} className="flex items-center gap-2 text-sm text-slate-300">
              <span className="w-5 text-right text-xs text-slate-500">{idx + 1}.</span>
              <span className="flex-1">{labelByKey.get(key) ?? key}</span>
              {canEdit && (
                <>
                  <button type="button" aria-label="Move up" disabled={saving || idx === 0} onClick={() => move(idx, -1)} className="px-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-30">▲</button>
                  <button type="button" aria-label="Move down" disabled={saving || idx === shown.length - 1} onClick={() => move(idx, 1)} className="px-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-30">▼</button>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {canEdit && (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={!dirty || status === "saving"} onClick={() => put(shown)} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-white">Save</button>
          <button type="button" disabled={saving || !dirty} onClick={() => setDraft(null)} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-slate-300">Cancel</button>
          <button type="button" disabled={savedOrder === null || status === "saving"} onClick={() => put(null)} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-slate-300">Reset to default</button>
        </div>
      )}
    </CollapsibleSection>
  );
}

// ─── Column Widths Section (card #357) ──────────────────────────────────────

const UD_MODE_CHOICES: { mode: UdWidthMode; label: string; help: string }[] = [
  { mode: "bestFit", label: "Best fit for each column", help: "Each column is as wide as its title and the longest day's text. (Default)" },
  { mode: "matchLargest", label: "All match the widest best fit", help: "Every column takes the width of the widest one's best fit." },
  { mode: "uniform", label: "One custom width for all", help: "Every column takes the width you set." },
  { mode: "perColumn", label: "Choose per column (best fit or a set width)", help: "Each column uses best fit or a width you set, in any mix." },
];

/** Inches text ("0.75") → hundredths (75) when it is a valid width, else null. */
export function udInchesToHundredths(text: string): number | null {
  const t = text.trim();
  if (!/^\d*(\.\d{0,2})?$/.test(t) || t === "" || t === ".") return null;
  const h = Math.round(Number(t) * 100);
  return Number.isInteger(h) && h >= UD_WIDTH_MIN && h <= UD_WIDTH_MAX ? h : null;
}
const udHundredthsToInches = (h: number) => (h / 100).toFixed(2);

type UdDraft = { mode: UdWidthMode; uniform: string; per: Record<string, string> };
const udDraftFrom = (s: UdWidthSettings): UdDraft => ({
  mode: s.mode,
  uniform: udHundredthsToInches(s.uniformHundredths),
  per: Object.fromEntries(Object.entries(s.perColumn).map(([k, v]) => [k, udHundredthsToInches(v)])),
});

/** Card #360: a column with a width entry is Custom; one without is Best fit. */
export function udColumnChoice(per: Record<string, string>, key: string): "bestFit" | "custom" {
  return per[key] === undefined ? "bestFit" : "custom";
}
/** Best fit removes the column's width; Custom keeps what was typed, else pre-fills `prefill`. */
export function udSetColumnChoice(per: Record<string, string>, key: string, choice: "bestFit" | "custom", prefill: string): Record<string, string> {
  const next = { ...per };
  if (choice === "bestFit") delete next[key];
  else next[key] = per[key] ?? prefill;
  return next;
}

/** What Save would store, or the problem to show when an entry is not a valid width. */
/** Card #364: the width (hundredths) the user set for a column in the draft — one width for
 *  all, or its Custom width — or null (best fit, match largest, or text that is not a width). */
export function udSetWidthHundredths(shown: UdDraft, key: string): number | null {
  if (shown.mode === "uniform") return udInchesToHundredths(shown.uniform);
  if (shown.mode === "perColumn" && shown.per[key] !== undefined) return udInchesToHundredths(shown.per[key]);
  return null;
}

export function udParseDraft(
  shown: UdDraft,
  saved: UdWidthSettings,
  columns: { key: string; label: string }[],
): { value: UdWidthSettings } | { problem: string } {
  const range = `${udHundredthsToInches(UD_WIDTH_MIN)} to ${udHundredthsToInches(UD_WIDTH_MAX)} inches`;
  const uniform = shown.mode === "uniform" ? udInchesToHundredths(shown.uniform) : (udInchesToHundredths(shown.uniform) ?? saved.uniformHundredths);
  if (uniform == null) return { problem: `Enter a width from ${range}.` };
  // Entries for columns not on this page (none today) are kept as they were.
  const perColumn: Record<string, number> = {};
  for (const [k, v] of Object.entries(saved.perColumn)) if (!columns.some((c) => c.key === k)) perColumn[k] = v;
  for (const c of columns) {
    const t = shown.per[c.key];
    if (t === undefined) continue; // Best fit: no width stored
    const h = udInchesToHundredths(t);
    if (h == null) {
      if (shown.mode === "perColumn") return { problem: `${c.label}: enter a width from ${range}, or choose Best fit.` };
      const old = saved.perColumn[c.key];
      if (old != null) perColumn[c.key] = old;
      continue;
    }
    perColumn[c.key] = h;
  }
  return { value: { mode: shown.mode, uniformHundredths: uniform, perColumn } };
}

function UdColumnWidthSection({
  initial,
  aggColumns,
  dedicatedShifts,
}: {
  initial: UdWidthSettings;
  aggColumns: { id: string; label: string }[];
  dedicatedShifts: { id: string; code: string }[];
}) {
  const canEdit = useCanEdit();
  const [saved, setSaved] = useState<UdWidthSettings>(initial);
  const [draft, setDraft] = useState<UdDraft | null>(null); // null = showing the saved choice
  const shown = draft ?? udDraftFrom(saved);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const saving = status === "saving";
  const columns = [
    ...aggColumns.map((c) => ({ key: specialColumnKey("agg", c.id), label: `${c.label || "(untitled)"} · additional column` })),
    ...dedicatedShifts.map((st) => ({ key: specialColumnKey("ded", st.id), label: `${st.code} · shift column` })),
  ];
  const edit = (patch: Partial<UdDraft>) => setDraft({ ...shown, ...patch });
  // Card #359: each column's width as the schedule page last measured it (this browser).
  // Read after mount, never in useState init (server render has no storage).
  const [widthsNow, setWidthsNow] = useState<UdWidthSnapshot | null>(null);
  useEffect(() => {
    setWidthsNow(loadUdWidthSnapshot());
    const onStorage = (e: StorageEvent) => { if (e.key === UD_WIDTH_SNAPSHOT_KEY) setWidthsNow(loadUdWidthSnapshot()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const nowMonth = widthsNow ? new Date(`${widthsNow.month}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "";

  const parsed = udParseDraft(shown, saved, columns);
  const same = (a: UdWidthSettings, b: UdWidthSettings) =>
    a.mode === b.mode && a.uniformHundredths === b.uniformHundredths
    && JSON.stringify(Object.entries(a.perColumn).sort()) === JSON.stringify(Object.entries(b.perColumn).sort());
  const dirty = draft !== null && (!("value" in parsed) || !same(parsed.value, saved));
  const isDefault = same(saved, DEFAULT_UD_WIDTH);

  async function put(value: UdWidthSettings) {
    setStatus("saving");
    setError("");
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printUdWidthMode: value.mode, printUdWidthHundredths: value.uniformHundredths, printUdColumnWidths: value.perColumn }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved({ ...value, perColumn: { ...value.perColumn } });
      setDraft(null);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setStatus("error");
    }
  }

  const input = "w-20 px-2 py-1 text-xs bg-slate-900 border border-slate-600 rounded text-slate-200 disabled:opacity-50";
  return (
    <CollapsibleSection
      id="ud-column-widths"
      title="Column Widths"
      description="How wide the Additional Columns and the shift columns print: on the printed schedule, the year PDF and spreadsheet, and the schedule's print columns view. A column is never narrower than its title; when the columns do not fit the page, they narrow together (widest first) and the printout shrinks if it must."
      status={status}
      error={error}
    >
      <div className="space-y-2" role="radiogroup" aria-label="Column width">
        {UD_MODE_CHOICES.map((c) => (
          <label key={c.mode} className="flex items-start gap-2 text-sm text-slate-300">
            <input type="radio" name="ud-width-mode" className="mt-1" checked={shown.mode === c.mode} disabled={!canEdit || saving} onChange={() => edit({ mode: c.mode })} />
            <span>
              {c.label}
              <span className="block text-xs text-slate-500">{c.help}</span>
            </span>
          </label>
        ))}
      </div>
      {shown.mode === "uniform" && (
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
          Width
          <input type="text" inputMode="decimal" aria-label="Width for all columns, in inches" className={input} value={shown.uniform} disabled={!canEdit || saving} onChange={(e) => edit({ uniform: e.target.value })} />
          inches ({udHundredthsToInches(UD_WIDTH_MIN)}–{udHundredthsToInches(UD_WIDTH_MAX)})
        </label>
      )}
      {columns.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No additional or shift columns are set up.</p>
      ) : (
        <div className="mt-3">
          <p className="text-xs text-slate-500">
            {widthsNow
              ? `Widths as the printout of ${nowMonth} uses them (best fit: the width its text needs). Saving a change updates them the next time the schedule is opened.`
              : "Open the schedule once in this browser to see each column's width here."}
          </p>
          <ul className="mt-2 space-y-1">
            {columns.map((c) => {
              const now = widthsNow?.cols[c.key];
              const bestFit = now ? udHundredthsToInches(Math.max(UD_WIDTH_MIN, Math.min(UD_WIDTH_MAX, Math.ceil(now.bestFitIn * 100)))) : null;
              const choice = udColumnChoice(shown.per, c.key);
              // Card #364: a set width under the title prints at the title's width instead (one
              // width for all: every column at the widest title).
              const inches = (v: number) => udHundredthsToInches(Math.ceil(Math.round(v * 1e6) / 1e4));
              const floorIn = udTitleFloorIn(shown.mode, c.key, widthsNow?.cols ?? {});
              const titleWarn = udNarrowerThanTitle(udSetWidthHundredths(shown, c.key), now?.titleIn) && now?.titleIn != null && floorIn != null
                ? { own: inches(now.titleIn), at: inches(Math.max(floorIn, now.titleIn)), all: shown.mode === "uniform" } : null;
              return (
                <li key={c.key} className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                  <span className="flex-1 min-w-[10rem]">{c.label}</span>
                  <span data-ud-width-now="" className="text-xs text-slate-400 tabular-nums w-24">{now ? `now ${now.printIn.toFixed(2)} in` : "now —"}</span>
                  <span data-ud-best-fit="" className="text-xs text-slate-500 tabular-nums w-28">{bestFit ? `best fit ${bestFit} in` : ""}</span>
                  {shown.mode === "perColumn" && (
                    <>
                      <select data-ud-col-choice="" aria-label={`${c.label} width choice`} className="px-2 py-1 text-xs bg-slate-900 border border-slate-600 rounded text-slate-200 disabled:opacity-50" value={choice} disabled={!canEdit || saving}
                        onChange={(e) => edit({ per: udSetColumnChoice(shown.per, c.key, e.target.value === "custom" ? "custom" : "bestFit", saved.perColumn[c.key] != null ? udHundredthsToInches(saved.perColumn[c.key]) : (bestFit ?? "")) })}>
                        <option value="bestFit">Best fit</option>
                        <option value="custom">Custom</option>
                      </select>
                      {choice === "custom" && (
                        <>
                          <input type="text" inputMode="decimal" aria-label={`${c.label} width, in inches`} className={input} value={shown.per[c.key] ?? ""} disabled={!canEdit || saving} onChange={(e) => edit({ per: { ...shown.per, [c.key]: e.target.value } })} />
                          <span className="text-xs text-slate-500">in</span>
                        </>
                      )}
                    </>
                  )}
                  {titleWarn && (
                    <span data-ud-title-warning="" className="basis-full text-xs text-amber-400">
                      This width is narrower than its title, which needs {titleWarn.own} in.{" "}
                      {titleWarn.all ? <>Every column prints at {titleWarn.at} in so all titles fit.</> : <>It prints at {titleWarn.at} in so the title fits.</>}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {draft !== null && "problem" in parsed && <p className="mt-2 text-xs text-amber-400">{parsed.problem}</p>}
      {canEdit && (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={!dirty || saving || !("value" in parsed)} onClick={() => "value" in parsed && put(parsed.value)} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-white">Save</button>
          <button type="button" disabled={saving || draft === null} onClick={() => setDraft(null)} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-slate-300">Cancel</button>
          <button type="button" disabled={isDefault || saving} onClick={() => put({ ...DEFAULT_UD_WIDTH, perColumn: {} })} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-slate-300">Reset to default</button>
        </div>
      )}
    </CollapsibleSection>
  );
}

// ─── Count Columns Section ──────────────────────────────────────────────────

function CountColumnsSection({ initial, shiftTypes, onSaved }: { initial: { id: string; label: string; shiftTypeIds: string[] }[]; shiftTypes: ShiftType[]; onSaved?: (saved: { id: string; label: string }[]) => void }) {
  const canEdit = useCanEdit();
  // Columns name their shifts by id; the chip text is the shift's CURRENT code from the
  // page's shared shift list, so a rename shows here at once.
  const [columns, setColumns] = useState<{ id?: string; label: string; shiftTypeIds: string[] }[]>(initial.map((c) => ({ id: c.id, label: c.label, shiftTypeIds: [...c.shiftTypeIds] })));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const pickable = shiftTypes.filter((st) => !st.isOffShift);
  const codeOf = (id: string) => shiftTypes.find((st) => st.id === id)?.code ?? "?";

  async function save() {
    setStatus("saving");
    setError("");
    try {
      // Ids only — codes never travel in a write (a server could resolve a renamed-and-reused
      // code to the wrong shift). A pre-slice server has no such route and answers 404: the
      // message asks for a reload, nothing changes.
      const res = await fetch(COUNT_COLUMNS_SAVE_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCountColumnsSave(columns)),
      });
      if (!res.ok) throw new Error(countColumnsSaveErrorMessage(res.status, await res.text()));
      const saved = (await res.json()) as { id: string; label: string; shiftTypeIds: string[] }[];
      setColumns(saved.map((c) => ({ id: c.id, label: c.label, shiftTypeIds: [...c.shiftTypeIds] })));
      onSaved?.(saved.map((c) => ({ id: c.id, label: c.label })));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setStatus("error");
    }
  }

  function addColumn() {
    setColumns([...columns, { label: "", shiftTypeIds: [] }]);
  }

  function removeColumn(idx: number) {
    setColumns(columns.filter((_, i) => i !== idx));
  }

  function updateLabel(idx: number, label: string) {
    setColumns(columns.map((c, i) => (i === idx ? { ...c, label } : c)));
  }

  function addShift(idx: number, shiftTypeId: string) {
    setColumns(columns.map((c, i) => (i === idx && !c.shiftTypeIds.includes(shiftTypeId) ? { ...c, shiftTypeIds: [...c.shiftTypeIds, shiftTypeId] } : c)));
  }

  function removeShift(idx: number, shiftTypeId: string) {
    setColumns(columns.map((c, i) => (i === idx ? { ...c, shiftTypeIds: c.shiftTypeIds.filter((id) => id !== shiftTypeId) } : c)));
  }

  return (
    <CollapsibleSection
      id="count-columns"
      title="Count Columns on Printed Schedule"
      description="Define columns that count staff per day on the schedule grid."
      status={status}
      error={error}
    >

      <div className="space-y-3">
        {columns.map((col, idx) => (
          <div key={idx} className="flex items-start gap-3 bg-slate-900/50 rounded p-3 border border-slate-700">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-14">Header:</span>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={col.label}
                  onChange={(e) => updateLabel(idx, e.target.value)}
                  placeholder="e.g. OR"
                  className="bg-slate-700 text-slate-200 rounded px-2 py-1 text-sm border border-slate-600 w-32 disabled:opacity-50"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 w-14">Shifts:</span>
                {col.shiftTypeIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-0.5 bg-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-xs border border-slate-600">
                    {codeOf(id)}
                    {canEdit && <button onClick={() => removeShift(idx, id)} className="text-slate-500 hover:text-red-400 ml-0.5">×</button>}
                  </span>
                ))}
                {canEdit && (
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) addShift(idx, e.target.value); }}
                    className="bg-slate-700 text-slate-400 rounded px-1 py-0.5 text-xs border border-slate-600"
                  >
                    <option value="">+ add</option>
                    {pickable.filter((st) => !col.shiftTypeIds.includes(st.id)).map((st) => (
                      <option key={st.id} value={st.id}>{st.code}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            {canEdit && <button onClick={() => removeColumn(idx)} className="text-slate-500 hover:text-red-400 text-sm mt-1">×</button>}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-4">
        {canEdit && <button onClick={addColumn} className="text-xs text-blue-400 hover:text-blue-300">+ Add column</button>}
        {canEdit && <button onClick={save} disabled={status === "saving"} className="ml-auto px-3 py-1.5 text-xs font-medium rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
          {status === "saving" ? "Saving..." : "Save"}
        </button>}
      </div>
    </CollapsibleSection>
  );
}

// ─── Print Column Rules Section ─────────────────────────────────────────────

type EditCondition = {
  quantifier: string; // has_any | has_none | has_all
  categories: string[]; // work | leave | off
  shiftTypeIds: string[]; // shifts by id (never codes: a renamed-and-reused code could name the wrong shift)
  exceptIds: string[];
};
type EditPrintRule = {
  label: string;
  enabled: boolean;
  mode: string;
  employmentTypeIds: string[];
  minFtePercentage: number | null;
  maxFtePercentage: number | null;
  conditions: EditCondition[];
};

const CATS: { key: string; label: string }[] = [
  { key: "work", label: "Work" },
  { key: "leave", label: "Leave" },
  { key: "off", label: "Off (X)" },
];
const QUANTS: { key: string; label: string }[] = [
  { key: "has_any", label: "Has any" },
  { key: "has_none", label: "Has none" },
  { key: "has_all", label: "Has all of" },
];

// The match fields shared by an individual-column rule and an aggregate-column rule.
type RuleFields = {
  employmentTypeIds: string[];
  minFtePercentage: number | null;
  maxFtePercentage: number | null;
  conditions: EditCondition[];
};

// Shared editor for a rule's match fields (employment types + FTE bounds + shift
// conditions). Used by both Printed Schedule Columns (which staff get their own
// column) and Additional Columns (aggregate-column membership) — identical matching
// semantics, so the editor is factored out rather than duplicated.
function RuleFieldsEditor({
  value,
  onChange,
  employmentTypes,
  shifts,
  canEdit,
}: {
  value: RuleFields;
  onChange: (patch: Partial<RuleFields>) => void;
  employmentTypes: EmploymentTypeData[];
  shifts: ShiftType[]; // the page's shared shift list — a rename shows in the chips at once
  canEdit: boolean;
}) {
  const empName = (id: string) => employmentTypes.find((e) => e.id === id)?.name ?? id;
  const codeOf = (id: string) => shifts.find((st) => st.id === id)?.code ?? "?";
  const conds = value.conditions;
  const setConds = (c: EditCondition[]) => onChange({ conditions: c });
  const addCond = () => setConds([...conds, { quantifier: "has_any", categories: [], shiftTypeIds: [], exceptIds: [] }]);
  const removeCond = (ci: number) => setConds(conds.filter((_, j) => j !== ci));
  const updateCond = (ci: number, patch: Partial<EditCondition>) =>
    setConds(conds.map((c, j) => (j === ci ? { ...c, ...patch } : c)));
  const toggleCat = (ci: number, cat: string) => {
    const c = conds[ci];
    updateCond(ci, { categories: c.categories.includes(cat) ? c.categories.filter((x) => x !== cat) : [...c.categories, cat] });
  };
  const addListItem = (ci: number, field: "shiftTypeIds" | "exceptIds", id: string) => {
    const c = conds[ci];
    if (c[field].includes(id)) return;
    updateCond(ci, { [field]: [...c[field], id] });
  };
  const removeListItem = (ci: number, field: "shiftTypeIds" | "exceptIds", id: string) => {
    const c = conds[ci];
    updateCond(ci, { [field]: c[field].filter((x) => x !== id) });
  };
  const addEmp = (id: string) => onChange({ employmentTypeIds: [...value.employmentTypeIds, id] });
  const removeEmp = (id: string) => onChange({ employmentTypeIds: value.employmentTypeIds.filter((x) => x !== id) });

  // Chip + add-dropdown for a condition's shift / except lists (values are shift ids; chips show the current code).
  function codeChips(ci: number, field: "shiftTypeIds" | "exceptIds", label: string) {
    const c = conds[ci];
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[11px] text-slate-500">{label}</span>
        {c[field].map((id) => (
          <span key={id} className="inline-flex items-center gap-0.5 bg-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-[11px] border border-slate-600">
            {codeOf(id)}
            {canEdit && <button onClick={() => removeListItem(ci, field, id)} className="text-slate-500 hover:text-red-400 ml-0.5">×</button>}
          </span>
        ))}
        {canEdit && (
          <select value="" onChange={(e) => { if (e.target.value) addListItem(ci, field, e.target.value); }} className="bg-slate-700 text-slate-400 rounded px-1 py-0.5 text-[11px] border border-slate-600">
            <option value="">+</option>
            {shifts.filter((st) => !c[field].includes(st.id)).map((st) => <option key={st.id} value={st.id}>{st.code}</option>)}
          </select>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500 w-20">Emp. types:</span>
        {value.employmentTypeIds.map((id) => (
          <span key={id} className="inline-flex items-center gap-0.5 bg-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-xs border border-slate-600">
            {empName(id)}
            {canEdit && <button onClick={() => removeEmp(id)} className="text-slate-500 hover:text-red-400 ml-0.5">×</button>}
          </span>
        ))}
        {value.employmentTypeIds.length === 0 && <span className="text-xs text-slate-600 italic">any</span>}
        {canEdit && (
          <select value="" onChange={(e) => { if (e.target.value) addEmp(e.target.value); }} className="bg-slate-700 text-slate-400 rounded px-1 py-0.5 text-xs border border-slate-600">
            <option value="">+ add</option>
            {employmentTypes.filter((et) => !value.employmentTypeIds.includes(et.id)).map((et) => <option key={et.id} value={et.id}>{et.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {/* FTE as a fraction, like the Staff page (1.0 = full time, 0.2 = one day a week). */}
        <span className="text-xs text-slate-500 w-20">FTE:</span>
        <DecimalField aria-label="Minimum FTE" min={0} decimals={3} disabled={!canEdit} value={value.minFtePercentage} onValueChange={(v) => onChange({ minFtePercentage: v })} placeholder="min" className="bg-slate-700 text-slate-200 rounded px-2 py-1 text-xs border border-slate-600 w-20 disabled:opacity-50" />
        <span className="text-xs text-slate-500">to</span>
        <DecimalField aria-label="Maximum FTE" min={0} decimals={3} disabled={!canEdit} value={value.maxFtePercentage} onValueChange={(v) => onChange({ maxFtePercentage: v })} placeholder="max" className="bg-slate-700 text-slate-200 rounded px-2 py-1 text-xs border border-slate-600 w-20 disabled:opacity-50" />
        <span className="text-xs text-slate-600 italic">e.g. 0.2 to 0.8; blank = no bound</span>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs text-slate-500">Shift conditions {conds.length > 1 && <span className="text-slate-600">(all required)</span>}:</span>
        {conds.map((c, ci) => (
          <div key={ci} className="flex items-start gap-2 flex-wrap bg-slate-800/60 rounded px-2 py-1.5 border border-slate-700">
            <select disabled={!canEdit} value={c.quantifier} onChange={(e) => updateCond(ci, { quantifier: e.target.value })} className="bg-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-[11px] border border-slate-600 disabled:opacity-50">
              {QUANTS.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
            </select>
            {c.quantifier !== "has_all" && (
              <span className="flex items-center gap-1">
                {CATS.map((cat) => {
                  const on = c.categories.includes(cat.key);
                  return (
                    <button key={cat.key} disabled={!canEdit} onClick={() => toggleCat(ci, cat.key)} className={`text-[11px] rounded px-1.5 py-0.5 border ${on ? "bg-blue-600 text-white border-blue-500" : "bg-slate-700 text-slate-400 border-slate-600"} disabled:opacity-50`}>
                      {cat.label}
                    </button>
                  );
                })}
              </span>
            )}
            {codeChips(ci, "shiftTypeIds", c.quantifier === "has_all" ? "shifts:" : "+shifts:")}
            {c.quantifier !== "has_all" && c.categories.length > 0 && codeChips(ci, "exceptIds", "except:")}
            {canEdit && <button onClick={() => removeCond(ci)} className="text-slate-500 hover:text-red-400 text-sm ml-auto">×</button>}
          </div>
        ))}
        {conds.length === 0 && <span className="text-[11px] text-slate-600 italic">no shift condition (any staff of the above type/FTE)</span>}
        {canEdit && <button onClick={addCond} className="text-[11px] text-blue-400 hover:text-blue-300">+ Add condition</button>}
      </div>
    </>
  );
}

function PrintColumnRulesSection({
  initial,
  shiftTypes,
  employmentTypes,
}: {
  initial: PrintColumnRuleData[];
  shiftTypes: ShiftType[];
  employmentTypes: EmploymentTypeData[];
}) {
  const canEdit = useCanEdit();
  const [rules, setRules] = useState<EditPrintRule[]>(
    initial.map((r) => ({
      label: r.label,
      enabled: r.enabled,
      mode: r.mode === "exclude" ? "exclude" : "include",
      employmentTypeIds: [...r.employmentTypeIds],
      minFtePercentage: r.minFtePercentage,
      maxFtePercentage: r.maxFtePercentage,
      conditions: (r.conditions ?? []).map((c) => ({
        quantifier: c.quantifier,
        categories: [...c.categories],
        shiftTypeIds: [...c.shiftTypeIds],
        exceptIds: [...c.exceptIds],
      })),
    })),
  );
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  function update(idx: number, patch: Partial<EditPrintRule>) {
    setRules(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRule(rule: EditPrintRule) { setRules([...rules, rule]); }
  function removeRule(idx: number) { setRules(rules.filter((_, i) => i !== idx)); }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    [next[idx], next[j]] = [next[j], next[idx]];
    setRules(next);
  }

  function blank(): EditPrintRule {
    return { label: "", enabled: true, mode: "include", employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions: [] };
  }

  async function save() {
    setStatus("saving");
    setError("");
    try {
      // Ids only (buildConditionsSave also drops conditions with no positive selector). A
      // pre-slice server has no such route and answers 404: the message asks for a reload.
      const payload = rules.map((r) => ({ ...r, conditions: buildConditionsSave(r.conditions) }));
      const res = await fetch(PRINT_COLUMN_RULES_SAVE_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: payload }),
      });
      if (!res.ok) throw new Error(printSaveErrorMessage(res.status, await res.text()));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setStatus("error");
    }
  }

  return (
    <CollapsibleSection
      id="print-staff-columns"
      title="Staff Columns on Printed Schedule"
      description="Rules deciding which staff get their own column when printing. Include rules pick who prints (no include rules = everyone); exclude rules then remove matches. A rule's shift conditions are ALL required (AND). No rules = print everyone. Print-only — the on-screen grid always shows all staff."
      status={status}
      error={error}
    >

      <div className="space-y-3">
        {rules.map((rule, idx) => (
          <div key={idx} className="bg-slate-900/50 rounded p-3 border border-slate-700 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1 text-xs text-slate-400">
                <input type="checkbox" disabled={!canEdit} checked={rule.enabled} onChange={(e) => update(idx, { enabled: e.target.checked })} />
                On
              </label>
              <select disabled={!canEdit} value={rule.mode} onChange={(e) => update(idx, { mode: e.target.value })} className="bg-slate-700 text-slate-200 rounded px-1.5 py-1 text-xs border border-slate-600 disabled:opacity-50" title="Include = print matching staff; Exclude = print everyone except matching staff">
                <option value="include">Include</option>
                <option value="exclude">Exclude</option>
              </select>
              <input type="text" disabled={!canEdit} value={rule.label} onChange={(e) => update(idx, { label: e.target.value })} placeholder="Rule name" className="bg-slate-700 text-slate-200 rounded px-2 py-1 text-sm border border-slate-600 flex-1 min-w-32 disabled:opacity-50" />
              {canEdit && (
                <span className="flex items-center gap-1">
                  <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-slate-500 hover:text-slate-300 disabled:opacity-30 text-xs" title="Move up">▲</button>
                  <button onClick={() => move(idx, 1)} disabled={idx === rules.length - 1} className="text-slate-500 hover:text-slate-300 disabled:opacity-30 text-xs" title="Move down">▼</button>
                  <button onClick={() => removeRule(idx)} className="text-slate-500 hover:text-red-400 text-sm ml-1">×</button>
                </span>
              )}
            </div>

            <RuleFieldsEditor value={rule} onChange={(patch) => update(idx, patch)} employmentTypes={employmentTypes} shifts={shiftTypes} canEdit={canEdit} />
          </div>
        ))}
        {rules.length === 0 && <p className="text-xs text-slate-500 italic">No rules — the printed schedule shows every staff member.</p>}
      </div>

      {canEdit && (
        <div className="flex items-center gap-3 mt-4">
          <button onClick={() => addRule(blank())} className="text-xs text-blue-400 hover:text-blue-300">+ Add rule</button>
          <button onClick={save} disabled={status === "saving"} className="ml-auto px-3 py-1.5 text-xs font-medium rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
            {status === "saving" ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </CollapsibleSection>
  );
}

type EditAggCol = {
  id?: string; // card #300: the saved row's id (kept on save so the column order can name it)
  label: string;
  enabled: boolean;
  isOther: boolean;
  suppressMembers: boolean;
  conditionScope: string; // "month" (match over the whole month) | "day" (match per day)
  lines: EditAggLine[]; // card #309
};

// Card #309: one Include / Exclude rule line of a printed column.
type EditAggLine = RuleFields & { mode: "include" | "exclude"; staffIds: string[] };

// Configurable AGGREGATE columns on the printed schedule (the replacement for the old
// hardcoded "FB" column). Each named column lists, per day, the initials of the staff
// matching its rule who are scheduled that day; suppressMembers hides those staff's own
// columns. A column with the "Catch-all" (isOther) flag has no rule and lists the
// residual — staff who appear in no other column. Catch-all is just a per-column toggle:
// columns are otherwise identical and all freely editable / movable / deletable.
// ─── Scheduler tuning (card #215) ────────────────────────────────────────────

const TUNING_FIELDS: { key: Exclude<TuningKey, "weekendStartDow">; label: string; description: string }[] = [
  { key: "spreadRadiusDays", label: "Spacing reach (days)", description: "For shifts marked \u201cSpread out as much as possible\u201d: how many days either side of a shift count as close to it. Larger keeps them further apart." },
  { key: "evenBandCalls", label: "Even-counts band", description: "For shifts marked \u201cKeep counts even across months\u201d: a person this many shifts ahead of the lowest this month is passed over. 1 keeps everyone within one shift." },
  { key: "softRequestOffWeight", label: "Soft \u201cprefer off\u201d pull", description: "How strongly a soft day-off request pulls that day into a person\u2019s days off. It only acts within the slack the hours target leaves. 0 = ignore soft requests here." },
  { key: "softAvoidFollowWeight", label: "Soft \u201cavoid after\u201d cost", description: "How much one soft \u201cavoid this shift after that one\u201d pair counts against a choice of fill days. 0 = ignore these pairs here." },
  { key: "scarcePoolSize", label: "Few-people warning", description: "A shift that at most this many people can work marks a pay period\u2019s hours gap as structural (no fix the scheduler can make). 0 = never." },
];

function SchedulerTuningSection({ initial, onSaved }: { initial: SchedulerTuning; onSaved: (t: SchedulerTuning) => void }) {
  const canEdit = useCanEdit();
  // Text per field while typing; a value is sent only when it passes the shared check.
  const [draft, setDraft] = useState<Record<TuningKey, string>>(() => Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, String(v)])) as Record<TuningKey, string>);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | undefined>();
  // Card #214's writer: one save at a time per field, newest wins, a late result never
  // changes the page. `server` is what the server holds (the rollback target).
  const [writer] = useState<LatestWriter<TuningKey, number>>(() => {
    let server: SchedulerTuning = { ...initial };
    return createLatestWriter<TuningKey, number>(
      async (key, value) => {
        const res = await fetch("/api/settings/scheduling-preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value }),
        });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Save failed");
        server = { ...server, [key]: value };
        onSaved({ ...server });
      },
      (key, _value, err) => {
        if (err === null) {
          setStatus("saved");
          setTimeout(() => setStatus("idle"), 2000);
        } else {
          setDraft((d) => ({ ...d, [key]: String(server[key]) }));
          setStatus("error");
          setError(err instanceof Error ? err.message : "Save failed");
        }
      },
    );
  });

  function commit(key: TuningKey, text: string) {
    const value = text.trim() === "" ? NaN : Number(text);
    const bad = tuningError(key, value);
    if (bad) { setStatus("error"); setError(bad.replace(key, TUNING_FIELDS.find((f) => f.key === key)?.label ?? key)); return; }
    setDraft((d) => ({ ...d, [key]: String(value) }));
    setStatus("saving");
    setError(undefined);
    writer.write(key, value);
  }

  return (
    <CollapsibleSection
      id="scheduler-tuning"
      title="Scheduler tuning"
      description="Numbers the scheduler uses when it weighs choices, and which two days are the weekend. The defaults are what the scheduler has always used."
      status={status}
      error={error}
    >
      <div className="space-y-2">
        <FieldRow label="Weekend" description="The two days counted as the weekend: weekend hours, paired weekend shifts and weekend shading. The second day is always the day after the first.">
          <select
            disabled={!canEdit}
            aria-label="Weekend"
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm disabled:opacity-50"
            value={draft.weekendStartDow}
            onChange={(e) => canEdit && commit("weekendStartDow", e.target.value)}
          >
            {WEEKDAY_NAMES.map((_n, dow) => <option key={dow} value={String(dow)}>{weekendLabel(dow)}</option>)}
          </select>
        </FieldRow>
        {TUNING_FIELDS.map((f) => {
          return (
            <FieldRow key={f.key} label={f.label} description={`${f.description} Default ${TUNING_DEFAULTS[f.key]}.`}>
              <input
                disabled={!canEdit}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                aria-label={f.label}
                value={draft[f.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                onBlur={(e) => canEdit && tuningNeedsSave(e.target.value, initial[f.key], writer.busy(f.key)) && commit(f.key, e.target.value)}
                className="w-24 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center disabled:opacity-50"
              />
            </FieldRow>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}

// ─── Weekend and Holiday Shading (card #209) ─────────────────────────────────

type ShadeKey = "printWeekendColor" | "printHolidayColor" | "screenHolidayColor";
const SHADE_FIELDS: { key: ShadeKey; label: string; description: string; fallback: string }[] = [
  { key: "printWeekendColor", label: "Weekends (printed)", description: "Shade of every weekend row (the weekend days under Scheduler tuning) on the printed schedule.", fallback: "#EBEBEB" },
  { key: "printHolidayColor", label: "Holidays (printed)", description: "Shade of every date in the Holidays list on the printed schedule. Wins over the weekend shade.", fallback: "#D0D0D0" },
  { key: "screenHolidayColor", label: "Holidays (on screen)", description: "Tint of every date in the Holidays list on the schedule grid.", fallback: "#4A3410" },
];

function DayShadingSection({ initial }: { initial: Pick<SchedulingPrefs, ShadeKey> }) {
  const canEdit = useCanEdit();
  const [vals, setVals] = useState<Pick<SchedulingPrefs, ShadeKey>>({ ...initial });
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | undefined>();

  // What the server holds per field (updated on EVERY successful write, reported or not —
  // the rollback target), a per-field debounce so dragging the colour picker sends one save,
  // and card #214's writer: one save at a time per field, newest choice wins, an older
  // save's late result never changes the page.
  const timers = useRef<Partial<Record<ShadeKey, ReturnType<typeof setTimeout>>>>({});
  const [writer] = useState<LatestWriter<ShadeKey, string | null>>(() => {
    let server: Pick<SchedulingPrefs, ShadeKey> = { ...initial };
    return createLatestWriter<ShadeKey, string | null>(
      async (key, value) => {
        const res = await fetch("/api/settings/scheduling-preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value }),
        });
        if (!res.ok) throw new Error(await res.text());
        server = { ...server, [key]: value };
      },
      (key, _value, err) => {
        if (err === null) {
          setStatus("saved");
          setTimeout(() => setStatus("idle"), 2000);
        } else {
          setVals((v) => ({ ...v, [key]: server[key] }));
          setStatus("error");
          setError(err instanceof Error ? err.message : "Save failed");
        }
      },
    );
  });
  useEffect(() => () => { for (const t of Object.values(timers.current)) if (t) clearTimeout(t); }, []);

  function saveSoon(key: ShadeKey, value: string) {
    setVals((v) => ({ ...v, [key]: value }));
    const t = timers.current[key];
    if (t) clearTimeout(t);
    timers.current[key] = setTimeout(() => { delete timers.current[key]; save(key, value); }, 400);
  }

  function save(key: ShadeKey, value: string | null) {
    const t = timers.current[key];
    if (t) { clearTimeout(t); delete timers.current[key]; }
    setVals((v) => ({ ...v, [key]: value }));
    setStatus("saving");
    setError(undefined);
    writer.write(key, value);
  }

  return (
    <CollapsibleSection
      id="print-day-shading"
      title="Weekend and Holiday Shading"
      description="Background shading for weekends and holidays. Untick one to switch that shading off. A shift's own print background still wins over these in its cells."
      status={status}
      error={error}
    >
      <div className="space-y-2">
        {SHADE_FIELDS.map((f) => (
          <FieldRow key={f.key} label={f.label} description={f.description}>
            <div className="flex items-center gap-2">
              <input
                disabled={!canEdit}
                type="checkbox"
                aria-label={`${f.label} on`}
                checked={vals[f.key] != null}
                onChange={(e) => canEdit && save(f.key, e.target.checked ? (initial[f.key] ?? f.fallback) : null)}
                className="rounded border-slate-600 w-4 h-4 disabled:opacity-50"
              />
              {vals[f.key] != null && (
                <input
                  disabled={!canEdit}
                  type="color"
                  aria-label={f.label}
                  className="w-8 h-8 rounded cursor-pointer border-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  value={vals[f.key]!}
                  onChange={(e) => canEdit && saveSoon(f.key, e.target.value.toUpperCase())}
                />
              )}
            </div>
          </FieldRow>
        ))}
      </div>
    </CollapsibleSection>
  );
}

// ── Card #301: printed header/footer, table font, DATE/DAY columns ──────────────

/** A section's draft and its last SAVED value. Cancel returns to the saved value; a value
 *  becomes "saved" only once the server accepted it. The caller locks its inputs while
 *  `busy`, so a late result never lands over typing. */
function useSavedDraft<T>(initial: T) {
  const [saved, setSaved] = useState<T>(initial);
  const [draft, setDraft] = useState<T>(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | undefined>();
  // Card #303: one idle timer, cancelled by every new save (and on unmount).
  const [statusTimer] = useState(() => createStatusTimer(() => setStatus("idle")));
  useEffect(() => () => statusTimer.cancel(), [statusTimer]);
  const busy = status === "saving";
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  async function save(body: Record<string, unknown>, next: T) {
    statusTimer.cancel();
    setStatus("saving");
    setError(undefined);
    try {
      const res = await fetch("/api/settings/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(next);
      setDraft(next);
      setStatus("saved");
      statusTimer.arm();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }
  return { saved, draft, setDraft, status, error, busy, dirty, save };
}

const BTN_SAVE = "px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-white";
const BTN_PLAIN = "px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-slate-300";
const INPUT = "bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100 disabled:opacity-50";

function PrintBlockEditor({ label, value, onChange, disabled }: { label: string; value: PrintBlock; onChange: (b: PrintBlock) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        aria-label={`${label} text`}
        maxLength={PRINT_BLOCK_TEXT_MAX}
        value={value.text}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, text: e.target.value.replace(/[\r\n]/g, " ") })}
        className={`${INPUT} flex-1 min-w-[16rem]`}
      />
      <label className="flex items-center gap-1 text-xs text-slate-400">
        Size
        <DecimalField
          integer
          required
          aria-label={`${label} size`}
          min={6}
          max={32}
          value={value.size}
          disabled={disabled}
          onValueChange={(v) => v != null && onChange({ ...value, size: v })}
          className={`${INPUT} w-16`}
        />
        pt
      </label>
      <label className="flex items-center gap-1 text-xs text-slate-400">
        <input
          type="checkbox"
          aria-label={`${label} bold`}
          checked={value.bold}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, bold: e.target.checked })}
          className="rounded border-slate-600 w-4 h-4 disabled:opacity-50"
        />
        Bold
      </label>
      <select
        aria-label={`${label} alignment`}
        value={value.align}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, align: e.target.value as PrintAlign })}
        className={INPUT}
      >
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </select>
    </div>
  );
}

function PrintHeaderFooterSection({ initial }: { initial: PrintLayout }) {
  const { zone } = useTimeZone(); // card #320
  const canEdit = useCanEdit();
  const { saved, draft, setDraft, status, error, busy, dirty, save } = useSavedDraft({ header: initial.header, footer: initial.footer });
  const valid = validatePrintBlock(draft.header).ok && validatePrintBlock(draft.footer).ok;
  const now = new Date();
  // Preview: this month, the current time, and an example saved version.
  const previewCtx: PrintTemplateContext = { year: now.getFullYear(), month: now.getMonth(), printedAt: now, dateFormat: "MM/DD/YYYY", version: 9, zone };
  const previewStyle = (b: PrintBlock): React.CSSProperties => ({ fontFamily: printFontStack(initial.fontFamily), fontSize: `${b.size}pt`, fontWeight: b.bold ? 700 : 400, textAlign: b.align });
  const defaults = { header: DEFAULT_PRINT_LAYOUT.header, footer: DEFAULT_PRINT_LAYOUT.footer };
  return (
    <CollapsibleSection
      id="print-header-footer"
      title="Header & Footer"
      description="The title above the printed schedule and the line under it. Fill-in words: {MONTH} (JANUARY), {Month} (January), {MON} (JAN), {YEAR}, {DATE} (print date, in the date format setting), {TIME} (print time, 24-hour), {VERSION} (the month's saved version, two digits). The footer always ends with “ - YoSched”."
      status={status}
      error={error}
    >
      <div className="space-y-3">
        <FieldRow label="Header" description="Printed above the table.">
          <PrintBlockEditor label="Header" value={draft.header} disabled={!canEdit || busy} onChange={(header) => setDraft({ ...draft, header })} />
        </FieldRow>
        <FieldRow label="Footer" description="Printed under the table, followed by “ - YoSched”.">
          <PrintBlockEditor label="Footer" value={draft.footer} disabled={!canEdit || busy} onChange={(footer) => setDraft({ ...draft, footer })} />
        </FieldRow>
        <div className="rounded border border-slate-700 bg-white text-black px-3 py-2 space-y-1" aria-label="Preview">
          <div style={previewStyle(draft.header)}>{renderPrintTemplate(draft.header.text, previewCtx)}</div>
          <div className="text-[10px] text-slate-400 text-center">… schedule …</div>
          <div style={previewStyle(draft.footer)}>{footerLine(draft.footer.text, previewCtx)}</div>
        </div>
        <p className="text-xs text-slate-500">Preview uses this month, now, and version 09. “{YOSCHED_FOOTER_SUFFIX.trim()}” is always added and can’t be changed.</p>
        {!valid && <p className="text-xs text-red-400">Size must be a whole number from 6 to 32.</p>}
        <div className="flex gap-2">
          <button type="button" disabled={!canEdit || busy || !dirty || !valid} onClick={() => save({ printHeader: draft.header, printFooter: draft.footer }, draft)} className={BTN_SAVE}>Save</button>
          <button type="button" disabled={!canEdit || busy || !dirty} onClick={() => setDraft(saved)} className={BTN_PLAIN}>Cancel</button>
          <button type="button" disabled={!canEdit || busy} onClick={() => save({ printHeader: null, printFooter: null }, defaults)} className={BTN_PLAIN}>Reset to default</button>
        </div>
      </div>
    </CollapsibleSection>
  );
}

const FONT_SUGGESTIONS = ["Aptos Narrow", "Arial Narrow", "Archivo Narrow", "Calibri", "Arial"];

function PrintFontSection({ initial }: { initial: PrintLayout }) {
  const canEdit = useCanEdit();
  const { saved, draft, setDraft, status, error, busy, dirty, save } = useSavedDraft({ fontFamily: initial.fontFamily, fontSize: initial.fontSize, payPeriodLabels: initial.payPeriodLabels });
  const valid = validatePrintFontFamily(draft.fontFamily) && validatePrintFontSize(draft.fontSize);
  const d = DEFAULT_PRINT_LAYOUT;
  const defaults = { fontFamily: d.fontFamily, fontSize: d.fontSize, payPeriodLabels: d.payPeriodLabels };
  return (
    <CollapsibleSection
      id="print-font"
      title="Table Font"
      description="The font of the printed schedule. When the chosen font is not installed on the computer that prints, YoSched’s own narrow font is used."
      status={status}
      error={error}
    >
      <div className="space-y-3">
        <FieldRow label="Font" description="Letters, digits, spaces and hyphens.">
          <input
            type="text"
            list="print-font-suggestions"
            aria-label="Font"
            maxLength={64}
            value={draft.fontFamily}
            disabled={!canEdit || busy}
            onChange={(e) => setDraft({ ...draft, fontFamily: e.target.value })}
            className={`${INPUT} w-56`}
            style={{ fontFamily: validatePrintFontFamily(draft.fontFamily) ? printFontStack(draft.fontFamily) : undefined }}
          />
          <datalist id="print-font-suggestions">
            {FONT_SUGGESTIONS.map((f) => <option key={f} value={f} />)}
          </datalist>
        </FieldRow>
        <FieldRow label="Size" description="Points, 6 to 14 (the header and footer have their own sizes).">
          <DecimalField
            integer
            required
            aria-label="Font size"
            min={6}
            max={14}
            value={draft.fontSize}
            disabled={!canEdit || busy}
            onValueChange={(v) => v != null && setDraft({ ...draft, fontSize: v })}
            className={`${INPUT} w-20`}
          />
        </FieldRow>
        <FieldRow label="Pay-period labels" description={`Print “${ppLabelText(1)}” to the right of the first day of each pay period.`}>
          <input
            type="checkbox"
            aria-label="Pay-period labels"
            checked={draft.payPeriodLabels}
            disabled={!canEdit || busy}
            onChange={(e) => setDraft({ ...draft, payPeriodLabels: e.target.checked })}
            className="rounded border-slate-600 w-4 h-4 disabled:opacity-50"
          />
        </FieldRow>
        {!valid && <p className="text-xs text-red-400">Font: letters, digits, spaces and hyphens. Size: a whole number from 6 to 14.</p>}
        <div className="flex gap-2">
          <button type="button" disabled={!canEdit || busy || !dirty || !valid} onClick={() => save({ printFontFamily: draft.fontFamily, printFontSize: draft.fontSize, printPayPeriodLabels: draft.payPeriodLabels }, draft)} className={BTN_SAVE}>Save</button>
          <button type="button" disabled={!canEdit || busy || !dirty} onClick={() => setDraft(saved)} className={BTN_PLAIN}>Cancel</button>
          <button type="button" disabled={!canEdit || busy} onClick={() => save({ printFontFamily: defaults.fontFamily, printFontSize: defaults.fontSize, printPayPeriodLabels: defaults.payPeriodLabels }, defaults)} className={BTN_PLAIN}>Reset to default</button>
        </div>
      </div>
    </CollapsibleSection>
  );
}

/** Card #323: margin in hundredths of an inch → "0.25". */
export function marginInchesText(h: number): string {
  return (h / 100).toFixed(2);
}
/** "0.25" / ".5" / "1" → hundredths of an inch, or null unless it is 0.25 to 1.00 in steps of 0.01. */
export function parseMarginInches(t: string): number | null {
  const m = /^\s*(\d*)(?:\.(\d{0,2}))?\s*$/.exec(t);
  if (!m || (m[1] === "" && !m[2])) return null;
  const h = Number(m[1] || "0") * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return validatePrintMargin(h) ? h : null;
}

// Card #323: the paper the printout and the year PDF are laid out for, and the margin.
function PrintPaperSection({ initial }: { initial: PrintLayout }) {
  const canEdit = useCanEdit();
  const { saved, draft, setDraft, status, error, busy, dirty, save } = useSavedDraft({ paper: initial.paper, margin: marginInchesText(initial.marginHundredths) });
  const hundredths = parseMarginInches(draft.margin);
  const valid = hundredths !== null;
  const d = DEFAULT_PRINT_LAYOUT;
  const defaults = { paper: d.paper, margin: marginInchesText(d.marginHundredths) };
  // Card #462: judged at 32 printed days, the longest month (one ending on the weekend's first day).
  const shrinks = valid && printFit({ ...initial, paper: draft.paper, marginHundredths: hundredths }, 32).scale < 1;
  return (
    <CollapsibleSection
      id="print-paper"
      title="Paper & Margin"
      description="The paper the printed schedule and the year PDF are laid out for (landscape), and the blank edge on every side. 0.25 in is the smallest edge every common printer can print to."
      status={status}
      error={error}
    >
      <div className="space-y-3">
        <FieldRow label="Paper" description="Load this paper in the printer. On other paper the browser scales the page to fit.">
          <select
            aria-label="Paper"
            value={draft.paper}
            disabled={!canEdit || busy}
            onChange={(e) => setDraft({ ...draft, paper: e.target.value as PrintLayout["paper"] })}
            className={`${INPUT} w-56`}
          >
            {PRINT_PAPERS.map((p) => <option key={p} value={p}>{PAPER_IN[p].label}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Margin" description="Inches on every side, 0.25 to 1.00.">
          <input
            type="text"
            inputMode="decimal"
            aria-label="Margin in inches"
            value={draft.margin}
            disabled={!canEdit || busy}
            onChange={(e) => setDraft({ ...draft, margin: e.target.value })}
            className={`${INPUT} w-20`}
          />
          <span className="ml-2 text-xs text-slate-400">in</span>
        </FieldRow>
        {!valid && <p className="text-xs text-red-400">Margin: a number of inches from 0.25 to 1.00, at most two decimals.</p>}
        {shrinks && <p className="text-xs text-amber-400">At this margin and the saved font, header and footer sizes, a 31-day month is shrunk slightly so it still fits one page.</p>}
        <div className="flex gap-2">
          <button type="button" disabled={!canEdit || busy || !dirty || !valid} onClick={() => save({ printPaperSize: draft.paper, printMarginHundredthsIn: hundredths }, draft)} className={BTN_SAVE}>Save</button>
          <button type="button" disabled={!canEdit || busy || !dirty} onClick={() => setDraft(saved)} className={BTN_PLAIN}>Cancel</button>
          <button type="button" disabled={!canEdit || busy} onClick={() => save({ printPaperSize: defaults.paper, printMarginHundredthsIn: d.marginHundredths }, defaults)} className={BTN_PLAIN}>Reset to default</button>
        </div>
      </div>
    </CollapsibleSection>
  );
}

// Card #299: the year export's file name. Stored as a template with {YEAR}; empty saves
// null (the built-in default).
function ExportFileNameSection({ initial }: { initial: string | null }) {
  const canEdit = useCanEdit();
  const { saved, draft, setDraft, status, error, busy, dirty, save } = useSavedDraft({ name: initial ?? "" });
  const year = new Date().getFullYear();
  const trimmed = draft.name.trim();
  const example = resolveExportFileName(trimmed || null, year);
  const why = trimmed ? exportFileNameError(trimmed.replaceAll("{YEAR}", String(year))) : null;
  return (
    <CollapsibleSection
      id="export-file-name"
      title="Year Export File Name"
      description="The name the Export year button suggests for the Excel and PDF files. {YEAR} is replaced by the exported year. Leave it empty for the built-in name."
      status={status}
      error={error}
    >
      <div className="space-y-3">
        <FieldRow label="File name" description={`Up to ${EXPORT_FILE_NAME_MAX} characters, without \\ / : * ? " < > |.`}>
          <input
            type="text"
            aria-label="Year export file name"
            maxLength={EXPORT_FILE_NAME_MAX}
            placeholder={DEFAULT_EXPORT_FILE_NAME}
            value={draft.name}
            disabled={!canEdit || busy}
            onChange={(e) => setDraft({ name: e.target.value })}
            className={`${INPUT} w-72`}
          />
        </FieldRow>
        <p className="text-xs text-slate-500">For {year}: {example}.xlsx and {example}.pdf</p>
        {why && <p className="text-xs text-red-400">{why}</p>}
        <div className="flex gap-2">
          <button type="button" disabled={!canEdit || busy || !dirty || !!why} onClick={() => save({ exportFileName: trimmed || null }, { name: trimmed })} className={BTN_SAVE}>Save</button>
          <button type="button" disabled={!canEdit || busy || !dirty} onClick={() => setDraft(saved)} className={BTN_PLAIN}>Cancel</button>
          <button type="button" disabled={!canEdit || busy} onClick={() => save({ exportFileName: null }, { name: "" })} className={BTN_PLAIN}>Reset to default</button>
        </div>
      </div>
    </CollapsibleSection>
  );
}

// Card #312: what Print and Export year do when a month changed since its last version
// (or never had one): save a new version first, ask first, or leave it (the old way).
const AUTO_VERSION_CHOICES: { value: AutoVersionMode; label: string; help: string }[] = [
  { value: "auto", label: "Automatic", help: "Save a new version first, so the printout or file always carries the right version number." },
  { value: "ask", label: "Ask first", help: "Ask before saving the new version; Cancel prints or exports nothing." },
  { value: "off", label: "Off", help: "Never save a version on Print or Export (versions are saved by hand only)." },
];
// Card #314: download a backup of everything, restore one, and the reminder's days.
function BackupRestoreSection() {
  const [error, setError] = useState<string | undefined>();
  return (
    <CollapsibleSection
      id="backup-restore"
      title="Backup and Restore"
      description="Download one passphrase-protected file holding all of YoSched's data and settings, including logins and groups (not sign-in history). Use it to restore YoSched after a reinstall, or to go back to an earlier state."
      status={error ? "error" : "idle"}
      error={error}
    >
      <BackupPanel onError={setError} />
    </CollapsibleSection>
  );
}

function AutoVersionSection({ initial }: { initial: AutoVersionMode }) {
  const canEdit = useCanEdit();
  const { saved, draft, setDraft, status, error, busy, dirty, save } = useSavedDraft({ mode: initial });
  return (
    <CollapsibleSection
      id="auto-version"
      title="Versions on Print and Export"
      description="When a month has changed since its last saved version, or has never been saved (a blank month becomes Version 1), Print and Export year can save a new version first."
      status={status}
      error={error}
    >
      <div className="space-y-3">
        {AUTO_VERSION_CHOICES.map((c) => (
          <label key={c.value} className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="radio"
              name="auto-version-mode"
              className="mt-1"
              checked={draft.mode === c.value}
              disabled={!canEdit || busy}
              onChange={() => setDraft({ mode: c.value })}
            />
            <span>
              <span className="font-medium text-slate-200">{c.label}</span>
              <span className="block text-xs text-slate-500">{c.help}</span>
            </span>
          </label>
        ))}
        <div className="flex gap-2">
          <button type="button" disabled={!canEdit || busy || !dirty} onClick={() => save({ autoVersionMode: draft.mode }, draft)} className={BTN_SAVE}>Save</button>
          <button type="button" disabled={!canEdit || busy || !dirty} onClick={() => setDraft(saved)} className={BTN_PLAIN}>Cancel</button>
        </div>
      </div>
    </CollapsibleSection>
  );
}

const DATE_COLUMN_SAMPLE = "2026-01-05"; // a Monday
const DAY_COLUMN_SAMPLE_DOW = 1;

function DateColumnsSection({ initial }: { initial: PrintLayout }) {
  const canEdit = useCanEdit();
  const { saved, draft, setDraft, status, error, busy, dirty, save } = useSavedDraft({ splitDateDay: initial.splitDateDay, dateColumnFormat: initial.dateColumnFormat, dayColumnFormat: initial.dayColumnFormat });
  const d = DEFAULT_PRINT_LAYOUT;
  const defaults = { splitDateDay: d.splitDateDay, dateColumnFormat: d.dateColumnFormat, dayColumnFormat: d.dayColumnFormat };
  return (
    <CollapsibleSection
      id="date-columns"
      title="Date Columns"
      description="On the schedule grid and the printout: one date column (“Mon 1/5”), or separate DATE and DAY columns in the formats below."
      status={status}
      error={error}
    >
      <div className="space-y-3">
        <FieldRow label="Separate DATE and DAY" description="Off: one column with the day and date together.">
          <input
            type="checkbox"
            aria-label="Separate DATE and DAY columns"
            checked={draft.splitDateDay}
            disabled={!canEdit || busy}
            onChange={(e) => setDraft({ ...draft, splitDateDay: e.target.checked })}
            className="rounded border-slate-600 w-4 h-4 disabled:opacity-50"
          />
        </FieldRow>
        <FieldRow label="DATE format" description="Example: Monday, January 5.">
          <select
            aria-label="DATE format"
            value={draft.dateColumnFormat}
            disabled={!canEdit || busy || !draft.splitDateDay}
            onChange={(e) => setDraft({ ...draft, dateColumnFormat: e.target.value as PrintLayout["dateColumnFormat"] })}
            className={INPUT}
          >
            {DATE_COLUMN_FORMATS.map((f) => (
              <option key={f} value={f}>{f} ({formatDateColumn(DATE_COLUMN_SAMPLE, f)})</option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="DAY format" description="Example: Monday.">
          <select
            aria-label="DAY format"
            value={draft.dayColumnFormat}
            disabled={!canEdit || busy || !draft.splitDateDay}
            onChange={(e) => setDraft({ ...draft, dayColumnFormat: e.target.value as PrintLayout["dayColumnFormat"] })}
            className={INPUT}
          >
            {DAY_COLUMN_FORMATS.map((f) => (
              <option key={f} value={f}>{formatDayColumn(DAY_COLUMN_SAMPLE_DOW, f)}</option>
            ))}
          </select>
        </FieldRow>
        <div className="flex gap-2">
          <button type="button" disabled={!canEdit || busy || !dirty} onClick={() => save({ splitDateDayColumns: draft.splitDateDay, dateColumnFormat: draft.dateColumnFormat, dayColumnFormat: draft.dayColumnFormat }, draft)} className={BTN_SAVE}>Save</button>
          <button type="button" disabled={!canEdit || busy || !dirty} onClick={() => setDraft(saved)} className={BTN_PLAIN}>Cancel</button>
          <button type="button" disabled={!canEdit || busy} onClick={() => save({ splitDateDayColumns: defaults.splitDateDay, dateColumnFormat: defaults.dateColumnFormat, dayColumnFormat: defaults.dayColumnFormat }, defaults)} className={BTN_PLAIN}>Reset to default</button>
        </div>
      </div>
    </CollapsibleSection>
  );
}

// Card #309: the named people of a printed-column rule. A person who has since gone inactive or
// been removed stays selected (shown as such): dropping them could turn an Include rule into
// "everyone".
function PeoplePicker({ value, people, canEdit, onChange }: { value: string[]; people: PrintPerson[]; canEdit: boolean; onChange: (ids: string[]) => void }) {
  const byId = new Map(people.map((p) => [p.id, p] as const));
  const choices = people.filter((p) => p.isActive && !value.includes(p.id));
  return (
    <div className="flex items-center gap-1 flex-wrap text-xs text-slate-400">
      <span>People:</span>
      {value.length === 0 && <span className="text-[11px] text-slate-500">any</span>}
      {value.map((id) => {
        const p = byId.get(id);
        const label = p ? (p.isActive ? p.name : `${p.name} (inactive)`) : "(removed person)";
        return (
          <span key={id} className="inline-flex items-center gap-1 rounded bg-slate-700 px-1.5 py-0.5 text-slate-200">
            {label}
            {canEdit && (
              <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} className="text-slate-400 hover:text-red-400" title="Remove">×</button>
            )}
          </span>
        );
      })}
      {canEdit && choices.length > 0 && (
        <select
          value=""
          onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]); }}
          className="bg-slate-700 text-slate-200 rounded px-1 py-0.5 text-xs border border-slate-600"
        >
          <option value="">+ person…</option>
          {choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
    </div>
  );
}

function AdditionalColumnsSection({
  initial,
  shiftTypes,
  employmentTypes,
  people = [],
  onSaved,
}: {
  initial: PrintAggregateColumnData[];
  shiftTypes: ShiftType[];
  employmentTypes: EmploymentTypeData[];
  people?: PrintPerson[];
  onSaved?: (saved: { id: string; label: string }[]) => void;
}) {
  const canEdit = useCanEdit();
  const toEdit = (rows: PrintAggregateColumnData[]): EditAggCol[] =>
    rows.map((c) => ({
      id: c.id,
      label: c.label,
      enabled: c.enabled,
      isOther: c.isOther,
      suppressMembers: c.suppressMembers,
      conditionScope: c.conditionScope === "day" ? "day" : "month",
      // Stored lines, or the old single rule as one Include line (effectiveCriteria).
      lines: effectiveCriteria({
        ...c,
        conditions: c.conditions ?? [],
        criteria: Array.isArray(c.criteria) ? c.criteria.map((l) => ({ ...l, mode: l.mode === "exclude" ? ("exclude" as const) : ("include" as const) })) : null,
      }).map((l) => ({
        mode: l.mode,
        staffIds: [...l.staffIds],
        employmentTypeIds: [...l.employmentTypeIds],
        minFtePercentage: l.minFtePercentage,
        maxFtePercentage: l.maxFtePercentage,
        conditions: l.conditions.map((x) => ({
          quantifier: x.quantifier,
          categories: [...x.categories],
          shiftTypeIds: [...x.shiftTypeIds],
          exceptIds: [...x.exceptIds],
        })),
      })),
    }));
  const [cols, setCols] = useState<EditAggCol[]>(() => toEdit(initial));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  function update(idx: number, patch: Partial<EditAggCol>) {
    setCols(cols.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function addCol() {
    setCols([...cols, { label: "", enabled: true, isOther: false, suppressMembers: true, conditionScope: "month", lines: [] }]);
  }
  function updateLine(idx: number, li: number, patch: Partial<EditAggLine>) {
    update(idx, { lines: cols[idx].lines.map((l, j) => (j === li ? { ...l, ...patch } : l)) });
  }
  function addLine(idx: number, mode: "include" | "exclude") {
    update(idx, { lines: [...cols[idx].lines, { mode, staffIds: [], employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions: [] }] });
  }
  function removeLine(idx: number, li: number) {
    update(idx, { lines: cols[idx].lines.filter((_, j) => j !== li) });
  }
  function removeCol(idx: number) { setCols(cols.filter((_, i) => i !== idx)); }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[idx], next[j]] = [next[j], next[idx]];
    setCols(next);
  }

  async function save() {
    setStatus("saving");
    setError("");
    try {
      // Card #309: each column's rule lines, ids only, no line with nothing set; people are never
      // dropped (a removed person matches nobody). A server from before the lines has no such
      // route and answers 404: the message asks for a reload.
      const payload = cols.map((c) => ({
        id: c.id, label: c.label, enabled: c.enabled, isOther: c.isOther, suppressMembers: c.suppressMembers,
        conditionScope: c.conditionScope, criteria: buildCriteriaSave(c.lines),
      }));
      const res = await fetch(PRINT_AGGREGATE_COLUMNS_SAVE_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns: payload }),
      });
      if (!res.ok) throw new Error(printSaveErrorMessage(res.status, await res.text()));
      // Card #300: adopt the saved rows (with their ids), so the next save keeps them.
      const saved = (await res.json()) as PrintAggregateColumnData[];
      setCols(toEdit(saved));
      onSaved?.(saved.map((c) => ({ id: c.id, label: c.label })));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setStatus("error");
    }
  }

  return (
    <CollapsibleSection
      id="print-additional-columns"
      title="Additional Columns on Printed Schedule"
      description="Extra aggregate columns for the printed schedule. Each lists, per day, the initials of the staff matching its rules who are scheduled that day: anyone who matches an Include rule (everyone, if there is none) and no Exclude rule. 'Suppress members' hides those staff's own individual columns in print (otherwise they appear both places). Tick 'Catch-all' to make a column the residual: it lists everyone who appears in no other column, and its rules take people out (Exclude) or add them (Include). A column with no one to show that month is hidden automatically. Print-only — the on-screen grid is unchanged."
      status={status}
      error={error}
    >

      <div className="space-y-3">
        {cols.map((col, idx) => {
          // Card #309: lines with something set; a named column with none matches EVERY staff —
          // flag it so the admin doesn't accidentally sweep everyone into one column.
          const active = col.lines.filter((l) => !isInertLine(l));
          const hasRule = active.length > 0;
          return (
          <div key={idx} className="bg-slate-900/50 rounded p-3 border border-slate-700 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1 text-xs text-slate-400">
                <input type="checkbox" disabled={!canEdit} checked={col.enabled} onChange={(e) => update(idx, { enabled: e.target.checked })} />
                On
              </label>
              <input type="text" disabled={!canEdit} value={col.label} onChange={(e) => update(idx, { label: e.target.value })} placeholder="Column name" className="bg-slate-700 text-slate-200 rounded px-2 py-1 text-sm border border-slate-600 flex-1 min-w-32 disabled:opacity-50" />
              <label className="flex items-center gap-1 text-xs text-slate-400" title="Catch-all: this column lists everyone who appears in no other column. It has no rule of its own.">
                <input type="checkbox" disabled={!canEdit} checked={col.isOther} onChange={(e) => update(idx, { isOther: e.target.checked })} />
                Catch-all
              </label>
              {!col.isOther && (
                <label className="flex items-center gap-1 text-xs text-slate-400" title="Hide these staff's individual columns in print (otherwise they appear both individually and in this column)">
                  <input type="checkbox" disabled={!canEdit} checked={col.suppressMembers} onChange={(e) => update(idx, { suppressMembers: e.target.checked })} />
                  Suppress members
                </label>
              )}
              {canEdit && (
                <span className="flex items-center gap-1">
                  <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-slate-500 hover:text-slate-300 disabled:opacity-30 text-xs" title="Move up">▲</button>
                  <button onClick={() => move(idx, 1)} disabled={idx === cols.length - 1} className="text-slate-500 hover:text-slate-300 disabled:opacity-30 text-xs" title="Move down">▼</button>
                  <button onClick={() => removeCol(idx)} className="text-slate-500 hover:text-red-400 text-sm ml-1">×</button>
                </span>
              )}
            </div>

            <p className="text-[11px] text-slate-500">
              {col.isOther
                ? "Catch-all: lists the staff who appear in no other column. Exclude rules take people out of that list; Include rules add people to it."
                : "Lists the staff who match any Include rule (everyone, if there is none) and no Exclude rule."}
            </p>
            {(!col.isOther || hasRule) && (
              <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                <span>Shift conditions apply to:</span>
                <div className="inline-flex rounded border border-slate-600 overflow-hidden">
                  {(["month", "day"] as const).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => update(idx, { conditionScope: scope })}
                      className={`px-2 py-0.5 ${col.conditionScope === scope ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"} disabled:opacity-50`}
                    >
                      {scope === "month" ? "Whole month" : "Each day"}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-slate-500">
                  {col.conditionScope === "day"
                    ? "a rule's shift conditions are checked against each day's shift"
                    : "a rule's shift conditions are checked against the person's shifts over the whole month"}
                </span>
              </div>
            )}
            {col.lines.map((line, li) => (
              <div key={li} className={`rounded border p-2 space-y-2 ${line.mode === "exclude" ? "border-red-900/60 bg-red-950/20" : "border-emerald-900/60 bg-emerald-950/20"}`}>
                <div className="flex items-center gap-2 text-xs">
                  <div className="inline-flex rounded border border-slate-600 overflow-hidden">
                    {(["include", "exclude"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => updateLine(idx, li, { mode })}
                        className={`px-2 py-0.5 ${line.mode === mode ? (mode === "include" ? "bg-emerald-700 text-white" : "bg-red-700 text-white") : "bg-slate-700 text-slate-300 hover:bg-slate-600"} disabled:opacity-50`}
                      >
                        {mode === "include" ? "Include" : "Exclude"}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] text-slate-500">staff who match everything set in this rule</span>
                  {canEdit && (
                    <button type="button" onClick={() => removeLine(idx, li)} className="ml-auto text-slate-500 hover:text-red-400 text-sm" title="Remove this rule">×</button>
                  )}
                </div>
                <RuleFieldsEditor value={line} onChange={(patch) => updateLine(idx, li, patch)} employmentTypes={employmentTypes} shifts={shiftTypes} canEdit={canEdit} />
                <PeoplePicker value={line.staffIds} people={people} canEdit={canEdit} onChange={(staffIds) => updateLine(idx, li, { staffIds })} />
                {isInertLine(line) && (
                  <p className="text-[11px] text-amber-400/90">This rule has nothing set and does nothing.</p>
                )}
              </div>
            ))}
            {canEdit && (
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <button type="button" onClick={() => addLine(idx, "include")} className="text-emerald-400 hover:text-emerald-300">+ Include rule</button>
                <button type="button" onClick={() => addLine(idx, "exclude")} className="text-red-400 hover:text-red-300">+ Exclude rule</button>
                <span className="text-[11px] text-slate-500">{"Example: to keep people who only work ICU out of Other, add an Exclude rule with two shift conditions: \"has any of ICU\" and \"has none of work, except ICU\"."}</span>
              </div>
            )}
            {!col.isOther && col.enabled && !hasRule && (
              <p className="text-[11px] text-amber-400/90">No rule set — this column matches <strong>all staff</strong>. Add an Include rule, or tick Catch-all.</p>
            )}
          </div>
          );
        })}
      </div>

      {canEdit && (
        <div className="flex items-center gap-3 mt-4">
          <button onClick={addCol} className="text-xs text-blue-400 hover:text-blue-300">+ Add column</button>
          <button onClick={save} disabled={status === "saving"} className="ml-auto px-3 py-1.5 text-xs font-medium rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
            {status === "saving" ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </CollapsibleSection>
  );
}

// ─── Staff Column Ordering Section ──────────────────────────────────────────

// Criteria available for the rules stack. "manual" is deliberately absent — it is
// an all-or-nothing mode (the toggle above the list), never a stacked criterion.
const STAFF_ORDER_META: Record<Exclude<StaffOrderKey, "manual">, { label: string; description: string; dirLabels: [string, string] }> = {
  employmentType: {
    label: "Employment type",
    description: "Groups by employment type in its configured order (FTE before Fee Basis).",
    dirLabels: ["FTE first", "Fee Basis first"],
  },
  ftePercentage: {
    label: "FTE %",
    description: "Full-time staff before part-time.",
    dirLabels: ["Low → high", "High → low"],
  },
  alphabetical: {
    label: "Alphabetical",
    description: "By last name; staff without a listed last name use the letters of their initials after the first (ADh sorts as “Dh”).",
    dirLabels: ["A → Z", "Z → A"],
  },
  initials: {
    label: "Initials",
    description: "Plain alphabetical order of the initials as shown on the grid.",
    dirLabels: ["A → Z", "Z → A"],
  },
  autoScheduled: {
    label: "Auto-scheduled",
    description: "Staff the auto-generator schedules before manually-scheduled staff.",
    dirLabels: ["Manual first", "Auto first"],
  },
  seniority: {
    label: "Seniority",
    description: "By the date the staff member was added to the system.",
    dirLabels: ["Oldest first", "Newest first"],
  },
};

const RULE_KEYS = Object.keys(STAFF_ORDER_META) as (keyof typeof STAFF_ORDER_META)[];

function sameCriteria(a: StaffOrderCriterion[], b: StaffOrderCriterion[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => c.key === b[i].key && (c.dir ?? STAFF_ORDER_DEFAULT_DIR[c.key]) === (b[i].dir ?? STAFF_ORDER_DEFAULT_DIR[b[i].key]))
  );
}

function StaffColumnOrderSection({ initial, staff }: { initial: StaffOrderCriterion[]; staff: OrderableStaffRow[] }) {
  const canEdit = useCanEdit();
  const initialManual = initial[0]?.key === "manual";
  const initialRules = initialManual ? [...DEFAULT_STAFF_ORDER] : initial;
  const initialStaffOrder = useMemo(
    () => orderStaff(staff, [{ key: "manual" }]).map((p) => p.id),
    [staff],
  );

  const [mode, setMode] = useState<"rules" | "manual">(initialManual ? "manual" : "rules");
  const [savedMode, setSavedMode] = useState(mode);
  const [criteria, setCriteria] = useState<StaffOrderCriterion[]>(initialRules);
  const [savedCriteria, setSavedCriteria] = useState<StaffOrderCriterion[]>(initialRules);
  const [manualIds, setManualIds] = useState<string[]>(initialStaffOrder);
  const [savedManualIds, setSavedManualIds] = useState<string[]>(initialStaffOrder);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const staffById = useMemo(() => new Map(staff.map((p) => [p.id, p])), [staff]);
  const dirty =
    mode !== savedMode ||
    (mode === "rules"
      ? !sameCriteria(criteria, savedCriteria)
      : manualIds.join("|") !== savedManualIds.join("|"));

  // Preview of the resulting column order for the CURRENT draft (active roster).
  const preview = useMemo(() => {
    if (mode === "manual") return manualIds.map((id) => staffById.get(id)).filter((p): p is OrderableStaffRow => !!p);
    return orderStaff(staff, criteria);
  }, [mode, manualIds, criteria, staff, staffById]);

  async function putCriteria(value: StaffOrderCriterion[] | null) {
    const res = await fetch("/api/settings/scheduling-preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffColumnOrder: value }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async function save() {
    setStatus("saving");
    setError("");
    try {
      if (mode === "manual") {
        const res = await fetch("/api/staff/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds: manualIds }),
        });
        if (!res.ok) throw new Error(await res.text());
        await putCriteria([{ key: "manual" }]);
        setSavedManualIds(manualIds);
      } else {
        await putCriteria(criteria);
        setSavedCriteria(criteria);
      }
      setSavedMode(mode);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setStatus("error");
    }
  }

  function cancel() {
    setMode(savedMode);
    setCriteria(savedCriteria);
    setManualIds(savedManualIds);
    setStatus("idle");
    setError("");
  }

  async function resetToDefault() {
    setStatus("saving");
    setError("");
    try {
      await putCriteria(null);
      setMode("rules");
      setSavedMode("rules");
      setCriteria([...DEFAULT_STAFF_ORDER]);
      setSavedCriteria([...DEFAULT_STAFF_ORDER]);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reset");
      setStatus("error");
    }
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current !== null && dragIdx.current !== idx) setDragOverIdx(idx);
  }

  function handleDrop<T>(idx: number, list: T[], setList: (v: T[]) => void) {
    const from = dragIdx.current;
    dragIdx.current = null;
    setDragOverIdx(null);
    if (status === "saving" || from === null || from === idx) return;
    const reordered = [...list];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(idx, 0, moved);
    setList(reordered);
  }

  function toggleDir(idx: number) {
    setCriteria((cur) =>
      cur.map((c, i) => {
        if (i !== idx) return c;
        const effective = c.dir ?? STAFF_ORDER_DEFAULT_DIR[c.key];
        return { key: c.key, dir: (effective === "asc" ? "desc" : "asc") as StaffOrderDir };
      }),
    );
  }

  const unusedKeys = RULE_KEYS.filter((k) => !criteria.some((c) => c.key === k));
  const dragDisabled = !canEdit || status === "saving";
  const rowClass = (idx: number) =>
    [
      "flex items-center gap-3 bg-slate-700/30 border rounded-lg px-4 py-2 transition-colors",
      dragOverIdx === idx ? "border-blue-500" : "border-slate-600/50",
      dragDisabled ? "" : "cursor-grab active:cursor-grabbing",
    ].join(" ");

  return (
    <CollapsibleSection
      id="staff-column-order"
      title="Staff Column Ordering"
      description="Left-to-right order of staff columns on the schedule — applies to the on-screen grid and the printed schedule alike. Sort by stacked rules (each rule breaks ties within the one above it), or take over completely with a manual order."
      status={status}
      error={error}
    >
      {canEdit && (
        <div className="mt-4 flex items-center gap-1 bg-slate-900/50 border border-slate-700/50 rounded-lg p-1 w-fit">
          {(["rules", "manual"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={status === "saving"}
              className={[
                "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                mode === m ? "bg-slate-600 text-slate-100" : "text-slate-400 hover:text-slate-200",
              ].join(" ")}
            >
              {m === "rules" ? "Sort by rules" : "Manual order"}
            </button>
          ))}
        </div>
      )}

      {mode === "rules" ? (
        <div className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Sort rules — first rule is the primary sort
          </h3>
          <div className="space-y-1.5">
            {criteria.map((c, idx) => {
              const meta = STAFF_ORDER_META[c.key as keyof typeof STAFF_ORDER_META];
              if (!meta) return null;
              const effectiveDir = c.dir ?? STAFF_ORDER_DEFAULT_DIR[c.key];
              return (
                <div
                  key={c.key}
                  draggable={!dragDisabled}
                  onDragStart={() => { dragIdx.current = idx; }}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={() => handleDrop(idx, criteria, setCriteria)}
                  onDragEnd={() => { dragIdx.current = null; setDragOverIdx(null); }}
                  className={rowClass(idx)}
                >
                  {canEdit && <span className="shrink-0 text-slate-500 select-none" title="Drag to reorder">⋮⋮</span>}
                  <span className="shrink-0 w-6 h-6 rounded-full bg-slate-800 border border-slate-600 text-xs text-slate-300 flex items-center justify-center font-semibold">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm text-slate-200 font-medium">{meta.label}</span>
                    <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
                  </div>
                  {canEdit && (
                    <>
                      <button
                        onClick={() => toggleDir(idx)}
                        disabled={status === "saving"}
                        className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800 border border-slate-600 text-slate-300 hover:border-blue-500 transition-colors shrink-0"
                        title="Flip direction"
                      >
                        {meta.dirLabels[effectiveDir === "desc" ? 1 : 0]} ⇅
                      </button>
                      <button
                        onClick={() => setCriteria((cur) => cur.filter((_, i) => i !== idx))}
                        disabled={status === "saving" || criteria.length === 1}
                        className="px-2 py-1 rounded-md text-xs text-slate-400 hover:text-red-400 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                        title={criteria.length === 1 ? "At least one rule is required" : "Remove rule"}
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {canEdit && unusedKeys.length > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500">Add rule:</span>
              {unusedKeys.map((k) => (
                <button
                  key={k}
                  onClick={() => setCriteria((cur) => [...cur, { key: k }])}
                  disabled={status === "saving"}
                  className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800 border border-slate-600 text-slate-300 hover:border-blue-500 transition-colors"
                >
                  + {STAFF_ORDER_META[k].label}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Column order — drag staff into place
          </h3>
          <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
            {manualIds.map((id, idx) => {
              const p = staffById.get(id);
              if (!p) return null;
              return (
                <div
                  key={id}
                  draggable={!dragDisabled}
                  onDragStart={() => { dragIdx.current = idx; }}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={() => handleDrop(idx, manualIds, setManualIds)}
                  onDragEnd={() => { dragIdx.current = null; setDragOverIdx(null); }}
                  className={rowClass(idx)}
                >
                  {canEdit && <span className="shrink-0 text-slate-500 select-none" title="Drag to reorder">⋮⋮</span>}
                  <span className="shrink-0 w-8 text-xs text-slate-500 text-right font-mono">{idx + 1}</span>
                  <span className="text-sm text-slate-200 font-semibold w-12 shrink-0">{p.initials}</span>
                  <span className="text-xs text-slate-400 truncate flex-1">{p.name !== p.initials ? p.name : ""}</span>
                  <span className="text-xs text-slate-500 shrink-0">
                    {p.employmentTypeName}{p.ftePercentage != null ? ` · ${(p.ftePercentage * 100).toFixed(0)}%` : ""}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500 italic">
            Active staff only. New staff are added at the far right until you place them here.
          </p>
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Preview (left → right)
        </h3>
        <div className="flex flex-wrap gap-1">
          {preview.map((p) => (
            <span
              key={p.id}
              title={`${p.name} — ${p.employmentTypeName}${p.ftePercentage != null ? ` · ${(p.ftePercentage * 100).toFixed(0)}%` : ""}`}
              className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs text-slate-300 font-mono"
            >
              {p.initials}
            </span>
          ))}
        </div>
      </div>

      {canEdit && (
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={save}
            disabled={!dirty || status === "saving"}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
          >
            {status === "saving" ? "Saving…" : "Save"}
          </button>
          <button
            onClick={cancel}
            disabled={!dirty || status === "saving"}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={resetToDefault}
            disabled={status === "saving"}
            className="ml-auto px-3 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Back to the built-in default: employment type, then FTE % high → low, then alphabetical"
          >
            Reset to default
          </button>
          {dirty && <span className="text-xs text-amber-400">Unsaved order — Save to apply.</span>}
        </div>
      )}
    </CollapsibleSection>
  );
}

// ─── Main Settings Page ─────────────────────────────────────────────────────

export function SettingsPage({ shiftTypes: initialShiftTypes, staffingReqs, payPeriods, holidays, holidayTypes = [], holidayRules = EMPTY_HOLIDAY_RULES, desirabilityWeights, schedulingPrefs, departmentTargets, employmentTypes, equityFactors: initialEquityFactors, autoGenFactors: initialAutoGenFactors, autoGenProfiles: initialAutoGenProfiles, followRules: initialFollowRules, followAvoids: initialFollowAvoids = [], requiredFollowers: initialRequiredFollowers, countColumns: initialCountColumns, printColumnRules: initialPrintColumnRules, printAggregateColumns: initialPrintAggregateColumns, printPeople = [], staffColumnOrder, specialColumnOrder = null, orderableStaff, canEdit = true, canEditAutoGenPriority = false, canBackup = false, about = EMPTY_ABOUT }: Props) {
  const undo = useUndo();
  // One shift list for the whole page: Shift Types edits it, every other section reads it.
  const [shiftTypes, setShiftTypes] = useState(initialShiftTypes);
  // Card #300: the saved Additional/Count columns (with ids), kept current by their sections' saves.
  const [savedAggColumns, setSavedAggColumns] = useState(() => initialPrintAggregateColumns.map((c) => ({ id: c.id, label: c.label })));
  const [savedCountColumns, setSavedCountColumns] = useState(() => initialCountColumns.map((c) => ({ id: c.id, label: c.label })));
  const [dateFormat, setDateFormat] = useState<DateFormatKey>((schedulingPrefs.dateFormat || DEFAULT_DATE_FORMAT) as DateFormatKey);
  // Card #215: the last SAVED tuning, shared with every section's help text and shading.
  const [savedTuning, setSavedTuning] = useState<SchedulerTuning>(() => readTuning(schedulingPrefs));

  return (
    <CanEditContext.Provider value={canEdit}>
    <TuningContext.Provider value={savedTuning}>
    <CollapseProvider>
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="sticky top-0 z-10 -mx-6 px-6 py-3 mb-6 bg-slate-900/85 backdrop-blur border-b border-slate-700/50 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-100">Settings</h1>
          <SettingsSearchBox />
          <CollapseToolbar />
        </div>
        {!canEdit && (
          <div className="px-4 py-2.5 mb-6 bg-slate-800/60 border border-slate-700/50 rounded text-xs text-slate-400 text-center">
            View-only — you do not have permission to edit settings
          </div>
        )}

        <SectionGroup label="About YoSched" />
        <div className="space-y-4 mb-8 mt-3">
          <AboutSection about={about} dateFormat={dateFormat} />
        </div>

        <SectionGroup label="Definitions" />
        <div className="space-y-4 mb-8 mt-3">
          <ShiftTypesSection shifts={shiftTypes} onShiftsChange={setShiftTypes} pushUndo={undo.push} initialFollowRules={initialFollowRules} initialFollowAvoids={initialFollowAvoids} initialRequiredFollowers={initialRequiredFollowers} />
          <EmploymentTypesSection initial={employmentTypes} pushUndo={undo.push} shiftTypes={shiftTypes} />
        </div>

        <SectionGroup label="Scheduling Engine" />
        <div className="space-y-4 mb-8 mt-3">
          <StaffingSection initial={staffingReqs} shiftTypes={shiftTypes} pushUndo={undo.push} />
          <SchedulingPrefsSection initial={schedulingPrefs} shiftTypes={shiftTypes} />
          <SchedulerTuningSection initial={savedTuning} onSaved={setSavedTuning} />
          <PayPeriodPrefsSection initial={departmentTargets} shiftTypes={shiftTypes} />
          <DesirabilitySection initial={desirabilityWeights} shiftTypes={shiftTypes} pushUndo={undo.push} />
          <EquityFactorsSection initial={initialEquityFactors} shifts={shiftTypes} />
          <AutoGenPrioritySection initial={initialAutoGenFactors} initialProfiles={initialAutoGenProfiles} canEdit={canEditAutoGenPriority} />
        </div>

        <SectionGroup label="Printed Schedule" />
        <div className="space-y-4 mb-8 mt-3">
          <StaffColumnOrderSection initial={staffColumnOrder} staff={orderableStaff} />
          <PrintColumnRulesSection initial={initialPrintColumnRules} shiftTypes={shiftTypes} employmentTypes={employmentTypes} />
          <AdditionalColumnsSection initial={initialPrintAggregateColumns} shiftTypes={shiftTypes} employmentTypes={employmentTypes} people={printPeople} onSaved={setSavedAggColumns} />
          <CountColumnsSection initial={initialCountColumns} shiftTypes={shiftTypes} onSaved={setSavedCountColumns} />
          <SpecialColumnOrderSection
            initial={specialColumnOrder}
            aggColumns={savedAggColumns}
            dedicatedShifts={shiftTypes.filter((st) => st.dedicatedColumn).map((st) => ({ id: st.id, code: st.code }))}
            countColumns={savedCountColumns}
          />
          <UdColumnWidthSection
            initial={schedulingPrefs.printLayout.udWidth}
            aggColumns={savedAggColumns}
            dedicatedShifts={shiftTypes.filter((st) => st.dedicatedColumn).map((st) => ({ id: st.id, code: st.code }))}
          />
          <DayShadingSection initial={schedulingPrefs} />
          <PrintHeaderFooterSection initial={schedulingPrefs.printLayout} />
          <PrintFontSection initial={schedulingPrefs.printLayout} />
          <PrintPaperSection initial={schedulingPrefs.printLayout} />
          <ExportFileNameSection initial={schedulingPrefs.exportFileName} />
          <AutoVersionSection initial={schedulingPrefs.autoVersionMode} />
        </div>

        <SectionGroup label="Calendar" />
        <div className="space-y-4 mb-8 mt-3">
          <PayPeriodsSection initial={payPeriods} initialAnchor={schedulingPrefs.payPeriodAnchor} initialLengthDays={schedulingPrefs.payPeriodLengthDays} pushUndo={undo.push} dateFormat={dateFormat} />
          <HolidaysBlock initialHolidays={holidays} initialTypes={holidayTypes} initialRules={holidayRules} shiftTypes={shiftTypes} payPeriods={payPeriods} pushUndo={undo.push} dateFormat={dateFormat} />
        </div>

        <SectionGroup label="General & System" />
        <div className="space-y-4 mt-3">
          <DateFormatSection selected={dateFormat} onChange={(fmt) => setDateFormat(fmt as DateFormatKey)} />
          <TimeZoneSection />
          <DateColumnsSection initial={schedulingPrefs.printLayout} />
          <EmailSettingsSection />
        </div>

        {canBackup && (
          <>
            <SectionGroup label="Backup and Restore" />
            <div className="space-y-4 mt-3">
              <BackupRestoreSection />
            </div>
          </>
        )}
      </div>

      {undo.pending && (
        <UndoToast action={undo.pending} onUndo={undo.execute} onDismiss={undo.dismiss} />
      )}
    </div>
    </CollapseProvider>
    </TuningContext.Provider>
    </CanEditContext.Provider>
  );
}
