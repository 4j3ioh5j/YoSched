"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEscape } from "@/lib/use-escape";
import type { StaffLoginStatus } from "@/lib/staff-login-status";
import { ruleToWhen, isPlainWeekdayWhen, whenToColumns, describeWhen, standingToWhen } from "@/lib/recurrence";
import { RecurrencePicker } from "./recurrence-picker";
import { FrequencyPicker } from "./frequency-picker";
import { describeFrequency, type ShiftMinTarget } from "@/lib/shift-eligibility";

// Read-only login-setup badge shown per staff row. Activation/credentials are managed
// on /users (deep-link); editing here only changes scheduling attributes.
const LOGIN_STATUS_STYLE: Record<StaffLoginStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-emerald-700/40 text-emerald-300" },
  disabled: { label: "Disabled", cls: "bg-slate-600/40 text-slate-300" },
  needs_setup: { label: "Needs setup", cls: "bg-amber-700/40 text-amber-300" },
  none: { label: "No login", cls: "bg-red-900/40 text-red-300" },
};

function LoginStatusBadge({ status }: { status: StaffLoginStatus }) {
  const s = LOGIN_STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.cls}`}>{s.label}</span>
      {status !== "active" && (
        <a
          href="/users"
          onClick={(e) => e.stopPropagation()}
          className="text-[10px] text-blue-400 hover:underline"
          title="Manage logins on the Users page"
        >
          manage →
        </a>
      )}
    </span>
  );
}

// The unified WHEN columns (slice 3b/4). Carried end-to-end so an explicit
// rule authored via the RecurrencePicker round-trips losslessly. When whenKind
// is null the rule is legacy-shaped and the server bridges from pattern/cycle*.
type WhenFields = {
  whenKind?: string | null;
  whenDays?: number[] | null;
  whenPpWeek?: number | null;
  whenOrds?: number[] | null;
  whenCycleUnit?: string | null;
  whenCycleN?: number | null;
  whenCycleOffset?: number | null;
};

type AvailabilityRule = WhenFields & {
  type: string;
  strength: string;
  conditionStaffId?: string | null;
  conditionType?: string | null;
};

type ShiftEligibilityRuleData = WhenFields & {
  shiftTypeId: string;
  type: string;
  strength: string;
};

type ShiftMinimumTargetData = {
  shiftTypeId: string;
  minCount: number;
  maxCount?: number | null;
  window: string;
  windowDays?: number | null;
  windowCount?: number | null;
};

// StandingCommitment carries the unified WHEN columns (slice 7 dropped its legacy
// dayOfWeek + frequency columns). The picker writes when*; the scheduler reads
// via standingToWhen.
type StandingCommitmentData = WhenFields & {
  shiftTypeId: string;
  notes?: string | null;
};

// Per-staff shift-hour override. durationHrs is the legacy base; the day-type
// values fall back to it when null. The editor writes explicit weekday/weekend
// values, so a UI-created row carries all three.
type ShiftOverrideData = {
  shiftTypeId: string;
  durationHrs: number;
  durationHrsWeekday: number | null;
  durationHrsWeekend: number | null;
};

type Staff = {
  id: string;
  name: string;
  loginStatus: StaffLoginStatus;
  initials: string;
  employmentTypeId: string;
  employmentTypeName: string;
  ftePercentage: number;
  availabilityRules: AvailabilityRule[];
  eligibleShiftTypeIds: string[];
  shiftEligibilityRules: ShiftEligibilityRuleData[];
  shiftMinimumTargets: ShiftMinimumTargetData[];
  standingCommitments: StandingCommitmentData[];
  shiftOverrides: ShiftOverrideData[];
  specialQualifications: string[];
  isActive: boolean;
  isAutoScheduled: boolean;
  sortOrder: number;
};

type DefaultAvailabilityRule = WhenFields & {
  type: string;
  strength: string;
};

type EmploymentType = {
  id: string;
  name: string;
  defaultIsAutoScheduled: boolean;
  defaultFtePercentage: number;
  defaultEligibleShiftTypeIds: string[];
  defaultAvailabilityRules: DefaultAvailabilityRule[];
};

type ShiftTypeInfo = {
  id: string;
  code: string;
  name: string;
  color: string;
  category: string;
  isLeave: boolean;
  autoSchedulable: boolean;
  defaultHours: number; // weekday hours
  defaultHoursWeekend: number; // 0 = does not accrue weekend hours
  defaultHoursHoliday: number; // 0 = does not accrue holiday hours
};

type Props = {
  canEdit: boolean;
  staff: Staff[];
  employmentTypes: EmploymentType[];
  allShiftTypes: ShiftTypeInfo[];
};

type UndoAction = {
  label: string;
  execute: () => Promise<void>;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_INDICES = [0, 1, 2, 3, 4, 5, 6];
const DAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

// Does a rule land on weekday `d`? Honors the full WHEN weekday set (multi-day
// rules cover every selected weekday, not just the back-projected legacy one;
// [] = any day). Used by the collapsed-card preview grid.
function ruleCoversDay(r: AvailabilityRule, d: number): boolean {
  const days = ruleToWhen(r).daysOfWeek;
  return days.length === 0 || days.includes(d);
}

function hasBaseRule(rules: AvailabilityRule[], dayOfWeek: number): boolean {
  return rules.some((r) => r.type === "available" && ruleCoversDay(r, dayOfWeek));
}

// A "plain" rule is the trivial available/hard/unconditioned single-weekday
// every-occurrence rule that the quick-toggle row manages. Everything else
// (multi-day, ordinal, pp-week, cycle, preference, off, or conditioned) is an
// advanced rule shown/edited in the rule list. Routed through the WHEN model so
// an explicit picker rule with a back-projected legacy pattern="every" is still
// correctly recognized as advanced (and never hidden or clobbered by the toggle).
function isPlainRule(r: AvailabilityRule): boolean {
  return (
    r.type === "available" &&
    r.strength === "rule" &&
    !r.conditionStaffId &&
    isPlainWeekdayWhen(ruleToWhen(r))
  );
}

function hasAdvancedRule(rules: AvailabilityRule[], dayOfWeek: number): boolean {
  return rules.some((r) => ruleCoversDay(r, dayOfWeek) && !isPlainRule(r));
}

function UndoToast({ action, onUndo, onDismiss }: { action: UndoAction; onUndo: () => void; onDismiss: () => void }) {
  useEscape(onDismiss);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 shadow-xl">
      <span className="text-sm text-slate-200">{action.label}</span>
      <button onClick={onUndo} className="px-3 py-1 text-sm font-medium bg-blue-600 hover:bg-blue-500 rounded transition-colors">
        Undo
      </button>
      <button onClick={onDismiss} className="text-slate-400 hover:text-slate-200 text-sm transition-colors">×</button>
    </div>
  );
}

function FieldRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2.5 gap-4">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{label}</div>
        {description && <div className="text-xs text-slate-500 mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function AvailabilityEditor({
  rules,
  onChange,
  allStaff,
  currentStaffId,
}: {
  rules: AvailabilityRule[];
  onChange: (rules: AvailabilityRule[]) => void;
  allStaff: { id: string; initials: string }[];
  currentStaffId: string;
}) {
  function toggleDay(d: number) {
    // Only manage the plain single-day rules; advanced rules (multi-day,
    // ordinal, preference, off, conditioned) for this weekday are left intact.
    const plainForDay = rules.filter((r) => isPlainRule(r) && ruleCoversDay(r, d));
    if (plainForDay.length > 0) {
      onChange(rules.filter((r) => !(isPlainRule(r) && ruleCoversDay(r, d))));
    } else {
      onChange([...rules, { type: "available", strength: "rule", ...whenToColumns({ daysOfWeek: [d], kind: "every" }) }]);
    }
  }

  const advancedRules = rules.filter((r) => !isPlainRule(r));

  function updateRuleAtIndex(globalIndex: number, updates: Partial<AvailabilityRule>) {
    onChange(rules.map((r, i) => (i === globalIndex ? { ...r, ...updates } : r)));
  }

  function removeRuleAtIndex(globalIndex: number) {
    onChange(rules.filter((_, i) => i !== globalIndex));
  }

  function addAdvancedRule() {
    onChange([...rules, { type: "available", strength: "preference", ...whenToColumns({ daysOfWeek: [1], kind: "every" }) }]);
  }

  const otherStaff = allStaff.filter((p) => p.id !== currentStaffId);

  return (
    <div className="space-y-3">
      {/* Layer 1: Quick day toggles */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1.5">Working days</div>
        <div className="flex gap-1">
          {DAY_INDICES.map((d) => {
            // Lit state reflects only the plain rule the toggle manages, so the
            // lit state and the click action stay consistent. But an advanced
            // rule (available/unavailable/preference/conditioned) covering this
            // day lives in the list below and would otherwise be invisible here
            // — flag it with an amber dot (mirroring the roster grid) so the
            // toggle never reads as a plain on/off when a rule is also in play.
            const active = rules.some((r) => isPlainRule(r) && ruleCoversDay(r, d));
            const adv = hasAdvancedRule(rules, d);
            return (
              <button
                key={d}
                onClick={() => toggleDay(d)}
                title={adv ? `${DAY_LABELS[d]} is also governed by a rule below — see Rules` : undefined}
                className={[
                  "relative w-10 h-8 text-xs rounded font-medium transition-colors",
                  active ? "bg-blue-600/50 text-blue-200 border border-blue-500/50" : "bg-slate-700 text-slate-500 border border-slate-600",
                  adv ? "ring-1 ring-amber-400/40" : "",
                  "hover:brightness-125",
                ].join(" ")}
              >
                {DAY_LABELS[d]}
                {adv && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />}
              </button>
            );
          })}
        </div>
        <div className="text-[10px] text-slate-600 mt-1">
          Click to toggle basic availability. <span className="text-amber-400/80">Amber dot</span> = a rule below also covers that day. Use rules for advanced scheduling.
        </div>
      </div>

      {/* Layer 2: Advanced rules */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1.5">
          Rules {advancedRules.length > 0 && `(${advancedRules.length})`}
        </div>

        {rules.length === 0 && (
          <div className="text-xs text-slate-600 italic py-2">No availability set. Toggle days above or add a rule.</div>
        )}

        <div className="space-y-1.5">
          {rules.map((rule, globalIdx) => {
            if (isPlainRule(rule)) return null;

            const condName = rule.conditionStaffId
              ? otherStaff.find((p) => p.id === rule.conditionStaffId)?.initials ?? "?"
              : null;

            return (
              <div key={globalIdx} className="bg-slate-700/30 border border-slate-600/50 rounded-lg p-3 space-y-2">
                {/* Status + remove */}
                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  <select
                    className={[
                      "bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-xs font-medium",
                      rule.type === "available" ? "text-emerald-400" : "text-red-400",
                    ].join(" ")}
                    value={rule.type}
                    onChange={(e) => updateRuleAtIndex(globalIdx, { type: e.target.value })}
                  >
                    <option value="available">Available</option>
                    <option value="unavailable">Not available</option>
                  </select>
                  <button
                    onClick={() => removeRuleAtIndex(globalIdx)}
                    className="text-slate-600 hover:text-red-400 ml-auto transition-colors"
                    title="Remove rule"
                  >
                    ×
                  </button>
                </div>

                {/* When (unified recurrence) */}
                <RecurrencePicker
                  value={ruleToWhen(rule)}
                  onChange={(w) => updateRuleAtIndex(globalIdx, { ...whenToColumns(w) })}
                />

                {/* Enforcement */}
                <div className="flex items-center gap-1.5 text-xs pl-1">
                  <span className="text-slate-500">Enforcement:</span>
                  <select
                    className="bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-xs text-slate-300"
                    value={rule.strength}
                    onChange={(e) => updateRuleAtIndex(globalIdx, { strength: e.target.value })}
                  >
                    <option value="rule">Hard rule — auto-scheduler must follow</option>
                    <option value="preference">Soft preference — auto-scheduler will try</option>
                  </select>
                </div>

                {/* Condition */}
                <div className="flex items-center gap-1.5 text-xs pl-1">
                  <span className="text-slate-500">Condition:</span>
                  <select
                    className="bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-xs text-slate-300"
                    value={rule.conditionStaffId ?? ""}
                    onChange={(e) => {
                      const pid = e.target.value || null;
                      updateRuleAtIndex(globalIdx, {
                        conditionStaffId: pid,
                        conditionType: pid ? (rule.conditionType ?? "not_working") : null,
                      });
                    }}
                  >
                    <option value="">Always (no condition)</option>
                    {otherStaff.map((p) => (
                      <option key={p.id} value={p.id}>Only when {p.initials}...</option>
                    ))}
                  </select>
                  {rule.conditionStaffId && (
                    <select
                      className="bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-xs text-slate-300"
                      value={rule.conditionType ?? "not_working"}
                      onChange={(e) => updateRuleAtIndex(globalIdx, { conditionType: e.target.value })}
                    >
                      <option value="not_working">is not working</option>
                      <option value="working">is working</option>
                    </select>
                  )}
                </div>

                {/* Human-readable summary */}
                <div className="text-[10px] text-slate-500 italic border-t border-slate-600/30 pt-1.5 mt-1">
                  {rule.type === "available" ? (rule.strength === "preference" ? "Prefers to work" : "Works") : (rule.strength === "preference" ? "Prefers not to work" : "Cannot work")}
                  {": "}{describeWhen(ruleToWhen(rule))}
                  {condName && `, only when ${condName} ${rule.conditionType === "working" ? "is" : "is not"} working`}
                  .
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={addAdvancedRule}
          className="mt-2 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded transition-colors text-slate-300"
        >
          + Add rule
        </button>
      </div>
    </div>
  );
}

// Per-staff weekday/weekend shift-hour override. Empty input = use the shift's
// default; when both day types equal the default the override is cleared. A
// UI-created row writes explicit weekday/weekend values (durationHrs mirrors the
// weekday value as the legacy fallback).
function ShiftHoursOverrideEditor({
  shiftType,
  override,
  onChange,
}: {
  shiftType: ShiftTypeInfo;
  override: ShiftOverrideData | undefined;
  onChange: (o: ShiftOverrideData | undefined) => void;
}) {
  const defWd = shiftType.defaultHours;
  const defWe = shiftType.defaultHoursWeekend;
  // A shift accrues weekend hours iff its weekend default is non-zero (this
  // replaced the old countsOnWeekend flag).
  const countsWeekend = defWe > 0;
  const weekday = override ? (override.durationHrsWeekday ?? override.durationHrs) : null;
  const weekend = override ? (override.durationHrsWeekend ?? override.durationHrs) : null;

  function commit(nextWeekday: number | null, nextWeekend: number | null) {
    const wd = nextWeekday ?? defWd;
    // Shifts that don't accrue weekend hours keep weekend at 0; otherwise the
    // weekend value defaults to the shift's weekend hours.
    const we = countsWeekend ? (nextWeekend ?? defWe) : 0;
    if (wd === defWd && we === defWe) { onChange(undefined); return; }
    onChange({
      shiftTypeId: shiftType.id,
      durationHrs: wd,
      durationHrsWeekday: wd,
      durationHrsWeekend: we,
    });
  }

  function parse(v: string): number | null {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  const inputCls = "w-16 bg-slate-700 text-slate-200 rounded px-1.5 py-0.5 border border-slate-600 text-xs";

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <label className="flex items-center gap-1 text-xs text-slate-400">
        {countsWeekend ? "Weekday" : "Hours"}
        <input
          type="number" min={0} step="0.5"
          value={weekday ?? ""}
          placeholder={String(defWd)}
          onChange={(e) => commit(parse(e.target.value), weekend)}
          className={inputCls}
        />
      </label>
      {countsWeekend && (
        <label className="flex items-center gap-1 text-xs text-slate-400">
          Weekend
          <input
            type="number" min={0} step="0.5"
            value={weekend ?? ""}
            placeholder={String(defWe)}
            onChange={(e) => commit(weekday, parse(e.target.value))}
            className={inputCls}
          />
        </label>
      )}
      {override && (
        <button onClick={() => onChange(undefined)} className="text-[10px] text-slate-500 hover:text-red-400">reset</button>
      )}
    </div>
  );
}

function ShiftEligibilityEditor({
  shiftType,
  rules,
  minimumTarget,
  shiftOverride,
  onRulesChange,
  onMinimumChange,
  onOverrideChange,
}: {
  shiftType: ShiftTypeInfo;
  rules: ShiftEligibilityRuleData[];
  minimumTarget: ShiftMinimumTargetData | undefined;
  shiftOverride: ShiftOverrideData | undefined;
  onRulesChange: (rules: ShiftEligibilityRuleData[]) => void;
  onMinimumChange: (target: ShiftMinimumTargetData | undefined) => void;
  onOverrideChange: (o: ShiftOverrideData | undefined) => void;
}) {
  function addRule() {
    onRulesChange([...rules, { shiftTypeId: shiftType.id, type: "eligible", strength: "rule", ...whenToColumns({ daysOfWeek: [1], kind: "every" }) }]);
  }

  function updateRule(idx: number, updates: Partial<ShiftEligibilityRuleData>) {
    onRulesChange(rules.map((r, i) => (i === idx ? { ...r, ...updates } : r)));
  }

  function removeRule(idx: number) {
    onRulesChange(rules.filter((_, i) => i !== idx));
  }

  return (
    <div className="mt-2 space-y-2 pl-2 border-l-2 border-slate-700">
      <div className="text-[10px] uppercase tracking-wider text-slate-600">Eligibility rules</div>
      {rules.map((rule, idx) => (
        <div key={idx} className="bg-slate-700/30 border border-slate-600/50 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 text-xs flex-wrap">
            <select
              value={rule.type}
              onChange={(e) => updateRule(idx, { type: e.target.value })}
              className="bg-slate-700 text-slate-200 rounded px-1.5 py-0.5 border border-slate-600"
            >
              <option value="eligible">eligible</option>
              <option value="ineligible">ineligible</option>
            </select>
            <select
              value={rule.strength}
              onChange={(e) => updateRule(idx, { strength: e.target.value })}
              className="bg-slate-700 text-slate-200 rounded px-1.5 py-0.5 border border-slate-600"
            >
              <option value="rule">Hard</option>
              <option value="preference">Prefer</option>
            </select>
            <button onClick={() => removeRule(idx)} className="text-slate-500 hover:text-red-400 ml-auto">×</button>
          </div>
          <RecurrencePicker
            value={ruleToWhen(rule)}
            onChange={(w) => updateRule(idx, { ...whenToColumns(w) })}
          />
        </div>
      ))}
      <button onClick={addRule} className="text-xs text-blue-400 hover:text-blue-300">+ Add rule</button>

      <div className="pt-2 border-t border-slate-700/50">
        <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">Count target</div>
        <FrequencyPicker
          shiftTypeId={shiftType.id}
          target={minimumTarget}
          onChange={onMinimumChange}
        />
      </div>

      <div className="pt-2 border-t border-slate-700/50">
        <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">
          Hours override <span className="text-slate-600 normal-case">(default {shiftType.defaultHours}h)</span>
        </div>
        <ShiftHoursOverrideEditor
          shiftType={shiftType}
          override={shiftOverride}
          onChange={onOverrideChange}
        />
      </div>
    </div>
  );
}

function EligibleShiftsSection({ ep, allShiftTypes, updateField }: {
  ep: Staff;
  allShiftTypes: ShiftTypeInfo[];
  updateField: (id: string, field: keyof Staff, value: unknown) => void;
}) {
  const [expandedShifts, setExpandedShifts] = useState<Set<string>>(new Set());
  const workShifts = allShiftTypes.filter((st) => !st.isLeave && st.autoSchedulable);
  const leaveShifts = allShiftTypes.filter((st) => st.isLeave && st.autoSchedulable);

  function toggleEligible(stId: string) {
    const isEligible = ep.eligibleShiftTypeIds.includes(stId);
    const hasRules = ep.shiftEligibilityRules.some((r) => r.shiftTypeId === stId);
    if (isEligible) {
      const next = ep.eligibleShiftTypeIds.filter((id) => id !== stId);
      updateField(ep.id, "eligibleShiftTypeIds", next);
      if (hasRules) {
        updateField(ep.id, "shiftEligibilityRules", ep.shiftEligibilityRules.filter((r) => r.shiftTypeId !== stId));
        updateField(ep.id, "shiftMinimumTargets", ep.shiftMinimumTargets.filter((t) => t.shiftTypeId !== stId));
      }
    } else {
      updateField(ep.id, "eligibleShiftTypeIds", [...ep.eligibleShiftTypeIds, stId]);
    }
  }

  function renderShiftButton(st: ShiftTypeInfo) {
    const isEligible = ep.eligibleShiftTypeIds.includes(st.id);
    const hasRules = ep.shiftEligibilityRules.some((r) => r.shiftTypeId === st.id);
    const hasMin = ep.shiftMinimumTargets.some((t) => t.shiftTypeId === st.id);
    const isExpanded = expandedShifts.has(st.id);
    const rulesForShift = ep.shiftEligibilityRules.filter((r) => r.shiftTypeId === st.id);
    const minTarget = ep.shiftMinimumTargets.find((t) => t.shiftTypeId === st.id);
    const override = ep.shiftOverrides.find((o) => o.shiftTypeId === st.id);
    const hasOverride = !!override;

    return (
      <div key={st.id} className="space-y-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleEligible(st.id)}
            className={`px-2 py-0.5 text-xs font-bold rounded transition-colors border ${isEligible ? "" : "opacity-30"}`}
            style={{
              backgroundColor: isEligible ? st.color + "25" : undefined,
              color: st.color,
              borderColor: isEligible ? st.color + "50" : "transparent",
            }}
            title={st.name}
          >
            {st.code}
          </button>
          {isEligible && (
            <button
              onClick={() => setExpandedShifts((prev) => {
                const next = new Set(prev);
                if (next.has(st.id)) next.delete(st.id); else next.add(st.id);
                return next;
              })}
              className="text-slate-500 hover:text-slate-300 text-xs px-1"
              title="Configure eligibility rules"
            >
              {hasRules || hasMin || hasOverride ? (
                <span className="text-amber-500">{isExpanded ? "▾" : "▸"}</span>
              ) : (
                <span>{isExpanded ? "▾" : "▸"}</span>
              )}
            </button>
          )}
          {isEligible && (hasRules || hasMin || hasOverride) && !isExpanded && (
            <span className="text-[10px] text-slate-500">
              {rulesForShift.length > 0 && `${rulesForShift.length} rule${rulesForShift.length > 1 ? "s" : ""}`}
              {hasRules && hasMin && ", "}
              {hasMin && describeFrequency(minTarget! as ShiftMinTarget)}
              {(hasRules || hasMin) && hasOverride && ", "}
              {hasOverride && (
                st.defaultHoursWeekend > 0
                  ? `${override!.durationHrsWeekday ?? override!.durationHrs}/${override!.durationHrsWeekend ?? override!.durationHrs}h`
                  : `${override!.durationHrsWeekday ?? override!.durationHrs}h`
              )}
            </span>
          )}
        </div>
        {isExpanded && isEligible && (
          <ShiftEligibilityEditor
            shiftType={st}
            rules={rulesForShift}
            minimumTarget={minTarget}
            shiftOverride={override}
            onRulesChange={(newRules) => {
              const others = ep.shiftEligibilityRules.filter((r) => r.shiftTypeId !== st.id);
              updateField(ep.id, "shiftEligibilityRules", [...others, ...newRules]);
            }}
            onMinimumChange={(newTarget) => {
              const others = ep.shiftMinimumTargets.filter((t) => t.shiftTypeId !== st.id);
              updateField(ep.id, "shiftMinimumTargets", newTarget ? [...others, newTarget] : others);
            }}
            onOverrideChange={(newOverride) => {
              const others = ep.shiftOverrides.filter((o) => o.shiftTypeId !== st.id);
              updateField(ep.id, "shiftOverrides", newOverride ? [...others, newOverride] : others);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="py-2.5">
      <div className="text-sm text-slate-200 mb-1">Auto-schedule these shifts</div>
      <div className="text-xs text-slate-500 mb-2">Toggle shifts to auto-schedule. Click ▸ to add rules or minimums.</div>
      <div className="space-y-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">Work</div>
          <div className="space-y-1.5">{workShifts.map(renderShiftButton)}</div>
        </div>
        {leaveShifts.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">Leave</div>
            <div className="space-y-1.5">{leaveShifts.map(renderShiftButton)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function StandingCommitmentsEditor({
  commitments,
  allShiftTypes,
  onChange,
}: {
  commitments: StandingCommitmentData[];
  allShiftTypes: ShiftTypeInfo[];
  onChange: (next: StandingCommitmentData[]) => void;
}) {
  const schedulableShifts = allShiftTypes.filter((st) => st.autoSchedulable);

  function update(idx: number, patch: Partial<StandingCommitmentData>) {
    onChange(commitments.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function remove(idx: number) {
    onChange(commitments.filter((_, i) => i !== idx));
  }
  function add() {
    const first = schedulableShifts[0];
    if (!first) return;
    // Default: any-day weekly (the common "standing days" shape).
    onChange([
      ...commitments,
      {
        shiftTypeId: first.id,
        notes: "",
        whenKind: "every",
        whenDays: [],
        whenPpWeek: null,
        whenOrds: [],
        whenCycleUnit: null,
        whenCycleN: null,
        whenCycleOffset: null,
      },
    ]);
  }

  return (
    <div className="space-y-2">
      {commitments.length === 0 && (
        <div className="text-xs text-slate-600 italic">
          None. The auto-scheduler pre-assigns standing commitments before filling other shifts.
        </div>
      )}
      <div className="space-y-1.5">
        {commitments.map((c, idx) => {
          const code = schedulableShifts.find((s) => s.id === c.shiftTypeId)?.code ?? "?";
          return (
            <div key={idx} className="bg-slate-700/30 border border-slate-600/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                <span className="text-slate-400">Always work</span>
                <select
                  className="bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-xs font-medium text-blue-300"
                  value={c.shiftTypeId}
                  onChange={(e) => update(idx, { shiftTypeId: e.target.value })}
                >
                  {schedulableShifts.map((st) => (
                    <option key={st.id} value={st.id}>{st.code}</option>
                  ))}
                </select>
                <button
                  onClick={() => remove(idx)}
                  className="text-slate-600 hover:text-red-400 ml-auto transition-colors"
                  title="Remove commitment"
                >
                  ×
                </button>
              </div>
              <RecurrencePicker
                allowAnyDay
                value={standingToWhen(c)}
                onChange={(w) => update(idx, { ...whenToColumns(w) })}
              />
              <input
                type="text"
                value={c.notes ?? ""}
                onChange={(e) => update(idx, { notes: e.target.value })}
                placeholder="Notes (optional)"
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 placeholder:text-slate-600"
              />
              <div className="text-[10px] text-slate-500 italic border-t border-slate-600/30 pt-1.5 mt-1">
                Pre-assigns {code}: {describeWhen(standingToWhen(c))}.
              </div>
            </div>
          );
        })}
      </div>
      <button
        onClick={add}
        disabled={schedulableShifts.length === 0}
        className="mt-1 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded transition-colors text-slate-300 disabled:opacity-40"
      >
        + Add commitment
      </button>
    </div>
  );
}

export function StaffPage({ canEdit, staff: initial, employmentTypes, allShiftTypes }: Props) {
  const [staff, setStaff] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function pushUndo(action: UndoAction) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setUndo(action);
    timerRef.current = setTimeout(() => setUndo(null), 8000);
  }

  async function executeUndo() {
    if (!undo) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const action = undo;
    setUndo(null);
    await action.execute();
  }

  function dismissUndo() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setUndo(null);
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const editingStaff = editingId ? staff.find((p) => p.id === editingId) ?? null : null;

  function updateField(id: string, field: keyof Staff, value: unknown) {
    setStaff((prev) => prev.map((p) => p.id === id ? { ...p, [field]: value } : p));
  }

  function changeEmploymentType(id: string, newTypeId: string) {
    const et = employmentTypes.find((t) => t.id === newTypeId);
    if (!et) return;
    setStaff((prev) => prev.map((p) => p.id === id ? {
      ...p,
      employmentTypeId: et.id,
      employmentTypeName: et.name,
      isAutoScheduled: et.defaultIsAutoScheduled,
      ftePercentage: et.defaultFtePercentage,
      eligibleShiftTypeIds: et.defaultEligibleShiftTypeIds,
      availabilityRules: et.defaultAvailabilityRules.map((r) => ({
        type: r.type,
        strength: r.strength,
        whenKind: r.whenKind,
        whenDays: r.whenDays,
        whenPpWeek: r.whenPpWeek,
        whenOrds: r.whenOrds,
        whenCycleUnit: r.whenCycleUnit,
        whenCycleN: r.whenCycleN,
        whenCycleOffset: r.whenCycleOffset,
      })),
    } : p));
  }

  const cancelEdit = useCallback(() => {
    if (!editingId) return;
    const orig = initial.find((p) => p.id === editingId);
    if (orig) setStaff((prev) => prev.map((p) => p.id === editingId ? orig : p));
    setEditingId(null);
  }, [editingId, initial]);
  useEscape(cancelEdit);

  async function saveStaff(member: Staff) {
    const prev = initial.find((p) => p.id === member.id) ?? staff.find((p) => p.id === member.id);
    setSaving(true);
    try {
      const res = await fetch("/api/staff", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(member),
      });
      if (!res.ok) {
        if (prev) setStaff((cur) => cur.map((p) => p.id === member.id ? prev : p));
        return;
      }
      setEditingId(null);
      if (prev) {
        pushUndo({
          label: `Updated ${member.initials}`,
          execute: async () => {
            await fetch("/api/staff", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(prev),
            });
            setStaff((cur) => cur.map((p) => p.id === prev.id ? prev : p));
          },
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteStaff(id: string) {
    const member = staff.find((p) => p.id === id);
    if (!member) return;
    if (!confirm(`Remove ${member.initials}? If they have assignments, they'll be deactivated instead.`)) return;

    setSaving(true);
    try {
      const res = await fetch("/api/staff", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) return;
      const result = await res.json();
      if (result.deactivated) {
        setStaff((prev) => prev.map((p) => p.id === id ? { ...p, isActive: false } : p));
      } else {
        setStaff((prev) => prev.filter((p) => p.id !== id));
      }
      setEditingId(null);

      pushUndo({
        label: result.deactivated ? `Deactivated ${member.initials}` : `Removed ${member.initials}`,
        execute: async () => {
          if (result.deactivated) {
            await fetch("/api/staff", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...member, isActive: true }),
            });
            setStaff((cur) => cur.map((p) => p.id === id ? { ...p, isActive: true } : p));
          } else {
            const res = await fetch("/api/staff", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(member),
            });
            const created = await res.json();
            setStaff((cur) => [...cur, { ...member, id: created.id }].sort((a, b) => a.sortOrder - b.sortOrder));
          }
        },
      });
    } finally {
      setSaving(false);
    }
  }

  async function addStaff() {
    setSaving(true);
    try {
      const defaultType = employmentTypes[0];
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Staff", initials: "NEW", employmentTypeId: defaultType?.id }),
      });
      if (!res.ok) return;
      const created = await res.json();
      const newProv: Staff = {
        id: created.id,
        name: created.name,
        loginStatus: "needs_setup", // POST auto-provisions a fresh disabled shell
        initials: created.initials,
        employmentTypeId: created.employmentTypeId,
        employmentTypeName: created.employmentType?.name ?? defaultType?.name ?? "",
        ftePercentage: created.ftePercentage ?? 1.0,
        availabilityRules: (created.availabilityRules ?? []).map((ar: AvailabilityRule) => ({
          type: ar.type,
          strength: ar.strength,
          conditionStaffId: ar.conditionStaffId,
          conditionType: ar.conditionType,
          whenKind: ar.whenKind,
          whenDays: ar.whenDays,
          whenPpWeek: ar.whenPpWeek,
          whenOrds: ar.whenOrds,
          whenCycleUnit: ar.whenCycleUnit,
          whenCycleN: ar.whenCycleN,
          whenCycleOffset: ar.whenCycleOffset,
        })),
        eligibleShiftTypeIds: (created.eligibleShifts ?? []).map((es: { shiftTypeId: string }) => es.shiftTypeId),
        shiftEligibilityRules: [],
        shiftMinimumTargets: [],
        standingCommitments: [],
        shiftOverrides: [],
        specialQualifications: created.specialQualifications ?? [],
        isActive: created.isActive,
        isAutoScheduled: created.isAutoScheduled ?? true,
        sortOrder: created.sortOrder,
      };
      setStaff((prev) => [...prev, newProv]);
      setEditingId(created.id);

      pushUndo({
        label: "Added new staff member",
        execute: async () => {
          await fetch("/api/staff", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: created.id }),
          });
          setStaff((cur) => cur.filter((p) => p.id !== created.id));
        },
      });
    } finally {
      setSaving(false);
    }
  }

  type SortKey = "sortOrder" | "initials" | "name" | "employmentTypeName" | "ftePercentage" | "isAutoScheduled";
  const [sortBy, setSortBy] = useState<SortKey>("sortOrder");
  const [sortAsc, setSortAsc] = useState(true);

  function toggleSort(key: SortKey) {
    if (sortBy === key) { setSortAsc(!sortAsc); }
    else { setSortBy(key); setSortAsc(true); }
  }

  function sortIndicator(key: SortKey) {
    return sortBy === key ? (sortAsc ? " ▲" : " ▼") : "";
  }

  function sorted(list: Staff[]) {
    return [...list].sort((a, b) => {
      if (sortBy === "ftePercentage") {
        if (a.isAutoScheduled !== b.isAutoScheduled) {
          return a.isAutoScheduled ? -1 : 1;
        }
      }
      const va = a[sortBy] ?? "";
      const vb = b[sortBy] ?? "";
      let cmp: number;
      if (typeof va === "boolean") {
        cmp = (va === vb ? 0 : va ? -1 : 1);
      } else if (typeof va === "string") {
        cmp = va.localeCompare(vb as string);
      } else {
        cmp = (va as number) - (vb as number);
      }
      if (cmp !== 0) return sortAsc ? cmp : -cmp;
      if (sortBy !== "initials" && sortBy !== "sortOrder") {
        return a.initials.localeCompare(b.initials);
      }
      return 0;
    });
  }

  const activeStaff = sorted(staff.filter((p) => p.isActive));
  const inactiveStaff = sorted(staff.filter((p) => !p.isActive));
  const scheduledCount = activeStaff.filter((p) => p.isAutoScheduled).length;
  const unscheduledCount = activeStaff.filter((p) => !p.isAutoScheduled).length;

  const ep = editingStaff;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Staff Directory</h2>
            <p className="text-sm text-slate-400">
              {activeStaff.length} active ({scheduledCount} auto-scheduled, {unscheduledCount} manual)
              {inactiveStaff.length > 0 && `, ${inactiveStaff.length} inactive`}
            </p>
          </div>
          <div className="flex gap-2">
            {inactiveStaff.length > 0 && (
              <button
                onClick={() => setShowInactive(!showInactive)}
                className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300"
              >
                {showInactive ? "Hide" : "Show"} inactive ({inactiveStaff.length})
              </button>
            )}
            {canEdit && (
              <button
                onClick={addStaff}
                disabled={saving}
                className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 rounded transition-colors font-medium"
              >
                + Add Staff
              </button>
            )}
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 uppercase tracking-wider bg-slate-800">
                  <th className="text-left py-2.5 px-3 w-16 cursor-pointer hover:text-slate-200 transition-colors select-none" onClick={() => toggleSort("initials")}>
                    ID{sortIndicator("initials")}
                  </th>
                  <th className="text-left py-2.5 px-3 cursor-pointer hover:text-slate-200 transition-colors select-none" onClick={() => toggleSort("name")}>
                    Name{sortIndicator("name")}
                  </th>
                  <th className="text-center py-2.5 px-3 w-20 cursor-pointer hover:text-slate-200 transition-colors select-none" onClick={() => toggleSort("employmentTypeName")}>
                    Type{sortIndicator("employmentTypeName")}
                  </th>
                  <th className="text-center py-2.5 px-3 w-14 cursor-pointer hover:text-slate-200 transition-colors select-none" onClick={() => toggleSort("ftePercentage")}>
                    FTE{sortIndicator("ftePercentage")}
                  </th>
                  <th className="text-center py-2.5 px-3 w-40">Availability</th>
                  <th className="text-center py-2.5 px-3 w-14 cursor-pointer hover:text-slate-200 transition-colors select-none" onClick={() => toggleSort("isAutoScheduled")}>
                    Auto{sortIndicator("isAutoScheduled")}
                  </th>
                  <th className="text-center py-2.5 px-3 w-36">Login</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {activeStaff.map((p) => {
                  const hasAdv = p.availabilityRules.some((r) => !isPlainRule(r));
                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-slate-800/50 transition-colors ${canEdit ? "cursor-pointer" : ""}`}
                      onClick={() => canEdit && setEditingId(p.id)}
                    >
                      <td className="py-2 px-3">
                        <span className={`font-mono font-bold ${!p.isAutoScheduled ? "text-amber-400" : "text-slate-200"}`}>
                          {p.initials}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-sm text-slate-300">{p.name}</span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`text-xs ${p.isAutoScheduled ? "text-slate-400" : "text-amber-400"}`}>
                          {p.employmentTypeName}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className="text-xs text-slate-400 font-mono">
                          {!p.isAutoScheduled || p.employmentTypeName !== "FTE" ? "—" : p.ftePercentage % 1 === 0 ? p.ftePercentage.toFixed(1) : String(p.ftePercentage)}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex gap-0.5 justify-center items-center">
                          {DAY_INDICES.map((d) => {
                            const active = hasBaseRule(p.availabilityRules, d);
                            const adv = hasAdvancedRule(p.availabilityRules, d);
                            return (
                              <span
                                key={d}
                                className={[
                                  "w-5 h-5 text-[10px] rounded font-medium flex items-center justify-center relative",
                                  active ? "bg-blue-600/40 text-blue-300" : "bg-slate-700/50 text-slate-600",
                                ].join(" ")}
                              >
                                {DAY_SHORT[d]}
                                {adv && (
                                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
                                )}
                              </span>
                            );
                          })}
                          {hasAdv && <span className="text-[9px] text-amber-400 ml-1">*</span>}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={p.isAutoScheduled ? "text-emerald-400" : "text-slate-600"}>
                          {p.isAutoScheduled ? "✓" : "—"}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <LoginStatusBadge status={p.loginStatus} />
                      </td>
                    </tr>
                  );
                })}
                {showInactive && inactiveStaff.map((p) => (
                  <tr
                    key={p.id}
                    className={`hover:bg-slate-800/50 transition-colors opacity-50 ${canEdit ? "cursor-pointer" : ""}`}
                    onClick={() => canEdit && setEditingId(p.id)}
                  >
                    <td className="py-2 px-3"><span className="font-mono font-bold text-slate-500">{p.initials}</span></td>
                    <td className="py-2 px-3"><span className="text-sm text-slate-500">{p.name}</span></td>
                    <td className="py-2 px-3 text-center"><span className="text-xs text-slate-600">{p.employmentTypeName}</span></td>
                    <td className="py-2 px-3 text-center"><span className="text-xs text-slate-600">—</span></td>
                    <td className="py-2 px-3"><div className="flex gap-0.5 justify-center">{DAY_INDICES.map((d) => (<span key={d} className="w-5 h-5 text-[10px] rounded font-medium flex items-center justify-center bg-slate-700/30 text-slate-700">{DAY_SHORT[d]}</span>))}</div></td>
                    <td className="py-2 px-3 text-center text-slate-600">—</td>
                    <td className="py-2 px-3 text-center"><LoginStatusBadge status={p.loginStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 px-1">
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="text-slate-200 font-mono font-bold">AB</span> Auto-scheduled
            </span>
            <span className="flex items-center gap-1">
              <span className="text-amber-400 font-mono font-bold">AB</span> Manual only
            </span>
            <span className="text-slate-600">|</span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" /> Advanced rules
            </span>
            {canEdit && <>
              <span className="text-slate-600">|</span>
              <span>Click row to edit</span>
            </>}
          </div>
        </div>
      </div>

      {ep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => cancelEdit()}>
          <div
            className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <div className="flex items-center gap-3">
                <span className={`font-mono font-bold text-lg ${!ep.isAutoScheduled ? "text-amber-400" : "text-slate-200"}`}>{ep.initials}</span>
                <span className="text-slate-400">{ep.name}</span>
              </div>
              <button onClick={cancelEdit} className="text-slate-500 hover:text-slate-300 text-lg">×</button>
            </div>

            <div className="px-6 py-4">
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Identity</div>
              <FieldRow label="Initials" description="Short code shown on the schedule grid">
                <input className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm font-mono text-center" value={ep.initials} onChange={(e) => updateField(ep.id, "initials", e.target.value)} />
              </FieldRow>
              <FieldRow label="Full name">
                <input className="w-56 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm" value={ep.name} onChange={(e) => updateField(ep.id, "name", e.target.value)} />
              </FieldRow>
              <FieldRow label="Employment type" description="Changing type applies its default scheduling values">
                <select
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
                  value={ep.employmentTypeId}
                  onChange={(e) => changeEmploymentType(ep.id, e.target.value)}
                >
                  {employmentTypes.map((et) => (
                    <option key={et.id} value={et.id}>{et.name}</option>
                  ))}
                </select>
              </FieldRow>
              {ep.isAutoScheduled && ep.employmentTypeName === "FTE" && (
                <FieldRow label="FTE" description="Target hours = FTE x pay period hours">
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    max="9.999"
                    className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm font-mono"
                    value={ep.ftePercentage}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v >= 0 && v <= 9.999) updateField(ep.id, "ftePercentage", Math.round(v * 1000) / 1000);
                    }}
                  />
                </FieldRow>
              )}
              <FieldRow label="Active" description="Inactive staff are hidden from the schedule">
                <input type="checkbox" checked={ep.isActive} onChange={(e) => updateField(ep.id, "isActive", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
              <FieldRow label="Auto-schedule" description="Include this person in the auto-scheduler">
                <input type="checkbox" checked={ep.isAutoScheduled} onChange={(e) => updateField(ep.id, "isAutoScheduled", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
            </div>

            <div className="px-6 py-4 border-t border-slate-700">
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Scheduling</div>
              <EligibleShiftsSection ep={ep} allShiftTypes={allShiftTypes} updateField={updateField} />
              <div className="py-2.5">
                <div className="text-sm text-slate-200 mb-2">Availability</div>
                <AvailabilityEditor
                  rules={ep.availabilityRules}
                  onChange={(rules) => updateField(ep.id, "availabilityRules", rules)}
                  allStaff={staff.filter((p) => p.isActive).map((p) => ({ id: p.id, initials: p.initials }))}
                  currentStaffId={ep.id}
                />
              </div>
              <div className="py-2.5">
                <div className="text-sm text-slate-200 mb-2">Standing commitments</div>
                <StandingCommitmentsEditor
                  commitments={ep.standingCommitments}
                  allShiftTypes={allShiftTypes}
                  onChange={(next) => updateField(ep.id, "standingCommitments", next)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700">
              {canEdit && (
                <button
                  onClick={() => deleteStaff(ep.id)}
                  className="px-3 py-1.5 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-400 border border-red-800/50 rounded transition-colors"
                >
                  Delete
                </button>
              )}
              <div className="flex gap-2">
                <button
                  onClick={cancelEdit}
                  className="px-4 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  {canEdit ? "Cancel" : "Close"}
                </button>
                {canEdit && (
                  <button
                    onClick={() => saveStaff(ep)}
                    disabled={saving}
                    className="px-4 py-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors font-medium"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {undo && <UndoToast action={undo} onUndo={executeUndo} onDismiss={dismissUndo} />}
    </div>
  );
}
