"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AvailabilityRule = {
  dayOfWeek: number;
  type: string;
  strength: string;
  pattern: string;
  cycleLength?: number | null;
  cycleOffset?: number | null;
  conditionProviderId?: string | null;
  conditionType?: string | null;
};

type Provider = {
  id: string;
  name: string;
  initials: string;
  employmentTypeId: string;
  employmentTypeName: string;
  ftePercentage: number;
  availabilityRules: AvailabilityRule[];
  eligibleShiftTypeIds: string[];
  specialQualifications: string[];
  isActive: boolean;
  isAutoScheduled: boolean;
  sortOrder: number;
};

type DefaultAvailabilityRule = {
  dayOfWeek: number;
  type: string;
  strength: string;
  pattern: string;
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
};

type Props = {
  providers: Provider[];
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

const PATTERN_LABELS: Record<string, string> = {
  every: "Every week",
  pp_week_1: "PP week 1",
  pp_week_2: "PP week 2",
  every_n: "Every Nth",
};

function hasBaseRule(rules: AvailabilityRule[], dayOfWeek: number): boolean {
  return rules.some((r) => r.dayOfWeek === dayOfWeek && r.type === "available");
}

function hasAdvancedRule(rules: AvailabilityRule[], dayOfWeek: number): boolean {
  return rules.some(
    (r) =>
      r.dayOfWeek === dayOfWeek &&
      (r.pattern !== "every" || r.strength !== "rule" || r.type !== "available" || r.conditionProviderId)
  );
}

function dayRuleSummary(rules: AvailabilityRule[], dayOfWeek: number): string {
  const dayRules = rules.filter((r) => r.dayOfWeek === dayOfWeek);
  if (dayRules.length === 0) return "";
  const parts: string[] = [];
  for (const r of dayRules) {
    if (r.type === "available" && r.strength === "rule" && r.pattern === "every" && !r.conditionProviderId) continue;
    let s = "";
    if (r.strength === "preference") s += r.type === "available" ? "Prefer" : "Avoid";
    else if (r.type === "unavailable") s += "Off";
    if (r.pattern !== "every") {
      if (s) s += " ";
      s += PATTERN_LABELS[r.pattern] ?? r.pattern;
      if (r.pattern === "every_n" && r.cycleLength) {
        s = `Every ${r.cycleLength === 2 ? "other" : r.cycleLength === 3 ? "3rd" : `${r.cycleLength}th`}`;
      }
    }
    if (r.conditionProviderId) s += " (cond.)";
    if (s) parts.push(s);
  }
  return parts.join(", ");
}

function UndoToast({ action, onUndo, onDismiss }: { action: UndoAction; onUndo: () => void; onDismiss: () => void }) {
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
  allProviders,
  currentProviderId,
}: {
  rules: AvailabilityRule[];
  onChange: (rules: AvailabilityRule[]) => void;
  allProviders: { id: string; initials: string }[];
  currentProviderId: string;
}) {
  const [expandedDay, setExpandedDay] = useState<number | null>(null);

  function toggleDay(d: number) {
    const existing = rules.filter((r) => r.dayOfWeek === d);
    if (existing.length > 0) {
      onChange(rules.filter((r) => r.dayOfWeek !== d));
      if (expandedDay === d) setExpandedDay(null);
    } else {
      onChange([...rules, { dayOfWeek: d, type: "available", strength: "rule", pattern: "every" }]);
    }
  }

  function updateRule(dayOfWeek: number, ruleIndex: number, updates: Partial<AvailabilityRule>) {
    const dayRules = rules.filter((r) => r.dayOfWeek === dayOfWeek);
    const otherRules = rules.filter((r) => r.dayOfWeek !== dayOfWeek);
    const updated = dayRules.map((r, i) => (i === ruleIndex ? { ...r, ...updates } : r));
    onChange([...otherRules, ...updated]);
  }

  function addRule(dayOfWeek: number) {
    onChange([...rules, { dayOfWeek, type: "available", strength: "preference", pattern: "every" }]);
  }

  function removeRule(dayOfWeek: number, ruleIndex: number) {
    const dayRules = rules.filter((r) => r.dayOfWeek === dayOfWeek);
    const otherRules = rules.filter((r) => r.dayOfWeek !== dayOfWeek);
    onChange([...otherRules, ...dayRules.filter((_, i) => i !== ruleIndex)]);
    if (dayRules.length <= 1 && expandedDay === dayOfWeek) setExpandedDay(null);
  }

  const otherProviders = allProviders.filter((p) => p.id !== currentProviderId);

  return (
    <div className="space-y-0.5">
      {DAY_INDICES.map((d) => {
        const active = hasBaseRule(rules, d);
        const advanced = hasAdvancedRule(rules, d);
        const isExpanded = expandedDay === d;
        const dayRules = rules.filter((r) => r.dayOfWeek === d);
        const summary = dayRuleSummary(rules, d);

        return (
          <div key={d}>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => toggleDay(d)}
                className={[
                  "w-10 h-8 text-xs rounded font-medium transition-colors",
                  active ? "bg-blue-600/50 text-blue-200 border border-blue-500/50" : "bg-slate-700 text-slate-500 border border-slate-600",
                  "hover:brightness-125",
                ].join(" ")}
              >
                {DAY_LABELS[d]}
              </button>
              {active && (
                <>
                  <span className="text-xs text-slate-500 flex-1 truncate">
                    {summary || "Every week"}
                  </span>
                  <button
                    onClick={() => setExpandedDay(isExpanded ? null : d)}
                    className={[
                      "w-6 h-6 flex items-center justify-center text-[10px] rounded transition-colors",
                      isExpanded ? "bg-blue-600/30 text-blue-300" : advanced ? "bg-amber-600/20 text-amber-400" : "bg-slate-700/50 text-slate-500 hover:text-slate-300",
                    ].join(" ")}
                    title="Edit availability rules"
                  >
                    {isExpanded ? "▲" : "▼"}
                  </button>
                </>
              )}
            </div>

            {isExpanded && (
              <div className="ml-12 mt-1 mb-2 space-y-1.5">
                {dayRules.map((rule, idx) => (
                  <div key={idx} className="bg-slate-700/30 border border-slate-600/50 rounded p-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <select
                        className="bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs"
                        value={rule.type}
                        onChange={(e) => updateRule(d, idx, { type: e.target.value })}
                      >
                        <option value="available">Available</option>
                        <option value="unavailable">Unavailable</option>
                      </select>
                      <select
                        className="bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs"
                        value={rule.strength}
                        onChange={(e) => updateRule(d, idx, { strength: e.target.value })}
                      >
                        <option value="rule">Rule (hard)</option>
                        <option value="preference">Preference (soft)</option>
                      </select>
                      <select
                        className="bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs"
                        value={rule.pattern}
                        onChange={(e) => updateRule(d, idx, { pattern: e.target.value })}
                      >
                        <option value="every">Every week</option>
                        <option value="pp_week_1">PP week 1</option>
                        <option value="pp_week_2">PP week 2</option>
                        <option value="every_n">Every Nth</option>
                      </select>
                      {dayRules.length > 1 && (
                        <button
                          onClick={() => removeRule(d, idx)}
                          className="text-slate-500 hover:text-red-400 text-xs ml-auto"
                        >
                          ×
                        </button>
                      )}
                    </div>

                    {rule.pattern === "every_n" && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500">Every</span>
                        <input
                          type="number"
                          min={2}
                          max={8}
                          className="w-12 bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-center"
                          value={rule.cycleLength ?? 2}
                          onChange={(e) => updateRule(d, idx, { cycleLength: parseInt(e.target.value) || 2 })}
                        />
                        <span className="text-[10px] text-slate-500">occurrences, starting at #</span>
                        <input
                          type="number"
                          min={0}
                          max={(rule.cycleLength ?? 2) - 1}
                          className="w-12 bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-center"
                          value={rule.cycleOffset ?? 0}
                          onChange={(e) => updateRule(d, idx, { cycleOffset: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500">Condition:</span>
                      <select
                        className="bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs flex-1"
                        value={rule.conditionProviderId ?? ""}
                        onChange={(e) => {
                          const pid = e.target.value || null;
                          updateRule(d, idx, {
                            conditionProviderId: pid,
                            conditionType: pid ? (rule.conditionType ?? "not_working") : null,
                          });
                        }}
                      >
                        <option value="">None</option>
                        {otherProviders.map((p) => (
                          <option key={p.id} value={p.id}>{p.initials}</option>
                        ))}
                      </select>
                      {rule.conditionProviderId && (
                        <select
                          className="bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs"
                          value={rule.conditionType ?? "not_working"}
                          onChange={(e) => updateRule(d, idx, { conditionType: e.target.value })}
                        >
                          <option value="not_working">is not working</option>
                          <option value="working">is working</option>
                        </select>
                      )}
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => addRule(d)}
                  className="text-[10px] text-slate-500 hover:text-blue-400 transition-colors"
                >
                  + Add rule for {DAY_LABELS[d]}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function StaffPage({ providers: initial, employmentTypes, allShiftTypes }: Props) {
  const [providers, setProviders] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [qualInput, setQualInput] = useState("");
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

  const editingProvider = editingId ? providers.find((p) => p.id === editingId) ?? null : null;

  function updateField(id: string, field: keyof Provider, value: unknown) {
    setProviders((prev) => prev.map((p) => p.id === id ? { ...p, [field]: value } : p));
  }

  function changeEmploymentType(id: string, newTypeId: string) {
    const et = employmentTypes.find((t) => t.id === newTypeId);
    if (!et) return;
    setProviders((prev) => prev.map((p) => p.id === id ? {
      ...p,
      employmentTypeId: et.id,
      employmentTypeName: et.name,
      isAutoScheduled: et.defaultIsAutoScheduled,
      ftePercentage: et.defaultFtePercentage,
      eligibleShiftTypeIds: et.defaultEligibleShiftTypeIds,
      availabilityRules: et.defaultAvailabilityRules.map((r) => ({
        dayOfWeek: r.dayOfWeek,
        type: r.type,
        strength: r.strength,
        pattern: r.pattern,
      })),
    } : p));
  }

  function cancelEdit() {
    if (!editingId) return;
    const orig = initial.find((p) => p.id === editingId);
    if (orig) setProviders((prev) => prev.map((p) => p.id === editingId ? orig : p));
    setEditingId(null);
    setQualInput("");
  }

  async function saveProvider(provider: Provider) {
    const prev = initial.find((p) => p.id === provider.id) ?? providers.find((p) => p.id === provider.id);
    setSaving(true);
    try {
      await fetch("/api/staff", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(provider),
      });
      setEditingId(null);
      setQualInput("");
      if (prev) {
        pushUndo({
          label: `Updated ${provider.initials}`,
          execute: async () => {
            await fetch("/api/staff", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(prev),
            });
            setProviders((cur) => cur.map((p) => p.id === prev.id ? prev : p));
          },
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteProvider(id: string) {
    const provider = providers.find((p) => p.id === id);
    if (!provider) return;
    if (!confirm(`Remove ${provider.initials}? If they have assignments, they'll be deactivated instead.`)) return;

    setSaving(true);
    try {
      const res = await fetch("/api/staff", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = await res.json();
      if (result.deactivated) {
        setProviders((prev) => prev.map((p) => p.id === id ? { ...p, isActive: false } : p));
      } else {
        setProviders((prev) => prev.filter((p) => p.id !== id));
      }
      setEditingId(null);

      pushUndo({
        label: result.deactivated ? `Deactivated ${provider.initials}` : `Removed ${provider.initials}`,
        execute: async () => {
          if (result.deactivated) {
            await fetch("/api/staff", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...provider, isActive: true }),
            });
            setProviders((cur) => cur.map((p) => p.id === id ? { ...p, isActive: true } : p));
          } else {
            const res = await fetch("/api/staff", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(provider),
            });
            const created = await res.json();
            setProviders((cur) => [...cur, { ...provider, id: created.id }].sort((a, b) => a.sortOrder - b.sortOrder));
          }
        },
      });
    } finally {
      setSaving(false);
    }
  }

  async function addProvider() {
    setSaving(true);
    try {
      const defaultType = employmentTypes[0];
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Provider", initials: "NEW", employmentTypeId: defaultType?.id }),
      });
      const created = await res.json();
      const newProv: Provider = {
        id: created.id,
        name: created.name,
        initials: created.initials,
        employmentTypeId: created.employmentTypeId,
        employmentTypeName: created.employmentType?.name ?? defaultType?.name ?? "",
        ftePercentage: created.ftePercentage ?? 1.0,
        availabilityRules: (created.availabilityRules ?? []).map((ar: AvailabilityRule) => ({
          dayOfWeek: ar.dayOfWeek,
          type: ar.type,
          strength: ar.strength,
          pattern: ar.pattern,
          cycleLength: ar.cycleLength,
          cycleOffset: ar.cycleOffset,
          conditionProviderId: ar.conditionProviderId,
          conditionType: ar.conditionType,
        })),
        eligibleShiftTypeIds: (created.eligibleShifts ?? []).map((es: { shiftTypeId: string }) => es.shiftTypeId),
        specialQualifications: created.specialQualifications ?? [],
        isActive: created.isActive,
        isAutoScheduled: created.isAutoScheduled ?? true,
        sortOrder: created.sortOrder,
      };
      setProviders((prev) => [...prev, newProv]);
      setEditingId(created.id);

      pushUndo({
        label: "Added new staff member",
        execute: async () => {
          await fetch("/api/staff", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: created.id }),
          });
          setProviders((cur) => cur.filter((p) => p.id !== created.id));
        },
      });
    } finally {
      setSaving(false);
    }
  }

  type SortKey = "sortOrder" | "initials" | "name";
  const [sortBy, setSortBy] = useState<SortKey>("sortOrder");
  const [sortAsc, setSortAsc] = useState(true);

  function toggleSort(key: SortKey) {
    if (sortBy === key) { setSortAsc(!sortAsc); }
    else { setSortBy(key); setSortAsc(true); }
  }

  function sorted(list: Provider[]) {
    return [...list].sort((a, b) => {
      const va = a[sortBy] ?? "";
      const vb = b[sortBy] ?? "";
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortAsc ? cmp : -cmp;
    });
  }

  const activeProviders = sorted(providers.filter((p) => p.isActive));
  const inactiveProviders = sorted(providers.filter((p) => !p.isActive));
  const scheduledCount = activeProviders.filter((p) => p.isAutoScheduled).length;
  const unscheduledCount = activeProviders.filter((p) => !p.isAutoScheduled).length;

  const ep = editingProvider;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Staff Directory</h2>
            <p className="text-sm text-slate-400">
              {activeProviders.length} active ({scheduledCount} auto-scheduled, {unscheduledCount} manual)
              {inactiveProviders.length > 0 && `, ${inactiveProviders.length} inactive`}
            </p>
          </div>
          <div className="flex gap-2">
            {inactiveProviders.length > 0 && (
              <button
                onClick={() => setShowInactive(!showInactive)}
                className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300"
              >
                {showInactive ? "Hide" : "Show"} inactive ({inactiveProviders.length})
              </button>
            )}
            <button
              onClick={addProvider}
              disabled={saving}
              className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 rounded transition-colors font-medium"
            >
              + Add Staff
            </button>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 uppercase tracking-wider bg-slate-800">
                  <th className="text-left py-2.5 px-3 w-16 cursor-pointer hover:text-slate-200 transition-colors select-none" onClick={() => toggleSort("initials")}>
                    ID {sortBy === "initials" ? (sortAsc ? "▲" : "▼") : ""}
                  </th>
                  <th className="text-left py-2.5 px-3 cursor-pointer hover:text-slate-200 transition-colors select-none" onClick={() => toggleSort("name")}>
                    Name {sortBy === "name" ? (sortAsc ? "▲" : "▼") : ""}
                  </th>
                  <th className="text-center py-2.5 px-3 w-20">Type</th>
                  <th className="text-center py-2.5 px-3 w-14">FTE</th>
                  <th className="text-center py-2.5 px-3 w-40">Availability</th>
                  <th className="text-left py-2.5 px-3">Ineligible</th>
                  <th className="text-center py-2.5 px-3 w-12">Sched</th>
                  <th className="text-center py-2.5 px-3 w-20">Quals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {activeProviders.map((p) => {
                  const hasAdv = p.availabilityRules.some(
                    (r) => r.pattern !== "every" || r.strength !== "rule" || r.type !== "available" || r.conditionProviderId
                  );
                  return (
                    <tr
                      key={p.id}
                      className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                      onClick={() => setEditingId(p.id)}
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
                          {!p.isAutoScheduled ? "—" : `${(p.ftePercentage * 100).toFixed(0)}%`}
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
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {allShiftTypes
                            .filter((st) => !p.eligibleShiftTypeIds.includes(st.id))
                            .map((st) => (
                              <span key={st.id} className="text-[10px] px-1.5 py-px rounded bg-slate-700/50 text-slate-500">
                                {st.code}
                              </span>
                            ))}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={p.isAutoScheduled ? "text-emerald-400" : "text-slate-600"}>
                          {p.isAutoScheduled ? "✓" : "—"}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        {p.specialQualifications.length > 0 ? (
                          <span className="text-xs text-slate-400">{p.specialQualifications.length}</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {showInactive && inactiveProviders.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-800/50 cursor-pointer transition-colors opacity-50"
                    onClick={() => setEditingId(p.id)}
                  >
                    <td className="py-2 px-3"><span className="font-mono font-bold text-slate-500">{p.initials}</span></td>
                    <td className="py-2 px-3"><span className="text-sm text-slate-500">{p.name}</span></td>
                    <td className="py-2 px-3 text-center"><span className="text-xs text-slate-600">{p.employmentTypeName}</span></td>
                    <td className="py-2 px-3 text-center"><span className="text-xs text-slate-600">—</span></td>
                    <td className="py-2 px-3"><div className="flex gap-0.5 justify-center">{DAY_INDICES.map((d) => (<span key={d} className="w-5 h-5 text-[10px] rounded font-medium flex items-center justify-center bg-slate-700/30 text-slate-700">{DAY_SHORT[d]}</span>))}</div></td>
                    <td className="py-2 px-3 text-center text-slate-600">—</td>
                    <td className="py-2 px-3 text-center text-slate-600">—</td>
                    <td className="py-2 px-3 text-center text-slate-600">—</td>
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
            <span className="text-slate-600">|</span>
            <span>Click row to edit</span>
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
              <FieldRow label="FTE percentage" description="Target hours = FTE% x pay period hours">
                <select className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm" value={ep.ftePercentage} onChange={(e) => updateField(ep.id, "ftePercentage", parseFloat(e.target.value))}>
                  {[1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1].map((v) => (
                    <option key={v} value={v}>{(v * 100).toFixed(0)}%</option>
                  ))}
                </select>
              </FieldRow>
              <FieldRow label="Active" description="Inactive staff are hidden from the schedule">
                <input type="checkbox" checked={ep.isActive} onChange={(e) => updateField(ep.id, "isActive", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
              <FieldRow label="Auto-schedule" description="Include this person in the auto-scheduler">
                <input type="checkbox" checked={ep.isAutoScheduled} onChange={(e) => updateField(ep.id, "isAutoScheduled", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
            </div>

            <div className="px-6 py-4 border-t border-slate-700">
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Scheduling</div>
              <div className="py-2.5">
                <div className="text-sm text-slate-200 mb-1">Eligible shifts</div>
                <div className="text-xs text-slate-500 mb-2">Toggle which shift types this person can work.</div>
                {(() => {
                  const workShifts = allShiftTypes.filter((st) => !st.isLeave);
                  const leaveShifts = allShiftTypes.filter((st) => st.isLeave);
                  return (
                    <div className="space-y-2">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">Work</div>
                        <div className="flex flex-wrap gap-1">
                          {workShifts.map((st) => {
                            const isEligible = ep.eligibleShiftTypeIds.includes(st.id);
                            return (
                              <button
                                key={st.id}
                                onClick={() => {
                                  const next = isEligible
                                    ? ep.eligibleShiftTypeIds.filter((id) => id !== st.id)
                                    : [...ep.eligibleShiftTypeIds, st.id];
                                  updateField(ep.id, "eligibleShiftTypeIds", next);
                                }}
                                className={`px-2 py-0.5 text-xs font-bold rounded transition-colors border ${
                                  isEligible ? "" : "opacity-30"
                                }`}
                                style={{
                                  backgroundColor: isEligible ? st.color + "25" : undefined,
                                  color: st.color,
                                  borderColor: isEligible ? st.color + "50" : "transparent",
                                }}
                                title={st.name}
                              >
                                {st.code}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {leaveShifts.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">Leave</div>
                          <div className="flex flex-wrap gap-1">
                            {leaveShifts.map((st) => {
                              const isEligible = ep.eligibleShiftTypeIds.includes(st.id);
                              return (
                                <button
                                  key={st.id}
                                  onClick={() => {
                                    const next = isEligible
                                      ? ep.eligibleShiftTypeIds.filter((id) => id !== st.id)
                                      : [...ep.eligibleShiftTypeIds, st.id];
                                    updateField(ep.id, "eligibleShiftTypeIds", next);
                                  }}
                                  className={`px-2 py-0.5 text-xs font-bold rounded transition-colors border ${
                                    isEligible ? "" : "opacity-30"
                                  }`}
                                  style={{
                                    backgroundColor: isEligible ? st.color + "25" : undefined,
                                    color: st.color,
                                    borderColor: isEligible ? st.color + "50" : "transparent",
                                  }}
                                  title={st.name}
                                >
                                  {st.code}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="py-2.5">
                <div className="text-sm text-slate-200 mb-1">Availability</div>
                <div className="text-xs text-slate-500 mb-2">Toggle days, then expand with ▼ for patterns, preferences, and conditions.</div>
                <AvailabilityEditor
                  rules={ep.availabilityRules}
                  onChange={(rules) => updateField(ep.id, "availabilityRules", rules)}
                  allProviders={providers.filter((p) => p.isActive).map((p) => ({ id: p.id, initials: p.initials }))}
                  currentProviderId={ep.id}
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-700">
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Qualifications</div>
              <p className="text-xs text-slate-500 mb-3">Tags that determine eligibility for shift types with custom eligibility rules.</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {ep.specialQualifications.map((q) => (
                  <span key={q} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-700 border border-slate-600 rounded text-xs text-slate-300">
                    {q}
                    <button
                      onClick={() => updateField(ep.id, "specialQualifications", ep.specialQualifications.filter((x) => x !== q))}
                      className="text-slate-500 hover:text-red-400 ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {ep.specialQualifications.length === 0 && (
                  <span className="text-xs text-slate-600">No qualifications</span>
                )}
              </div>
              <div className="flex gap-1">
                <input
                  type="text"
                  className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
                  placeholder="Add qualification..."
                  value={qualInput}
                  onChange={(e) => setQualInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && qualInput.trim()) {
                      const q = qualInput.trim().toLowerCase();
                      if (!ep.specialQualifications.includes(q)) {
                        updateField(ep.id, "specialQualifications", [...ep.specialQualifications, q]);
                      }
                      setQualInput("");
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (qualInput.trim()) {
                      const q = qualInput.trim().toLowerCase();
                      if (!ep.specialQualifications.includes(q)) {
                        updateField(ep.id, "specialQualifications", [...ep.specialQualifications, q]);
                      }
                      setQualInput("");
                    }
                  }}
                  className="px-3 py-1 text-xs bg-slate-600 hover:bg-slate-500 rounded transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700">
              <button
                onClick={() => deleteProvider(ep.id)}
                className="px-3 py-1.5 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-400 border border-red-800/50 rounded transition-colors"
              >
                Delete
              </button>
              <div className="flex gap-2">
                <button
                  onClick={cancelEdit}
                  className="px-4 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => saveProvider(ep)}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors font-medium"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {undo && <UndoToast action={undo} onUndo={executeUndo} onDismiss={dismissUndo} />}
    </div>
  );
}
