"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useEscape } from "@/lib/use-escape";
import { DATE_FORMAT_OPTIONS, DEFAULT_DATE_FORMAT, formatDate, type DateFormatKey } from "@/lib/date-format";
import { PENDING_REQUEST_MODES, type PendingRequestMode, REQUEST_CONFLICT_POLICIES, type RequestConflictPolicy } from "@/lib/schedule-requests";
import { LIVE_SCOPES, LIVE_SCOPE_LABELS, type LiveScope } from "@/lib/live-scope";
import { PINNED_CONSTRAINTS, FACTOR_META, PRIORITY_ROADMAP_NOTE, type FactorMeta } from "@/lib/autogen-priority";
import { reconcileOrder, MAX_PROFILE_NAME_LENGTH } from "@/lib/autogen-profile";
import { OffStrategyEditor } from "@/components/off-strategy-editor";
import { ruleToWhen, isPlainWeekdayWhen, whenToColumns, describeWhen } from "@/lib/recurrence";
import { RecurrencePicker } from "../staff/recurrence-picker";
import { FrequencyPicker } from "../staff/frequency-picker";

const CanEditContext = createContext(true);
function useCanEdit() { return useContext(CanEditContext); }

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
  ignoresWorkingDays: boolean;
  maxPerDay: number | null;
  autoSchedulable: boolean;
  hotkey: string | null;
  dedicatedColumn: boolean;
  boldOnSchedule: boolean;
  printBackgroundColor: string | null;
};

type StaffingReq = {
  id: string;
  shiftCode: string;
  dayKey: string;
  minCount: number;
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
};

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
  defaultOffStrategyOrder: string[];
  defaultLiveScope: LiveScope;
};

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
  defaultEligibleShiftTypeIds: string[];
  defaultAvailabilityRules: DefaultAvailabilityRule[];
  sortOrder: number;
  staffCount: number;
};

type EquityFactorData = {
  id: string;
  factorType: string;
  shiftCode: string | null;
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
  codes: string[];
  except: string[];
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
};

type Props = {
  shiftTypes: ShiftType[];
  staffingReqs: StaffingReq[];
  payPeriods: PayPeriod[];
  holidays: Holiday[];
  desirabilityWeights: DesirabilityWeight[];
  schedulingPrefs: SchedulingPrefs;
  departmentTargets: DeptTargetData[];
  employmentTypes: EmploymentTypeData[];
  equityFactors: EquityFactorData[];
  autoGenFactors: AutoGenFactorData[];
  autoGenProfiles: AutoGenProfileData[];
  shiftCodes: string[];
  followRules: FollowRuleData[];
  requiredFollowers: RequiredFollowerData[];
  countColumns: { id: string; label: string; shiftCodes: string[] }[];
  printColumnRules: PrintColumnRuleData[];
  printAggregateColumns: PrintAggregateColumnData[];
  canEdit?: boolean;
  canEditAutoGenPriority?: boolean;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

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

function SectionHeader({ title, description, status, error }: { title: string; description: string; status: SaveStatus; error?: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
        <p className="text-sm text-slate-400">{description}</p>
      </div>
      <StatusBadge status={status} error={error} />
    </div>
  );
}

// ─── Shift Types Section ────────────────────────────────────────────────────

function FieldRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3 border-b border-slate-700/50 last:border-0">
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

function ShiftTypesSection({ initial, pushUndo, initialFollowRules, initialRequiredFollowers }: { initial: ShiftType[]; pushUndo: (a: UndoAction) => void; initialFollowRules: FollowRuleData[]; initialRequiredFollowers: RequiredFollowerData[] }) {
  const canEdit = useCanEdit();
  const [shifts, setShifts] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [followRules, setFollowRules] = useState(initialFollowRules);
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

  async function saveShift(shift: ShiftType) {
    const prev = initial.find((s) => s.id === shift.id) ?? shifts.find((s) => s.id === shift.id);
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/shift-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shift),
      });
      if (!res.ok) throw new Error(await res.text());

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
      setEditingId(null);
      setTimeout(() => setStatus("idle"), 2000);

      if (prev) {
        pushUndo({
          label: `Updated ${shift.code}`,
          execute: async () => {
            await fetch("/api/settings/shift-types", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(prev),
            });
            setShifts((cur) => cur.map((s) => s.id === prev.id ? prev : s));
          },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
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
            const created = await res.json();
            setShifts((cur) => [...cur, { ...deleted, id: created.id }]);
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
        ignoresWorkingDays: created.ignoresWorkingDays ?? false,
        maxPerDay: created.maxPerDay ?? null,
        autoSchedulable: created.autoSchedulable ?? false,
        hotkey: created.hotkey ?? null,
        dedicatedColumn: created.dedicatedColumn ?? false,
        boldOnSchedule: created.boldOnSchedule ?? false,
        printBackgroundColor: created.printBackgroundColor ?? null,
      };
      setShifts((prev) => [...prev, newShift]);
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
    const orig = initial.find((s) => s.id === editingId);
    if (orig) setShifts((prev) => prev.map((s) => s.id === editingId ? orig : s));
    setEditingId(null);
  }, [editingId, initial]);
  useEscape(cancelEdit);

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
    <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
      <SectionHeader
        title="Shift Types"
        description="Configure shift codes, durations, and rules"
        status={status}
        error={error}
      />

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
                <input disabled={!canEdit} type="number" className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center disabled:opacity-50" value={editingShift.defaultHours} onChange={(e) => updateField(editingShift.id, "defaultHours", parseFloat(e.target.value) || 0)} />
              </FieldRow>
              <FieldRow label="Hours per shift (weekends)" description="Hours this shift counts for on a Sat/Sun. 0 = does not accrue weekend hours.">
                <input disabled={!canEdit} type="number" className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center disabled:opacity-50" value={editingShift.defaultHoursWeekend} onChange={(e) => updateField(editingShift.id, "defaultHoursWeekend", parseFloat(e.target.value) || 0)} />
              </FieldRow>
              <FieldRow label="Hours per shift (holidays)" description="Hours this shift counts for on a holiday (takes precedence over weekend). 0 = does not accrue holiday hours.">
                <input disabled={!canEdit} type="number" className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center disabled:opacity-50" value={editingShift.defaultHoursHoliday} onChange={(e) => updateField(editingShift.id, "defaultHoursHoliday", parseFloat(e.target.value) || 0)} />
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
                <input disabled={!canEdit} type="number" className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center disabled:opacity-50" value={editingShift.schedulePriority ?? ""} placeholder="None" onChange={(e) => updateField(editingShift.id, "schedulePriority", e.target.value ? parseInt(e.target.value) : null)} />
              </FieldRow>
              <FieldRow label="Pair Saturday and Sunday" description="Assign the same person to both Saturday and Sunday when filling this shift on weekends">
                <input disabled={!canEdit} type="checkbox" checked={editingShift.weekendPaired} onChange={(e) => updateField(editingShift.id, "weekendPaired", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
              </FieldRow>
              <FieldRow label="Pair with leading or following holiday" description="When Saturday/Sunday are paired, also assign the same person to an adjacent holiday (the Friday before or Monday after) so a 3-day holiday weekend (e.g. FRI-SAT-SUN or SAT-SUN-MON) is covered by one staff member">
                <input disabled={!canEdit || !editingShift.weekendPaired} type="checkbox" checked={editingShift.holidayWeekendPaired} onChange={(e) => updateField(editingShift.id, "holidayWeekendPaired", e.target.checked)} className="rounded border-slate-600 w-4 h-4 disabled:opacity-50" />
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
<FieldRow label="Maximum per day" description="Limit how many staff can be assigned this shift on the same day. Set to 1 if only one person should do this shift per day. Leave blank for no limit.">
                <input disabled={!canEdit} type="number" className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center disabled:opacity-50" value={editingShift.maxPerDay ?? ""} placeholder="No limit" onChange={(e) => updateField(editingShift.id, "maxPerDay", e.target.value ? parseInt(e.target.value) : null)} />
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
    </section>
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
  const [grid, setGrid] = useState(() => {
    const map: Record<string, number> = {};
    for (const r of initial) map[`${r.shiftCode}:${r.dayKey}`] = r.minCount;
    return map;
  });

  const [columns, setColumns] = useState(() => {
    const codes = [...new Set(initial.map((r) => r.shiftCode))];
    if (codes.length === 0) {
      return shiftTypes
        .filter((st) => st.schedulePriority != null)
        .sort((a, b) => (a.schedulePriority ?? 0) - (b.schedulePriority ?? 0))
        .map((st) => st.code);
    }
    return codes.sort((a, b) => {
      const stA = shiftTypes.find((st) => st.code === a);
      const stB = shiftTypes.find((st) => st.code === b);
      return (stA?.schedulePriority ?? 999) - (stB?.schedulePriority ?? 999);
    });
  });

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

  const availableShiftTypes = (excludeCode?: string) =>
    shiftTypes.filter((st) => st.category === "work" && (st.code === excludeCode || !columns.includes(st.code)));

  function addColumn(code: string) {
    setColumns((prev) => [...prev, code]);
    for (const day of DAY_KEYS) {
      setGrid((prev) => ({ ...prev, [`${code}:${day}`]: 0 }));
    }
    setShowAddPicker(false);
  }

  function swapColumn(oldCode: string, newCode: string) {
    setColumns((prev) => prev.map((c) => c === oldCode ? newCode : c));
    setGrid((prev) => {
      const next = { ...prev };
      for (const day of DAY_KEYS) {
        next[`${newCode}:${day}`] = next[`${oldCode}:${day}`] ?? 0;
        delete next[`${oldCode}:${day}`];
      }
      return next;
    });
    setEditingCol(null);
  }

  function removeColumn(code: string) {
    setColumns((prev) => prev.filter((c) => c !== code));
    setGrid((prev) => {
      const next = { ...prev };
      for (const day of DAY_KEYS) delete next[`${code}:${day}`];
      return next;
    });
    setEditingCol(null);
  }

  function updateCell(shiftCode: string, dayKey: string, value: number) {
    setGrid((prev) => ({ ...prev, [`${shiftCode}:${dayKey}`]: value }));
  }

  async function save() {
    const prevGrid = { ...grid };
    const prevColumns = [...columns];
    setStatus("saving");
    try {
      const requirements = columns.flatMap((code) =>
        DAY_KEYS.map((day) => ({
          shiftCode: code,
          dayKey: day,
          minCount: grid[`${code}:${day}`] ?? 0,
        })),
      );

      const res = await fetch("/api/settings/staffing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements, columns }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);

      pushUndo({
        label: "Updated staffing rules",
        execute: async () => {
          const oldReqs = prevColumns.flatMap((code) =>
            DAY_KEYS.map((day) => ({
              shiftCode: code,
              dayKey: day,
              minCount: prevGrid[`${code}:${day}`] ?? 0,
            })),
          );
          await fetch("/api/settings/staffing", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requirements: oldReqs, columns: prevColumns }),
          });
          setGrid(prevGrid);
          setColumns(prevColumns);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  return (
    <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
      <SectionHeader
        title="Staffing Rules"
        description="Minimum staff per shift type per day of the week"
        status={status}
        error={error}
      />

      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr>
              <th className="text-left py-2 px-3 text-xs text-slate-400 font-medium w-20">Day</th>
              {columns.map((code) => {
                const st = shiftTypes.find((s) => s.code === code);
                const isEditing = editingCol === code;
                return (
                  <th key={code} className="py-2 px-2 text-center w-16 relative">
                    <button
                      onClick={() => canEdit && setEditingCol(isEditing ? null : code)}
                      className={`px-2 py-1 text-xs font-bold font-mono rounded transition-colors ${canEdit ? "hover:brightness-125" : ""}`}
                      style={{ backgroundColor: (st?.color ?? "#94a3b8") + "30", color: st?.color ?? "#94a3b8" }}
                    >
                      {code}
                    </button>
                    {isEditing && (
                      <div ref={pickerRef} className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-20 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-2 min-w-[200px] max-h-[400px] overflow-y-auto">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 py-1">Replace with</div>
                        <div className="grid grid-cols-3 gap-0.5">
                          {availableShiftTypes(code).filter((s) => s.code !== code).map((s) => (
                            <button
                              key={s.id}
                              onClick={() => swapColumn(code, s.code)}
                              className="w-full px-2 py-1.5 text-xs font-bold rounded text-center transition-colors hover:brightness-125"
                              style={{ backgroundColor: s.color + "30", color: s.color }}
                            >
                              {s.code}
                            </button>
                          ))}
                        </div>
                        <div className="border-t border-slate-700 mt-2 pt-1">
                          <button
                            onClick={() => removeColumn(code)}
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
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {DAY_KEYS.map((day) => {
              const isWeekend = day === "0" || day === "6";
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
                  {columns.map((code) => (
                    <td key={`${code}:${day}`} className="py-1.5 px-2 text-center">
                      <input
                        type="number"
                        min={0}
                        disabled={!canEdit}
                        className="w-12 bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-sm text-center font-mono disabled:opacity-50"
                        value={grid[`${code}:${day}`] ?? 0}
                        onChange={(e) => updateCell(code, day, parseInt(e.target.value) || 0)}
                      />
                    </td>
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
            {availableShiftTypes().filter((st) => !columns.includes(st.code)).map((st) => (
              <button
                key={st.id}
                onClick={() => addColumn(st.code)}
                className="w-full px-2 py-1.5 text-xs font-bold rounded text-center transition-colors hover:brightness-125"
                style={{ backgroundColor: st.color + "30", color: st.color }}
              >
                {st.code}
              </button>
            ))}
          </div>
          {availableShiftTypes().filter((st) => !columns.includes(st.code)).length === 0 && (
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
    </section>
  );
}

// ─── Pay Periods Section ────────────────────────────────────────────────────

function formatDateStr(dateStr: string, fmt: DateFormatKey): string {
  const d = new Date(dateStr + "T12:00:00");
  return formatDate(d, fmt);
}

function PayPeriodsSection({ initial, pushUndo, dateFormat }: { initial: PayPeriod[]; pushUndo: (a: UndoAction) => void; dateFormat: DateFormatKey }) {
  const canEdit = useCanEdit();
  const [periods, setPeriods] = useState(initial);
  const [startDate, setStartDate] = useState(initial[0]?.startDate ?? "2025-12-14");
  const [periodCount, setPeriodCount] = useState(initial.length || 26);
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

  async function regenerate() {
    if (!confirm(`This will replace all ${periods.length} existing pay periods. Continue?`)) return;
    const prevStart = periods[0]?.startDate ?? startDate;
    const prevCount = periods.length;
    const prevHours = periods[0]?.targetHours ?? 80;
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/pay-periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, periodCount, targetHours: prevHours }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPeriods(data);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);

      pushUndo({
        label: `Regenerated ${periodCount} pay periods`,
        execute: async () => {
          const res = await fetch("/api/settings/pay-periods", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startDate: prevStart, periodCount: prevCount, targetHours: prevHours }),
          });
          const data = await res.json();
          setPeriods(data);
          setStartDate(prevStart);
          setPeriodCount(prevCount);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  return (
    <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
      <SectionHeader
        title="Pay Periods"
        description="Biweekly pay period dates"
        status={status}
        error={error}
      />

      <div className="mb-4">
        <label className="text-xs text-slate-400 block mb-1">Hours per Pay Period (1.0 FTE)</label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            disabled={!canEdit}
            className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm font-mono disabled:opacity-50"
            value={baseHours}
            onChange={(e) => setBaseHours(parseFloat(e.target.value) || 80)}
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-xs text-slate-400 block mb-1">First Period Start</label>
          <input
            type="date"
            disabled={!canEdit}
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm disabled:opacity-50"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Number of Periods</label>
          <div className="flex gap-2">
            <input
              type="number"
              disabled={!canEdit}
              className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm disabled:opacity-50"
              value={periodCount}
              onChange={(e) => setPeriodCount(parseInt(e.target.value) || 26)}
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

      <div className="border-t border-slate-700 pt-3">
        <p className="text-xs text-slate-500 mb-2">{periods.length} pay periods configured</p>
        <ScrollContainer maxClass="max-h-[280px]">
          <div className="grid grid-cols-3 gap-1 text-xs">
            <span className="text-slate-500 font-medium">Period</span>
            <span className="text-slate-500 font-medium">Start</span>
            <span className="text-slate-500 font-medium">End</span>
            {periods.map((pp, i) => (
              <>
                <span key={`n-${pp.id}`} className="text-slate-400">PP {i + 1}</span>
                <span key={`s-${pp.id}`} className="text-slate-300 font-mono">{formatDateStr(pp.startDate, dateFormat)}</span>
                <span key={`e-${pp.id}`} className="text-slate-300 font-mono">{formatDateStr(pp.endDate, dateFormat)}</span>
              </>
            ))}
          </div>
        </ScrollContainer>
      </div>
    </section>
  );
}


// ─── Holidays Section ───────────────────────────────────────────────────────

function HolidaysSection({ initial, payPeriods, pushUndo, dateFormat }: { initial: Holiday[]; payPeriods: PayPeriod[]; pushUndo: (a: UndoAction) => void; dateFormat: DateFormatKey }) {
  const canEdit = useCanEdit();
  const [holidays, setHolidays] = useState(initial);
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
              body: JSON.stringify({ date: removed.date, name: removed.name }),
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
    <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
      <SectionHeader
        title="Holidays"
        description="Days with special staffing rules (reduced coverage, no ORL)"
        status={status}
        error={error}
      />

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
                {canEdit && (
                  <button
                    onClick={() => removeHoliday(h.id)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </ScrollContainer>
      )}
    </section>
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
    <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
      <SectionHeader
        title="Shift Desirability"
        description="Rate how desirable each shift is per day of week. Used by the equity engine and auto-scheduler."
        status={status}
        error={error}
      />
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
    </section>
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

// Format a save stamp as `YYYY-MM-DD HH:mm` in 24-hour local time (project rule: never AM/PM).
function formatProfileStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
  const [factors, setFactors] = useState(initial); // working draft
  const [savedFactors, setSavedFactors] = useState(initial); // last persisted order
  const [profiles, setProfiles] = useState(initialProfiles);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [profileName, setProfileName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const dirty = !sameOrder(factors, savedFactors);

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
        body: JSON.stringify({ order: factors.map((f) => f.key) }),
      });
      if (!res.ok) throw new Error(await res.text());
      const saved: AutoGenFactorData[] = await res.json();
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
    <section className="bg-slate-800/50 rounded-lg border border-slate-700 p-6">
      <SectionHeader
        title="Auto-Generation Priority"
        description="How auto-generation decides what to schedule when goals compete. Higher items win — a factor is never traded away to improve one below it. Drag to re-rank, then Save."
        status={status}
        error={error}
      />

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
                <div className="min-w-0">
                  <span className="text-sm text-slate-200 font-medium">{meta.label}</span>
                  {meta.description && <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>}
                </div>
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
            {dirty && <span className="text-xs text-amber-400">Unsaved order — Save to apply.</span>}
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
                    Saved by {p.createdByName} · {formatProfileStamp(p.createdAt)}
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
    </section>
  );
}

// ─── Scheduling Preferences Section ─────────────────────────────────────────

function EquityFactorsSection({
  initial,
  availableShiftCodes,
}: {
  initial: EquityFactorData[];
  availableShiftCodes: string[];
}) {
  const canEdit = useCanEdit();
  const [factors, setFactors] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  function factorLabel(f: EquityFactorData): string {
    if (f.factorType === "desirability") return "Shift Desirability";
    if (f.factorType === "holiday") return "Holiday Work";
    if (f.factorType === "shift") return `${f.shiftCode} Count`;
    return f.factorType;
  }

  function updateFactor(idx: number, updates: Partial<EquityFactorData>) {
    setFactors((prev) => prev.map((f, i) => (i === idx ? { ...f, ...updates } : f)));
  }

  function removeFactor(idx: number) {
    setFactors((prev) => prev.filter((_, i) => i !== idx));
  }

  function addShiftFactor() {
    const usedCodes = new Set(factors.filter((f) => f.factorType === "shift").map((f) => f.shiftCode));
    const available = availableShiftCodes.filter((c) => !usedCodes.has(c));
    if (available.length === 0) return;
    setFactors((prev) => [
      ...prev,
      { id: "", factorType: "shift", shiftCode: available[0], weight: 1.0, enabled: true, sortOrder: prev.length },
    ]);
  }

  function addBuiltinFactor(type: "desirability" | "holiday") {
    if (factors.some((f) => f.factorType === type)) return;
    setFactors((prev) => [
      ...prev,
      { id: "", factorType: type, shiftCode: null, weight: 1.0, enabled: true, sortOrder: prev.length },
    ]);
  }

  async function save() {
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/equity-factors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factors: factors.map((f, i) => ({ ...f, sortOrder: i })) }),
      });
      if (!res.ok) throw new Error(await res.text());
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
  const usedShiftCodes = new Set(factors.filter((f) => f.factorType === "shift").map((f) => f.shiftCode));
  const canAddShift = availableShiftCodes.some((c) => !usedShiftCodes.has(c));
  const hasDesirability = factors.some((f) => f.factorType === "desirability");
  const hasHoliday = factors.some((f) => f.factorType === "holiday");

  return (
    <section className="bg-slate-800/50 rounded-lg border border-slate-700 p-6">
      <SectionHeader
        title="Equity Factors"
        description="Configure which metrics factor into the equity score and their relative weights. All values are FTE-normalized."
        status={status}
        error={error}
      />
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
                  value={f.shiftCode ?? ""}
                  onChange={(e) => updateFactor(idx, { shiftCode: e.target.value })}
                >
                  {availableShiftCodes.map((code) => (
                    <option key={code} value={code} disabled={usedShiftCodes.has(code) && code !== f.shiftCode}>
                      {code} Count
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-slate-200 font-medium">{factorLabel(f)}</span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-slate-500">Weight:</span>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                disabled={!canEdit}
                className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-sm text-center text-slate-200 disabled:opacity-50"
                value={f.weight}
                onChange={(e) => updateFactor(idx, { weight: parseFloat(e.target.value) || 1 })}
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
    </section>
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
    <section className="bg-slate-800/50 rounded-lg border border-slate-700 p-6">
      <SectionHeader
        title="Date Format"
        description="Choose how dates are displayed throughout the application."
        status={status}
        error={error}
      />
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
    </section>
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

  const POLICY_LABELS: Record<RequestConflictPolicy, { label: string; hint: string }> = {
    reconcile: { label: "Reconcile (first-come)", hint: "Place requests tentatively; grant each only if conflict-free, earliest request wins a contended slot" },
    "honor-always": { label: "Honor always", hint: "Force every requested shift first and keep it, even past the staffer's hour cap" },
  };

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
  const LIVE_SCOPE_HINTS: Record<LiveScope, string> = {
    limited: "Fewest changes; hours may drift",
    day: "Re-solve the edited day(s)",
    pp: "Rebalance the whole pay period",
    range: "Re-solve the whole range",
  };

  return (
    <section className="bg-slate-800/50 rounded-lg border border-slate-700 p-6">
      <SectionHeader
        title="Scheduling Preferences"
        description="Controls how the auto-scheduler places days off. Staffing requirements are always respected first."
        status={status}
        error={error}
      />
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
          <input
            type="number"
            min={0}
            max={999}
            value={prefs.maxLeavePerDay}
            disabled={!canEdit}
            onChange={(e) => setPrefs((p) => ({ ...p, maxLeavePerDay: Math.max(0, Math.min(999, parseInt(e.target.value) || 0)) }))}
            onBlur={(e) => canEdit && saveMaxLeave(Math.max(0, Math.min(999, parseInt(e.target.value) || 0)))}
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
      </div>
    </section>
  );
}

// ─── Pay-period preferences (department-wide, per-FTE shift targets) ─────────

type DeptTargetData = {
  id: string;
  shiftTypeId: string;
  minCount: number;
  maxCount: number | null;
  window: string;
  windowDays: number | null;
  windowCount: number | null;
  strength: string; // "preference" (soft) | "rule" (hard)
  perFte: boolean;
};

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

  type PickerTarget = { shiftTypeId: string; minCount: number; maxCount?: number | null; window: string; windowDays?: number | null; windowCount?: number | null };

  async function save(shiftTypeId: string, target: PickerTarget | undefined, strengthOverride?: string) {
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
          body: JSON.stringify({
            shiftTypeId,
            minCount: target.minCount,
            maxCount: target.maxCount ?? null,
            window: target.window,
            windowDays: target.windowDays ?? null,
            windowCount,
            strength: strengthOverride ?? existing?.strength ?? "preference",
            perFte: true,
          }),
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

  function toggleStrength(shiftTypeId: string) {
    const r = rowFor(shiftTypeId);
    if (!r) return;
    save(
      shiftTypeId,
      { shiftTypeId, minCount: r.minCount, maxCount: r.maxCount, window: r.window, windowDays: r.windowDays, windowCount: r.windowCount },
      r.strength === "rule" ? "preference" : "rule",
    );
  }

  return (
    <section className="bg-slate-800/50 rounded-lg border border-slate-700 p-6">
      <SectionHeader
        title="Pay-period preferences"
        description="Department-wide shift targets, expressed per 1.0 FTE. The auto-scheduler scales each target to a staffer's FTE (e.g. 2 per 1.0 FTE → ~2 at 0.8 FTE) to bias the shift mix. Only affects staff who are eligible for that shift; a per-staff target for the same shift overrides the department default. Staffing requirements are always respected first."
        status={status}
        error={error}
      />
      <div className="space-y-2 mt-4">
        {workShifts.map((st) => {
          const row = rowFor(st.id);
          const target = row ? { shiftTypeId: st.id, minCount: row.minCount, maxCount: row.maxCount, window: row.window, windowDays: row.windowDays, windowCount: row.windowCount } : undefined;
          return (
            <div key={st.id} className="flex items-center gap-3 py-1.5 border-b border-slate-700/40 last:border-0">
              <div className="w-16 shrink-0 text-sm font-medium text-slate-200" title={st.name}>{st.code}</div>
              <div className="flex-1">
                <FrequencyPicker
                  shiftTypeId={st.id}
                  target={target}
                  onChange={(t) => canEdit && save(st.id, t as PickerTarget | undefined)}
                />
              </div>
              <button
                onClick={() => canEdit && toggleStrength(st.id)}
                disabled={!canEdit || !row}
                title={row?.strength === "rule" ? "Hard rule — must be met (warns if unmet)" : "Soft preference — biases the mix, never overrides staffing"}
                className={[
                  "shrink-0 px-2 py-1 rounded text-[11px] font-medium border transition-colors",
                  !row ? "opacity-30 border-slate-700 text-slate-500" : row.strength === "rule" ? "bg-amber-600/20 border-amber-500 text-amber-300" : "bg-blue-600/20 border-blue-500 text-blue-300",
                  !canEdit || !row ? "cursor-not-allowed" : "",
                ].join(" ")}
              >
                {row?.strength === "rule" ? "Hard" : "Soft"}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500 mt-3">Soft/hard enforcement of these targets lands in a follow-up; for now they feed the same min/max logic as per-staff targets.</p>
    </section>
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
    <section className="bg-slate-800/50 rounded-lg border border-slate-700 p-6">
      <SectionHeader
        title="Email (SMTP)"
        description="Outbound mail for request confirmations. Nothing sends until this is filled in and enabled."
        status={status}
        error={error}
      />
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
              <input className={input} disabled={!canEdit} type="number" value={cfg.port} onChange={(e) => setCfg((c) => ({ ...c, port: parseInt(e.target.value) || 0 }))} />
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
    </section>
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

  function updateField(id: string, field: keyof EmploymentTypeData, value: unknown) {
    setTypes((prev) => prev.map((t) => t.id === id ? { ...t, [field]: value } : t));
  }

  const cancelEdit = useCallback(() => {
    if (!editingId) return;
    const orig = initial.find((t) => t.id === editingId);
    if (orig) setTypes((prev) => prev.map((t) => t.id === editingId ? orig : t));
    setEditingId(null);
  }, [editingId, initial]);
  useEscape(cancelEdit);

  async function saveType(et: EmploymentTypeData) {
    const prev = initial.find((t) => t.id === et.id);
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/employment-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(et),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditingId(null);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
      if (prev) {
        pushUndo({
          label: `Updated ${et.name}`,
          execute: async () => {
            await fetch("/api/settings/employment-types", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(prev),
            });
            setTypes((cur) => cur.map((t) => t.id === prev.id ? prev : t));
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
        defaultEligibleShiftTypeIds: (created.defaultEligibleShifts ?? []).map((ds: { shiftTypeId: string }) => ds.shiftTypeId),
        defaultAvailabilityRules: (created.defaultAvailability ?? []).map((da: DefaultAvailabilityRule) => ({
          type: da.type, strength: da.strength,
          whenKind: da.whenKind, whenDays: da.whenDays, whenPpWeek: da.whenPpWeek, whenOrds: da.whenOrds,
          whenCycleUnit: da.whenCycleUnit, whenCycleN: da.whenCycleN, whenCycleOffset: da.whenCycleOffset,
        })),
        sortOrder: created.sortOrder,
        staffCount: 0,
      };
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
          setTypes((cur) => [...cur, { ...et, id: created.id }]);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }

  const et = editingType;

  return (
    <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
      <SectionHeader
        title="Employment Types"
        description="Define employment categories and their default scheduling values"
        status={status}
        error={error}
      />
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
                {(t.defaultFtePercentage * 100).toFixed(0)}%
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
                  <div className="text-sm text-slate-200">FTE percentage</div>
                  <div className="text-xs text-slate-500">Default target hours ratio</div>
                </div>
                <select disabled={!canEdit} className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm disabled:opacity-50" value={et.defaultFtePercentage} onChange={(e) => updateField(et.id, "defaultFtePercentage", parseFloat(e.target.value))}>
                  {[1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0].map((v) => (
                    <option key={v} value={v}>{(v * 100).toFixed(0)}%</option>
                  ))}
                </select>
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
    </section>
  );
}

// ─── Count Columns Section ──────────────────────────────────────────────────

function CountColumnsSection({ initial, shiftTypes }: { initial: { id: string; label: string; shiftCodes: string[] }[]; shiftTypes: ShiftType[] }) {
  const canEdit = useCanEdit();
  const [columns, setColumns] = useState(initial.map((c) => ({ label: c.label, shiftCodes: [...c.shiftCodes] })));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const allCodes = shiftTypes.filter((st) => !st.isOffShift).map((st) => st.code);

  async function save() {
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/count-columns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns }),
      });
      if (!res.ok) throw new Error("Save failed");
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }

  function addColumn() {
    setColumns([...columns, { label: "", shiftCodes: [] }]);
  }

  function removeColumn(idx: number) {
    setColumns(columns.filter((_, i) => i !== idx));
  }

  function updateLabel(idx: number, label: string) {
    setColumns(columns.map((c, i) => (i === idx ? { ...c, label } : c)));
  }

  function addCode(idx: number, code: string) {
    setColumns(columns.map((c, i) => (i === idx ? { ...c, shiftCodes: [...c.shiftCodes, code] } : c)));
  }

  function removeCode(idx: number, code: string) {
    setColumns(columns.map((c, i) => (i === idx ? { ...c, shiftCodes: c.shiftCodes.filter((sc) => sc !== code) } : c)));
  }

  return (
    <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
      <SectionHeader title="Count Columns on Printed Schedule" description="Define columns that count staff per day on the schedule grid." status={status} />

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
                {col.shiftCodes.map((code) => (
                  <span key={code} className="inline-flex items-center gap-0.5 bg-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-xs border border-slate-600">
                    {code}
                    {canEdit && <button onClick={() => removeCode(idx, code)} className="text-slate-500 hover:text-red-400 ml-0.5">×</button>}
                  </span>
                ))}
                {canEdit && (
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) addCode(idx, e.target.value); }}
                    className="bg-slate-700 text-slate-400 rounded px-1 py-0.5 text-xs border border-slate-600"
                  >
                    <option value="">+ add</option>
                    {allCodes.filter((c) => !col.shiftCodes.includes(c)).map((c) => (
                      <option key={c} value={c}>{c}</option>
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
    </section>
  );
}

// ─── Print Column Rules Section ─────────────────────────────────────────────

type EditCondition = {
  quantifier: string; // has_any | has_none | has_all
  categories: string[]; // work | leave | off
  codes: string[];
  except: string[];
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

// FTE % shown as a whole-number percentage; stored as a fraction (1.0 = 100%) to
// match Staff.ftePercentage and the visibility helper.
const pctVal = (f: number | null) => (f == null ? "" : String(Math.round(f * 100)));
const parsePct = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n / 100 : null;
};

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
  allCodes,
  canEdit,
}: {
  value: RuleFields;
  onChange: (patch: Partial<RuleFields>) => void;
  employmentTypes: EmploymentTypeData[];
  allCodes: string[];
  canEdit: boolean;
}) {
  const empName = (id: string) => employmentTypes.find((e) => e.id === id)?.name ?? id;
  const conds = value.conditions;
  const setConds = (c: EditCondition[]) => onChange({ conditions: c });
  const addCond = () => setConds([...conds, { quantifier: "has_any", categories: [], codes: [], except: [] }]);
  const removeCond = (ci: number) => setConds(conds.filter((_, j) => j !== ci));
  const updateCond = (ci: number, patch: Partial<EditCondition>) =>
    setConds(conds.map((c, j) => (j === ci ? { ...c, ...patch } : c)));
  const toggleCat = (ci: number, cat: string) => {
    const c = conds[ci];
    updateCond(ci, { categories: c.categories.includes(cat) ? c.categories.filter((x) => x !== cat) : [...c.categories, cat] });
  };
  const addListItem = (ci: number, field: "codes" | "except", code: string) => {
    const c = conds[ci];
    if (c[field].includes(code)) return;
    updateCond(ci, { [field]: [...c[field], code] });
  };
  const removeListItem = (ci: number, field: "codes" | "except", code: string) => {
    const c = conds[ci];
    updateCond(ci, { [field]: c[field].filter((x) => x !== code) });
  };
  const addEmp = (id: string) => onChange({ employmentTypeIds: [...value.employmentTypeIds, id] });
  const removeEmp = (id: string) => onChange({ employmentTypeIds: value.employmentTypeIds.filter((x) => x !== id) });

  // Chip + add-dropdown for a condition's codes/except lists.
  function codeChips(ci: number, field: "codes" | "except", label: string) {
    const c = conds[ci];
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[11px] text-slate-500">{label}</span>
        {c[field].map((code) => (
          <span key={code} className="inline-flex items-center gap-0.5 bg-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-[11px] border border-slate-600">
            {code}
            {canEdit && <button onClick={() => removeListItem(ci, field, code)} className="text-slate-500 hover:text-red-400 ml-0.5">×</button>}
          </span>
        ))}
        {canEdit && (
          <select value="" onChange={(e) => { if (e.target.value) addListItem(ci, field, e.target.value); }} className="bg-slate-700 text-slate-400 rounded px-1 py-0.5 text-[11px] border border-slate-600">
            <option value="">+</option>
            {allCodes.filter((x) => !c[field].includes(x)).map((x) => <option key={x} value={x}>{x}</option>)}
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
        <span className="text-xs text-slate-500 w-20">FTE %:</span>
        <input type="number" min={0} disabled={!canEdit} value={pctVal(value.minFtePercentage)} onChange={(e) => onChange({ minFtePercentage: parsePct(e.target.value) })} placeholder="min" className="bg-slate-700 text-slate-200 rounded px-2 py-1 text-xs border border-slate-600 w-16 disabled:opacity-50" />
        <span className="text-xs text-slate-500">to</span>
        <input type="number" min={0} disabled={!canEdit} value={pctVal(value.maxFtePercentage)} onChange={(e) => onChange({ maxFtePercentage: parsePct(e.target.value) })} placeholder="max" className="bg-slate-700 text-slate-200 rounded px-2 py-1 text-xs border border-slate-600 w-16 disabled:opacity-50" />
        <span className="text-xs text-slate-600 italic">blank = no bound</span>
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
            {codeChips(ci, "codes", c.quantifier === "has_all" ? "shifts:" : "+shifts:")}
            {c.quantifier !== "has_all" && c.categories.length > 0 && codeChips(ci, "except", "except:")}
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
        codes: [...c.codes],
        except: [...c.except],
      })),
    })),
  );
  const [status, setStatus] = useState<SaveStatus>("idle");
  const allCodes = shiftTypes.map((st) => st.code); // includes leave + off (X) so conditions can target them

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
    try {
      // Drop conditions with no positive selector (they impose no constraint).
      const payload = rules.map((r) => ({
        ...r,
        conditions: r.conditions.filter((c) => c.categories.length > 0 || c.codes.length > 0),
      }));
      const res = await fetch("/api/settings/print-column-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: payload }),
      });
      if (!res.ok) throw new Error("Save failed");
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
      <SectionHeader
        title="Staff Columns on Printed Schedule"
        description="Rules deciding which staff get their own column when printing. Include rules pick who prints (no include rules = everyone); exclude rules then remove matches. A rule's shift conditions are ALL required (AND). No rules = print everyone. Print-only — the on-screen grid always shows all staff."
        status={status}
      />

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

            <RuleFieldsEditor value={rule} onChange={(patch) => update(idx, patch)} employmentTypes={employmentTypes} allCodes={allCodes} canEdit={canEdit} />
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
    </section>
  );
}

type EditAggCol = {
  label: string;
  enabled: boolean;
  isOther: boolean;
  suppressMembers: boolean;
  conditionScope: string; // "month" (match over the whole month) | "day" (match per day)
} & RuleFields;

// Configurable AGGREGATE columns on the printed schedule (the replacement for the old
// hardcoded "FB" column). Each named column lists, per day, the initials of the staff
// matching its rule who are scheduled that day; suppressMembers hides those staff's own
// columns. A column with the "Catch-all" (isOther) flag has no rule and lists the
// residual — staff who appear in no other column. Catch-all is just a per-column toggle:
// columns are otherwise identical and all freely editable / movable / deletable.
function AdditionalColumnsSection({
  initial,
  shiftTypes,
  employmentTypes,
}: {
  initial: PrintAggregateColumnData[];
  shiftTypes: ShiftType[];
  employmentTypes: EmploymentTypeData[];
}) {
  const canEdit = useCanEdit();
  const [cols, setCols] = useState<EditAggCol[]>(
    initial.map((c) => ({
      label: c.label,
      enabled: c.enabled,
      isOther: c.isOther,
      suppressMembers: c.suppressMembers,
      conditionScope: c.conditionScope === "day" ? "day" : "month",
      employmentTypeIds: [...c.employmentTypeIds],
      minFtePercentage: c.minFtePercentage,
      maxFtePercentage: c.maxFtePercentage,
      conditions: (c.conditions ?? []).map((x) => ({
        quantifier: x.quantifier,
        categories: [...x.categories],
        codes: [...x.codes],
        except: [...x.except],
      })),
    })),
  );
  const [status, setStatus] = useState<SaveStatus>("idle");
  const allCodes = shiftTypes.map((st) => st.code);

  function update(idx: number, patch: Partial<EditAggCol>) {
    setCols(cols.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function addCol() {
    setCols([...cols, { label: "", enabled: true, isOther: false, suppressMembers: true, conditionScope: "month", employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions: [] }]);
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
    try {
      const payload = cols.map((c) => ({
        ...c,
        // The Other column carries no rule; named columns drop empty-selector conditions.
        conditions: c.isOther ? [] : c.conditions.filter((x) => x.categories.length > 0 || x.codes.length > 0),
      }));
      const res = await fetch("/api/settings/print-aggregate-columns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns: payload }),
      });
      if (!res.ok) throw new Error("Save failed");
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
      <SectionHeader
        title="Additional Columns on Printed Schedule"
        description="Extra aggregate columns for the printed schedule. Each lists, per day, the initials of the staff matching its rule who are scheduled that day. 'Suppress members' hides those staff's own individual columns in print (otherwise they appear both places). Tick 'Catch-all' to make a column the residual — it lists everyone who appears in no other column (no rule of its own). A column with no one to show that month is hidden automatically. Print-only — the on-screen grid is unchanged."
        status={status}
      />

      <div className="space-y-3">
        {cols.map((col, idx) => {
          // A non-catch-all column with no selector at all matches EVERY staff — flag it
          // so the admin doesn't accidentally sweep everyone into one column.
          const hasSelector =
            col.employmentTypeIds.length > 0 ||
            col.minFtePercentage != null ||
            col.maxFtePercentage != null ||
            col.conditions.some((c) => c.categories.length > 0 || c.codes.length > 0);
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

            {col.isOther ? (
              <p className="text-[11px] text-slate-500 italic">Catch-all — lists staff who appear in no other column (no rule).</p>
            ) : (
              <>
                <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                  <span>Conditions apply to:</span>
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
                      ? "lists a person only on the days their shift meets the conditions"
                      : "lists a person on every scheduled day if they meet the conditions anytime that month"}
                  </span>
                </div>
                <RuleFieldsEditor value={col} onChange={(patch) => update(idx, patch)} employmentTypes={employmentTypes} allCodes={allCodes} canEdit={canEdit} />
                {col.enabled && !hasSelector && (
                  <p className="text-[11px] text-amber-400/90">No rule set — this column matches <strong>all staff</strong>. Add an employment type, FTE bound, or shift condition, or tick Catch-all.</p>
                )}
              </>
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
    </section>
  );
}

// ─── Main Settings Page ─────────────────────────────────────────────────────

export function SettingsPage({ shiftTypes, staffingReqs, payPeriods, holidays, desirabilityWeights, schedulingPrefs, departmentTargets, employmentTypes, equityFactors: initialEquityFactors, autoGenFactors: initialAutoGenFactors, autoGenProfiles: initialAutoGenProfiles, shiftCodes: availableShiftCodes, followRules: initialFollowRules, requiredFollowers: initialRequiredFollowers, countColumns: initialCountColumns, printColumnRules: initialPrintColumnRules, printAggregateColumns: initialPrintAggregateColumns, canEdit = true, canEditAutoGenPriority = false }: Props) {
  const undo = useUndo();
  const [dateFormat, setDateFormat] = useState<DateFormatKey>((schedulingPrefs.dateFormat || DEFAULT_DATE_FORMAT) as DateFormatKey);

  return (
    <CanEditContext.Provider value={canEdit}>
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {!canEdit && (
          <div className="px-4 py-2.5 bg-slate-800/60 border border-slate-700/50 rounded text-xs text-slate-400 text-center">
            View-only — you do not have permission to edit settings
          </div>
        )}
        <ShiftTypesSection initial={shiftTypes} pushUndo={undo.push} initialFollowRules={initialFollowRules} initialRequiredFollowers={initialRequiredFollowers} />
        <EmploymentTypesSection initial={employmentTypes} pushUndo={undo.push} shiftTypes={shiftTypes} />
        <StaffingSection initial={staffingReqs} shiftTypes={shiftTypes} pushUndo={undo.push} />
        <PrintColumnRulesSection initial={initialPrintColumnRules} shiftTypes={shiftTypes} employmentTypes={employmentTypes} />
        <AdditionalColumnsSection initial={initialPrintAggregateColumns} shiftTypes={shiftTypes} employmentTypes={employmentTypes} />
        <CountColumnsSection initial={initialCountColumns} shiftTypes={shiftTypes} />
        <DesirabilitySection initial={desirabilityWeights} shiftTypes={shiftTypes} pushUndo={undo.push} />
        <AutoGenPrioritySection initial={initialAutoGenFactors} initialProfiles={initialAutoGenProfiles} canEdit={canEditAutoGenPriority} />
        <EquityFactorsSection initial={initialEquityFactors} availableShiftCodes={availableShiftCodes} />
        <DateFormatSection selected={dateFormat} onChange={(fmt) => setDateFormat(fmt as DateFormatKey)} />
        <SchedulingPrefsSection initial={schedulingPrefs} shiftTypes={shiftTypes} />
        <PayPeriodPrefsSection initial={departmentTargets} shiftTypes={shiftTypes} />
        <EmailSettingsSection />
        <PayPeriodsSection initial={payPeriods} pushUndo={undo.push} dateFormat={dateFormat} />
        <HolidaysSection initial={holidays} payPeriods={payPeriods} pushUndo={undo.push} dateFormat={dateFormat} />
      </div>

      {undo.pending && (
        <UndoToast action={undo.pending} onUndo={undo.execute} onDismiss={undo.dismiss} />
      )}
    </div>
    </CanEditContext.Provider>
  );
}
