"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

type ShiftType = {
  id: string;
  code: string;
  name: string;
  defaultHours: number;
  countsTowardFte: boolean;
  countsOnWeekend: boolean;
  isLeave: boolean;
  isPaid: boolean;
  category: string;
  postShiftRule: string | null;
  color: string;
  sortOrder: number;
  schedulePriority: number | null;
  isOffShift: boolean;
  isFillShift: boolean;
  weekendPaired: boolean;
  ignoresWorkingDays: boolean;
  eligibilityRule: string | null;
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

type FteTarget = {
  id: string;
  ftePercentage: number;
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
};

type Props = {
  shiftTypes: ShiftType[];
  staffingReqs: StaffingReq[];
  payPeriods: PayPeriod[];
  fteTargets: FteTarget[];
  holidays: Holiday[];
  desirabilityWeights: DesirabilityWeight[];
  schedulingPrefs: SchedulingPrefs;
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

function ShiftTypesSection({ initial, pushUndo }: { initial: ShiftType[]; pushUndo: (a: UndoAction) => void }) {
  const [shifts, setShifts] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

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
        countsTowardFte: created.countsTowardFte,
        countsOnWeekend: created.countsOnWeekend,
        isLeave: created.isLeave,
        isPaid: created.isPaid,
        category: created.category,
        postShiftRule: created.postShiftRule,
        color: created.color ?? "#6b7280",
        sortOrder: created.sortOrder,
        schedulePriority: created.schedulePriority ?? null,
        isOffShift: created.isOffShift ?? false,
        isFillShift: created.isFillShift ?? false,
        weekendPaired: created.weekendPaired ?? false,
        ignoresWorkingDays: created.ignoresWorkingDays ?? false,
        eligibilityRule: created.eligibilityRule ?? null,
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

  function cancelEdit() {
    if (!editingId) return;
    const orig = initial.find((s) => s.id === editingId);
    if (orig) setShifts((prev) => prev.map((s) => s.id === editingId ? orig : s));
    setEditingId(null);
  }

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
              <th className="text-left py-2 px-2 w-16">Code</th>
              <th className="text-left py-2 px-2">Name</th>
              <th className="text-center py-2 px-2 w-16">Hours</th>
              <th className="text-center py-2 px-2 w-14">Wknd</th>
              <th className="text-center py-2 px-2 w-20">Category</th>
              <th className="text-center py-2 px-2 w-12">Color</th>
              <th className="text-center py-2 px-2 w-14">Leave</th>
              <th className="text-center py-2 px-2 w-24">Post-shift</th>
              <th className="text-center py-2 px-2 w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {shifts.map((st) => {
              const isEditing = editingId === st.id;
              return (
                <Fragment key={st.id}>
                <tr
                  className={[
                    "hover:bg-slate-700/30 transition-colors",
                    isEditing ? "bg-slate-700/20" : "",
                  ].join(" ")}
                  onClick={() => !isEditing && setEditingId(st.id)}
                >
                  <td className="py-2 px-2">
                    {isEditing ? (
                      <input
                        className="w-14 bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs font-mono"
                        value={st.code}
                        onChange={(e) => updateField(st.id, "code", e.target.value.toUpperCase())}
                      />
                    ) : (
                      <span className="font-mono font-bold" style={{ color: st.color }}>{st.code}</span>
                    )}
                  </td>
                  <td className="py-2 px-2">
                    {isEditing ? (
                      <input
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-xs"
                        value={st.name}
                        onChange={(e) => updateField(st.id, "name", e.target.value)}
                      />
                    ) : (
                      <span className="text-slate-300">{st.name}</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {isEditing ? (
                      <input
                        type="number"
                        className="w-14 bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-center"
                        value={st.defaultHours}
                        onChange={(e) => updateField(st.id, "defaultHours", parseFloat(e.target.value) || 0)}
                      />
                    ) : (
                      <span className="text-slate-300 font-mono">{st.defaultHours}</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <input
                      type="checkbox"
                      checked={st.countsOnWeekend}
                      disabled={!isEditing}
                      onChange={(e) => updateField(st.id, "countsOnWeekend", e.target.checked)}
                      className="rounded border-slate-600"
                    />
                  </td>
                  <td className="py-2 px-2 text-center">
                    {isEditing ? (
                      <select
                        className="bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-xs"
                        value={st.category}
                        onChange={(e) => updateField(st.id, "category", e.target.value)}
                      >
                        <option value="work">work</option>
                        <option value="leave">leave</option>
                        <option value="other">other</option>
                      </select>
                    ) : (
                      <span className="text-xs text-slate-400">{st.category}</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {isEditing ? (
                      <input
                        type="color"
                        className="w-6 h-6 rounded cursor-pointer border-0"
                        value={st.color}
                        onChange={(e) => updateField(st.id, "color", e.target.value)}
                      />
                    ) : (
                      <span className="inline-block w-4 h-4 rounded" style={{ backgroundColor: st.color }} />
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <input
                      type="checkbox"
                      checked={st.isLeave}
                      disabled={!isEditing}
                      onChange={(e) => updateField(st.id, "isLeave", e.target.checked)}
                      className="rounded border-slate-600"
                    />
                  </td>
                  <td className="py-2 px-2 text-center">
                    {isEditing ? (
                      <select
                        className="bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-xs"
                        value={st.postShiftRule ?? ""}
                        onChange={(e) => updateField(st.id, "postShiftRule", e.target.value || null)}
                      >
                        <option value="">None</option>
                        <option value="day_off_after">Day off after</option>
                      </select>
                    ) : (
                      <span className="text-xs text-slate-500">{st.postShiftRule ? "Day off" : "—"}</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {isEditing && (
                      <div className="flex gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); saveShift(st); }}
                          className="px-2 py-0.5 text-xs bg-emerald-700 hover:bg-emerald-600 rounded transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); cancelEdit(); }}
                          className="px-2 py-0.5 text-xs bg-slate-600 hover:bg-slate-500 rounded transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteShift(st.id); }}
                          className="px-2 py-0.5 text-xs bg-red-800 hover:bg-red-700 rounded transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                {isEditing && (
                  <tr className="bg-slate-700/20">
                    <td colSpan={9} className="px-4 py-3">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Auto-Scheduling</div>
                      <div className="flex flex-wrap gap-x-6 gap-y-2 items-center text-xs">
                        <label className="flex items-center gap-1.5">
                          <span className="text-slate-400">Priority</span>
                          <input
                            type="number"
                            className="w-14 bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-center"
                            value={st.schedulePriority ?? ""}
                            placeholder="—"
                            onChange={(e) => updateField(st.id, "schedulePriority", e.target.value ? parseInt(e.target.value) : null)}
                          />
                          <span className="text-slate-500">lower = first</span>
                        </label>
                        <label className="flex items-center gap-1.5">
                          <span className="text-slate-400">Eligibility</span>
                          <select
                            className="bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-xs"
                            value={st.eligibilityRule ?? ""}
                            onChange={(e) => updateField(st.id, "eligibilityRule", e.target.value || null)}
                          >
                            <option value="">All providers</option>
                            <option value="takesCall">Takes call</option>
                            <option value="takesLate">Takes late</option>
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={st.weekendPaired}
                            onChange={(e) => updateField(st.id, "weekendPaired", e.target.checked)}
                            className="rounded border-slate-600"
                          />
                          <span className="text-slate-400">Weekend paired</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={st.ignoresWorkingDays}
                            onChange={(e) => updateField(st.id, "ignoresWorkingDays", e.target.checked)}
                            className="rounded border-slate-600"
                          />
                          <span className="text-slate-400">Ignores working days</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={st.isFillShift}
                            onChange={(e) => updateField(st.id, "isFillShift", e.target.checked)}
                            className="rounded border-slate-600"
                          />
                          <span className="text-slate-400">Fill shift</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={st.isOffShift}
                            onChange={(e) => updateField(st.id, "isOffShift", e.target.checked)}
                            className="rounded border-slate-600"
                          />
                          <span className="text-slate-400">Off shift</span>
                        </label>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        onClick={addShift}
        className="mt-3 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300"
      >
        + Add Shift Type
      </button>
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
                      onClick={() => setEditingCol(isEditing ? null : code)}
                      className="px-2 py-1 text-xs font-bold font-mono rounded transition-colors hover:brightness-125"
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
              <th className="py-2 px-2 w-12">
                <button
                  onClick={() => setShowAddPicker(!showAddPicker)}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  title="Add shift column"
                >
                  +
                </button>
              </th>
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
                        className="w-12 bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-sm text-center font-mono"
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

      {showAddPicker && (
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

      <button
        onClick={save}
        className="mt-4 px-4 py-2 text-sm bg-blue-700 hover:bg-blue-600 rounded transition-colors font-medium"
      >
        Save Staffing Rules
      </button>
    </section>
  );
}

// ─── Pay Periods Section ────────────────────────────────────────────────────

function PayPeriodsSection({ initial, pushUndo }: { initial: PayPeriod[]; pushUndo: (a: UndoAction) => void }) {
  const [periods, setPeriods] = useState(initial);
  const [startDate, setStartDate] = useState(initial[0]?.startDate ?? "2025-12-14");
  const [periodCount, setPeriodCount] = useState(initial.length || 26);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-xs text-slate-400 block mb-1">First Period Start</label>
          <input
            type="date"
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Number of Periods</label>
          <div className="flex gap-2">
            <input
              type="number"
              className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
              value={periodCount}
              onChange={(e) => setPeriodCount(parseInt(e.target.value) || 26)}
            />
            <button
              onClick={regenerate}
              className="px-3 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 rounded transition-colors"
            >
              Regenerate
            </button>
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
                <span key={`s-${pp.id}`} className="text-slate-300 font-mono">{pp.startDate}</span>
                <span key={`e-${pp.id}`} className="text-slate-300 font-mono">{pp.endDate}</span>
              </>
            ))}
          </div>
        </ScrollContainer>
      </div>
    </section>
  );
}

// ─── FTE Hours Section ──────────────────────────────────────────────────────

function FteHoursSection({ initial, pushUndo }: { initial: FteTarget[]; pushUndo: (a: UndoAction) => void }) {
  const [targets, setTargets] = useState(() =>
    [...initial].sort((a, b) => b.ftePercentage - a.ftePercentage),
  );
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const [newFte, setNewFte] = useState("");

  const baseHours = targets.find((t) => t.ftePercentage === 1.0)?.targetHours ?? 80;

  function updateBaseHours(newBase: number) {
    setTargets((prev) =>
      prev.map((t) => ({
        ...t,
        targetHours: Math.round(t.ftePercentage * newBase * 10) / 10,
      })),
    );
  }

  function updateTargetHours(ftePercentage: number, hours: number) {
    setTargets((prev) =>
      prev.map((t) => t.ftePercentage === ftePercentage ? { ...t, targetHours: hours } : t),
    );
  }

  function addFteLevel() {
    const pct = parseFloat(newFte);
    if (!pct || pct <= 0 || pct > 1.0) return;
    if (targets.some((t) => t.ftePercentage === pct)) return;
    setTargets((prev) =>
      [...prev, { id: `new-${pct}`, ftePercentage: pct, targetHours: Math.round(pct * baseHours * 10) / 10 }]
        .sort((a, b) => b.ftePercentage - a.ftePercentage),
    );
    setNewFte("");
  }

  function removeFteLevel(ftePercentage: number) {
    if (ftePercentage === 1.0) return;
    setTargets((prev) => prev.filter((t) => t.ftePercentage !== ftePercentage));
  }

  async function save() {
    const prevTargets = [...targets];
    setStatus("saving");
    try {
      const res = await fetch("/api/settings/fte-targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: targets.map((t) => ({ ftePercentage: t.ftePercentage, targetHours: t.targetHours })),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const saved: FteTarget[] = await res.json();
      setTargets(saved.sort((a, b) => b.ftePercentage - a.ftePercentage));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);

      pushUndo({
        label: "Updated FTE hours",
        execute: async () => {
          const res = await fetch("/api/settings/fte-targets", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              targets: prevTargets.map((t) => ({ ftePercentage: t.ftePercentage, targetHours: t.targetHours })),
            }),
          });
          const restored: FteTarget[] = await res.json();
          setTargets(restored.sort((a, b) => b.ftePercentage - a.ftePercentage));
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
        title="Hours per Pay Period"
        description="Target hours by FTE level — used for pay period summaries in the grid"
        status={status}
        error={error}
      />

      <div className="mb-4">
        <label className="text-xs text-slate-400 block mb-1">Base Hours (1.0 FTE)</label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
            value={baseHours}
            onChange={(e) => updateBaseHours(parseFloat(e.target.value) || 80)}
          />
          <span className="text-xs text-slate-500">Changing this recalculates all FTE levels</span>
        </div>
      </div>

      <div className="space-y-1 mb-4">
        <div className="grid grid-cols-3 gap-3 text-xs text-slate-500 font-medium px-1">
          <span>FTE</span>
          <span>Hours / Period</span>
          <span></span>
        </div>
        {targets.map((t) => (
          <div key={t.ftePercentage} className="grid grid-cols-3 gap-3 items-center px-1 py-1 rounded hover:bg-slate-700/30">
            <span className="text-sm font-mono text-slate-300">
              {t.ftePercentage === 1.0 ? "1.0" : t.ftePercentage.toFixed(2).replace(/0$/, "")}
            </span>
            <input
              type="number"
              step="0.5"
              className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm font-mono"
              value={t.targetHours}
              onChange={(e) => updateTargetHours(t.ftePercentage, parseFloat(e.target.value) || 0)}
            />
            <div>
              {t.ftePercentage !== 1.0 && (
                <button
                  onClick={() => removeFteLevel(t.ftePercentage)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 items-center mb-4">
        <input
          type="number"
          step="0.1"
          min="0.1"
          max="1.0"
          placeholder="0.5"
          className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
          value={newFte}
          onChange={(e) => setNewFte(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addFteLevel()}
        />
        <button
          onClick={addFteLevel}
          className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300"
        >
          + Add FTE Level
        </button>
      </div>

      <button
        onClick={save}
        className="px-4 py-2 text-sm bg-blue-700 hover:bg-blue-600 rounded transition-colors font-medium"
      >
        Save FTE Hours
      </button>
    </section>
  );
}

// ─── Holidays Section ───────────────────────────────────────────────────────

function HolidaysSection({ initial, payPeriods, pushUndo }: { initial: Holiday[]; payPeriods: PayPeriod[]; pushUndo: (a: UndoAction) => void }) {
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

      <div className="mb-4">
        <button
          onClick={autoPopulate}
          className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300"
        >
          Auto-populate federal holidays ({coveredYears.join(", ")})
        </button>
      </div>

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

      {holidays.length === 0 ? (
        <p className="text-sm text-slate-500 italic">No holidays configured</p>
      ) : (
        <ScrollContainer maxClass="max-h-[432px]">
          <div className="space-y-1">
            {holidays.map((h) => (
              <div key={h.id} className="flex items-center justify-between py-1.5 px-3 rounded hover:bg-slate-700/30">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-slate-400">{h.date}</span>
                  <span className="text-sm text-slate-200">{h.name}</span>
                </div>
                <button
                  onClick={() => removeHoliday(h.id)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Remove
                </button>
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
  [-2]: "Very Bad", [-1]: "Bad", 0: "", 1: "Good", 2: "Great",
};
const WEIGHT_BG: Record<number, string> = {
  [-2]: "bg-red-900/40", [-1]: "bg-red-900/20", 0: "", 1: "bg-emerald-900/20", 2: "bg-emerald-900/40",
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
                        className="bg-transparent border border-slate-600 rounded px-1.5 py-0.5 text-xs text-center cursor-pointer hover:border-slate-400 transition-colors w-14"
                        value={w}
                        onChange={(e) => setWeight(st.id, day, parseInt(e.target.value))}
                        title={WEIGHT_LABELS[w] || "Neutral"}
                      >
                        <option value={-2}>-2</option>
                        <option value={-1}>-1</option>
                        <option value={0}>0</option>
                        <option value={1}>+1</option>
                        <option value={2}>+2</option>
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
        <button
          onClick={save}
          className="px-4 py-2 text-sm bg-blue-700 hover:bg-blue-600 rounded transition-colors font-medium"
        >
          Save Desirability
        </button>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="inline-block w-3 h-3 rounded bg-red-900/40" /> Very undesirable (-2)
          <span className="inline-block w-3 h-3 rounded bg-red-900/20" /> Bad (-1)
          <span className="inline-block w-3 h-3 rounded border border-slate-600" /> Neutral (0)
          <span className="inline-block w-3 h-3 rounded bg-emerald-900/20" /> Good (+1)
          <span className="inline-block w-3 h-3 rounded bg-emerald-900/40" /> Great (+2)
        </div>
      </div>
    </section>
  );
}

// ─── Scheduling Preferences Section ─────────────────────────────────────────

function SchedulingPrefsSection({ initial }: { initial: SchedulingPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

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
              onClick={() => toggle(key)}
              className={[
                "mt-0.5 w-10 h-[22px] rounded-full transition-colors shrink-0 relative",
                prefs[key] ? "bg-blue-600" : "bg-slate-600",
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
      </div>
    </section>
  );
}

// ─── Main Settings Page ─────────────────────────────────────────────────────

export function SettingsPage({ shiftTypes, staffingReqs, payPeriods, fteTargets, holidays, desirabilityWeights, schedulingPrefs }: Props) {
  const undo = useUndo();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <ShiftTypesSection initial={shiftTypes} pushUndo={undo.push} />
        <StaffingSection initial={staffingReqs} shiftTypes={shiftTypes} pushUndo={undo.push} />
        <DesirabilitySection initial={desirabilityWeights} shiftTypes={shiftTypes} pushUndo={undo.push} />
        <SchedulingPrefsSection initial={schedulingPrefs} />
        <FteHoursSection initial={fteTargets} pushUndo={undo.push} />
        <PayPeriodsSection initial={payPeriods} pushUndo={undo.push} />
        <HolidaysSection initial={holidays} payPeriods={payPeriods} pushUndo={undo.push} />
      </div>

      {undo.pending && (
        <UndoToast action={undo.pending} onUndo={undo.execute} onDismiss={undo.dismiss} />
      )}
    </div>
  );
}
