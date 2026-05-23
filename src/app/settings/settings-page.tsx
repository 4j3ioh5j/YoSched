"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEscape } from "@/lib/use-escape";

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
  noConsecutiveGroup: string | null;
  maxPerDay: number | null;
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
};

type DefaultAvailabilityRule = {
  dayOfWeek: number;
  type: string;
  strength: string;
  pattern: string;
};

type EmploymentTypeData = {
  id: string;
  name: string;
  defaultIsAutoScheduled: boolean;
  defaultFtePercentage: number;
  defaultEligibleShiftTypeIds: string[];
  defaultAvailabilityRules: DefaultAvailabilityRule[];
  sortOrder: number;
  providerCount: number;
};

type EquityFactorData = {
  id: string;
  factorType: string;
  shiftCode: string | null;
  weight: number;
  enabled: boolean;
  sortOrder: number;
};

type Props = {
  shiftTypes: ShiftType[];
  staffingReqs: StaffingReq[];
  payPeriods: PayPeriod[];
  holidays: Holiday[];
  desirabilityWeights: DesirabilityWeight[];
  schedulingPrefs: SchedulingPrefs;
  employmentTypes: EmploymentTypeData[];
  equityFactors: EquityFactorData[];
  shiftCodes: string[];
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

function ShiftTypesSection({ initial, pushUndo }: { initial: ShiftType[]; pushUndo: (a: UndoAction) => void }) {
  const [shifts, setShifts] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
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
        noConsecutiveGroup: created.noConsecutiveGroup ?? null,
        maxPerDay: created.maxPerDay ?? null,
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
              <th className="text-center py-2 px-2 w-24">Post-shift</th>
              <th className="text-center py-2 px-2 w-28">Auto-schedule</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {shifts.map((st, i) => (
              <tr
                key={st.id}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={() => handleDrop(i)}
                onDragEnd={handleDragEnd}
                className={`transition-colors cursor-pointer ${dragOverIdx === i ? "bg-blue-900/30 border-t border-blue-500" : "hover:bg-slate-700/30"}`}
                onClick={() => setEditingId(st.id)}
              >
                <td className="py-2 px-1 w-8 text-center cursor-grab" onClick={(e) => e.stopPropagation()}>
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
                  {st.postShiftRule ? "Day off after" : "—"}
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
                <input className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm font-mono" value={editingShift.code} onChange={(e) => updateField(editingShift.id, "code", e.target.value.toUpperCase())} />
              </FieldRow>
              <FieldRow label="Name" description="Full name of this shift type">
                <input className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm" value={editingShift.name} onChange={(e) => updateField(editingShift.id, "name", e.target.value)} />
              </FieldRow>
              <FieldRow label="Hours per shift" description="How many hours this shift counts for">
                <input type="number" className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center" value={editingShift.defaultHours} onChange={(e) => updateField(editingShift.id, "defaultHours", parseFloat(e.target.value) || 0)} />
              </FieldRow>
              <FieldRow label="Category" description="Work shifts, leave, or other">
                <select className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm" value={editingShift.category} onChange={(e) => updateField(editingShift.id, "category", e.target.value)}>
                  <option value="work">Work</option>
                  <option value="leave">Leave</option>
                  <option value="other">Other</option>
                </select>
              </FieldRow>
              <FieldRow label="Color" description="Display color on the grid">
                <input type="color" className="w-8 h-8 rounded cursor-pointer border-0" value={editingShift.color} onChange={(e) => updateField(editingShift.id, "color", e.target.value)} />
              </FieldRow>
              <FieldRow label="This is a leave type" description="Check if this represents time off (AL, SL, etc.)">
                <input type="checkbox" checked={editingShift.isLeave} onChange={(e) => updateField(editingShift.id, "isLeave", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
              <FieldRow label="Counts toward FTE hours" description="Include these hours in pay period totals">
                <input type="checkbox" checked={editingShift.countsTowardFte} onChange={(e) => updateField(editingShift.id, "countsTowardFte", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
              <FieldRow label="Count hours on weekends" description="Include weekend hours in pay period totals">
                <input type="checkbox" checked={editingShift.countsOnWeekend} onChange={(e) => updateField(editingShift.id, "countsOnWeekend", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
              <FieldRow label="After this shift" description="What happens the next day. Use a preset or type a custom rule name.">
                <div className="flex gap-1">
                  <select className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm flex-1" value={editingShift.postShiftRule ?? ""} onChange={(e) => updateField(editingShift.id, "postShiftRule", e.target.value || null)}>
                    <option value="">Nothing special</option>
                    <option value="day_off_after">Must have the next day off</option>
                    {editingShift.postShiftRule && !["", "day_off_after"].includes(editingShift.postShiftRule) && (
                      <option value={editingShift.postShiftRule}>{editingShift.postShiftRule}</option>
                    )}
                  </select>
                  <input type="text" className="w-28 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm" placeholder="Custom…" value={editingShift.postShiftRule && !["day_off_after"].includes(editingShift.postShiftRule) ? editingShift.postShiftRule : ""} onChange={(e) => updateField(editingShift.id, "postShiftRule", e.target.value || null)} />
                </div>
              </FieldRow>
            </div>

            <div className="px-6 py-4 border-t border-slate-700">
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Auto-Scheduling Behavior</div>
              <FieldRow label="Scheduling order" description="When auto-scheduling, which shifts get assigned first. Lower numbers go first. Leave blank if this shift should not be auto-scheduled.">
                <input type="number" className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center" value={editingShift.schedulePriority ?? ""} placeholder="None" onChange={(e) => updateField(editingShift.id, "schedulePriority", e.target.value ? parseInt(e.target.value) : null)} />
              </FieldRow>
              <FieldRow label="Pair Saturday and Sunday" description="Assign the same person to both Saturday and Sunday when filling this shift on weekends">
                <input type="checkbox" checked={editingShift.weekendPaired} onChange={(e) => updateField(editingShift.id, "weekendPaired", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
              <FieldRow label="Can be assigned on days off" description="Allow this shift to be assigned even on a provider's non-working days (e.g., weekend call)">
                <input type="checkbox" checked={editingShift.ignoresWorkingDays} onChange={(e) => updateField(editingShift.id, "ignoresWorkingDays", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
              <FieldRow label="Default shift for filling hours" description="Use this shift to fill remaining hours when a provider is under their pay period target">
                <input type="checkbox" checked={editingShift.isFillShift} onChange={(e) => updateField(editingShift.id, "isFillShift", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
              <FieldRow label="Represents a day off" description="This shift means the provider is not working (used for post-shift recovery days)">
                <input type="checkbox" checked={editingShift.isOffShift} onChange={(e) => updateField(editingShift.id, "isOffShift", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
              <FieldRow label="No back-to-back group" description="Shifts sharing the same group name cannot be assigned on consecutive days for the same provider. For example, if ORC, ORL, and CALL all share the group 'call-late', a provider can't work ORL on Friday and CALL on Saturday.">
                <input className="w-32 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm" value={editingShift.noConsecutiveGroup ?? ""} placeholder="None" onChange={(e) => updateField(editingShift.id, "noConsecutiveGroup", e.target.value || null)} />
              </FieldRow>
              <FieldRow label="Maximum per day" description="Limit how many providers can be assigned this shift on the same day. Set to 1 if only one person should do this shift per day. Leave blank for no limit.">
                <input type="number" className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center" value={editingShift.maxPerDay ?? ""} placeholder="No limit" onChange={(e) => updateField(editingShift.id, "maxPerDay", e.target.value ? parseInt(e.target.value) : null)} />
              </FieldRow>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700">
              <button
                onClick={() => deleteShift(editingShift.id)}
                className="px-3 py-1.5 text-sm bg-red-900/50 hover:bg-red-800 text-red-300 rounded transition-colors"
              >
                Delete Shift Type
              </button>
              <div className="flex gap-2">
                <button
                  onClick={cancelEdit}
                  className="px-4 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => saveShift(editingShift)}
                  className="px-4 py-1.5 text-sm bg-blue-700 hover:bg-blue-600 rounded transition-colors font-medium"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
            className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm font-mono"
            value={baseHours}
            onChange={(e) => setBaseHours(parseFloat(e.target.value) || 80)}
          />
          <button
            onClick={saveBaseHours}
            className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 rounded transition-colors"
          >
            {hoursStatus === "saving" ? "Saving…" : hoursStatus === "saved" ? "Saved" : "Save"}
          </button>
          <span className="text-xs text-slate-500">Fractional FTE hours are computed from this value</span>
        </div>
      </div>

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

function EquityFactorsSection({
  initial,
  availableShiftCodes,
}: {
  initial: EquityFactorData[];
  availableShiftCodes: string[];
}) {
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
              onClick={() => updateFactor(idx, { enabled: !f.enabled })}
              className={[
                "w-8 h-[20px] rounded-full transition-colors shrink-0 relative",
                f.enabled ? "bg-blue-600" : "bg-slate-600",
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
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-sm text-slate-200"
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
                className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-sm text-center text-slate-200"
                value={f.weight}
                onChange={(e) => updateFactor(idx, { weight: parseFloat(e.target.value) || 1 })}
              />
              <span className="text-[10px] text-slate-500 w-10 text-right">
                {f.enabled ? `${((f.weight / totalWeight) * 100).toFixed(0)}%` : "off"}
              </span>
            </div>

            <button
              onClick={() => removeFactor(idx)}
              className="text-slate-600 hover:text-red-400 transition-colors text-sm"
              title="Remove factor"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {canAddShift && (
          <button
            onClick={addShiftFactor}
            className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded transition-colors text-slate-300"
          >
            + Shift code
          </button>
        )}
        {!hasDesirability && (
          <button
            onClick={() => addBuiltinFactor("desirability")}
            className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded transition-colors text-slate-300"
          >
            + Shift Desirability
          </button>
        )}
        {!hasHoliday && (
          <button
            onClick={() => addBuiltinFactor("holiday")}
            className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded transition-colors text-slate-300"
          >
            + Holiday Work
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={save}
          disabled={status === "saving"}
          className="px-4 py-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors font-medium"
        >
          {status === "saving" ? "Saving..." : "Save"}
        </button>
      </div>
    </section>
  );
}

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

// ─── Employment Types Section ───────────────────────────────────────────────

const ET_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ET_DAY_INDICES = [0, 1, 2, 3, 4, 5, 6];
const ET_DAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

function EmploymentTypesSection({ initial, pushUndo, shiftTypes }: { initial: EmploymentTypeData[]; pushUndo: (a: UndoAction) => void; shiftTypes: ShiftType[] }) {
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
          dayOfWeek: da.dayOfWeek, type: da.type, strength: da.strength, pattern: da.pattern,
        })),
        sortOrder: created.sortOrder,
        providerCount: 0,
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
              className="hover:bg-slate-700/30 cursor-pointer transition-colors"
              onClick={() => setEditingId(t.id)}
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
              <td className="py-2 px-2 text-center text-slate-500 text-xs">{t.providerCount}</td>
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
                <input className="w-40 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm" value={et.name} onChange={(e) => updateField(et.id, "name", e.target.value)} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-200">Auto-schedule</div>
                  <div className="text-xs text-slate-500">Include in auto-scheduler by default</div>
                </div>
                <input type="checkbox" checked={et.defaultIsAutoScheduled} onChange={(e) => updateField(et.id, "defaultIsAutoScheduled", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-200">FTE percentage</div>
                  <div className="text-xs text-slate-500">Default target hours ratio</div>
                </div>
                <select className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm" value={et.defaultFtePercentage} onChange={(e) => updateField(et.id, "defaultFtePercentage", parseFloat(e.target.value))}>
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
                              const next = isEligible
                                ? et.defaultEligibleShiftTypeIds.filter((id) => id !== st.id)
                                : [...et.defaultEligibleShiftTypeIds, st.id];
                              updateField(et.id, "defaultEligibleShiftTypeIds", next);
                            }}
                            className={`px-2 py-0.5 text-xs font-bold rounded transition-colors border ${isEligible ? "" : "opacity-30"}`}
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
                                const next = isEligible
                                  ? et.defaultEligibleShiftTypeIds.filter((id) => id !== st.id)
                                  : [...et.defaultEligibleShiftTypeIds, st.id];
                                updateField(et.id, "defaultEligibleShiftTypeIds", next);
                              }}
                              className={`px-2 py-0.5 text-xs font-bold rounded transition-colors border ${isEligible ? "" : "opacity-30"}`}
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
                <div className="text-sm text-slate-200 mb-2">Default working days</div>
                <div className="flex gap-1">
                  {ET_DAY_INDICES.map((d) => {
                    const active = et.defaultAvailabilityRules.some((r) => r.dayOfWeek === d && r.type === "available");
                    return (
                      <button
                        key={d}
                        onClick={() => {
                          const next = active
                            ? et.defaultAvailabilityRules.filter((r) => r.dayOfWeek !== d)
                            : [...et.defaultAvailabilityRules, { dayOfWeek: d, type: "available", strength: "rule", pattern: "every" }];
                          updateField(et.id, "defaultAvailabilityRules", next);
                        }}
                        className={[
                          "w-10 h-8 text-xs rounded font-medium transition-colors",
                          active ? "bg-blue-600/50 text-blue-200 border border-blue-500/50" : "bg-slate-700 text-slate-500 border border-slate-600",
                          "hover:brightness-125",
                        ].join(" ")}
                      >
                        {ET_DAY_LABELS[d]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700">
              <button
                onClick={() => deleteType(et.id)}
                disabled={et.providerCount > 0}
                title={et.providerCount > 0 ? `${et.providerCount} staff member(s) use this type` : ""}
                className="px-3 py-1.5 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-400 border border-red-800/50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Delete
              </button>
              <div className="flex gap-2">
                <button onClick={cancelEdit} className="px-4 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors">Cancel</button>
                <button onClick={() => saveType(et)} className="px-4 py-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors font-medium">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={addType}
        className="mt-3 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300"
      >
        + Add Employment Type
      </button>
    </section>
  );
}

// ─── Main Settings Page ─────────────────────────────────────────────────────

export function SettingsPage({ shiftTypes, staffingReqs, payPeriods, holidays, desirabilityWeights, schedulingPrefs, employmentTypes, equityFactors: initialEquityFactors, shiftCodes: availableShiftCodes }: Props) {
  const undo = useUndo();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <ShiftTypesSection initial={shiftTypes} pushUndo={undo.push} />
        <EmploymentTypesSection initial={employmentTypes} pushUndo={undo.push} shiftTypes={shiftTypes} />
        <StaffingSection initial={staffingReqs} shiftTypes={shiftTypes} pushUndo={undo.push} />
        <DesirabilitySection initial={desirabilityWeights} shiftTypes={shiftTypes} pushUndo={undo.push} />
        <EquityFactorsSection initial={initialEquityFactors} availableShiftCodes={availableShiftCodes} />
        <SchedulingPrefsSection initial={schedulingPrefs} />
        <PayPeriodsSection initial={payPeriods} pushUndo={undo.push} />
        <HolidaysSection initial={holidays} payPeriods={payPeriods} pushUndo={undo.push} />
      </div>

      {undo.pending && (
        <UndoToast action={undo.pending} onUndo={undo.execute} onDismiss={undo.dismiss} />
      )}
    </div>
  );
}
