"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Provider = {
  id: string;
  name: string;
  initials: string;
  employmentTypeId: string;
  employmentTypeName: string;
  ftePercentage: number;
  workingDays: number[];
  takesCall: boolean;
  takesLate: boolean;
  specialQualifications: string[];
  isActive: boolean;
  isAutoScheduled: boolean;
  sortOrder: number;
};

type EmploymentType = {
  id: string;
  name: string;
  defaultIsAutoScheduled: boolean;
  defaultFtePercentage: number;
  defaultTakesCall: boolean;
  defaultTakesLate: boolean;
  defaultWorkingDays: number[];
};

type Props = {
  providers: Provider[];
  employmentTypes: EmploymentType[];
};

type UndoAction = {
  label: string;
  execute: () => Promise<void>;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_INDICES = [0, 1, 2, 3, 4, 5, 6];
const DAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

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

export function StaffPage({ providers: initial, employmentTypes }: Props) {
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
      takesCall: et.defaultTakesCall,
      takesLate: et.defaultTakesLate,
      workingDays: et.defaultWorkingDays,
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
        workingDays: created.workingDays,
        takesCall: created.takesCall,
        takesLate: created.takesLate,
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
                  <th className="text-center py-2.5 px-3 w-40">Working Days</th>
                  <th className="text-center py-2.5 px-3 w-12">Call</th>
                  <th className="text-center py-2.5 px-3 w-12">Late</th>
                  <th className="text-center py-2.5 px-3 w-12">Sched</th>
                  <th className="text-center py-2.5 px-3 w-20">Quals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {activeProviders.map((p) => (
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
                      <div className="flex gap-0.5 justify-center">
                        {DAY_INDICES.map((d) => (
                          <span
                            key={d}
                            className={[
                              "w-5 h-5 text-[10px] rounded font-medium flex items-center justify-center",
                              p.workingDays.includes(d) ? "bg-blue-600/40 text-blue-300" : "bg-slate-700/50 text-slate-600",
                            ].join(" ")}
                          >
                            {DAY_SHORT[d]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className={p.takesCall ? "text-emerald-400" : "text-slate-600"}>
                        {p.takesCall ? "✓" : "—"}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className={p.takesLate ? "text-emerald-400" : "text-slate-600"}>
                        {p.takesLate ? "✓" : "—"}
                      </span>
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
                ))}
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
              <FieldRow label="Active" description="Inactive staff are hidden from the schedule">
                <input type="checkbox" checked={ep.isActive} onChange={(e) => updateField(ep.id, "isActive", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
            </div>

            <div className="px-6 py-4 border-t border-slate-700">
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Scheduling</div>
              <FieldRow label="Auto-schedule" description="Include this person in the auto-scheduler">
                <input type="checkbox" checked={ep.isAutoScheduled} onChange={(e) => updateField(ep.id, "isAutoScheduled", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
              <FieldRow label="FTE percentage" description="Target hours = FTE% × pay period hours">
                <select className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm" value={ep.ftePercentage} onChange={(e) => updateField(ep.id, "ftePercentage", parseFloat(e.target.value))}>
                  {[1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1].map((v) => (
                    <option key={v} value={v}>{(v * 100).toFixed(0)}%</option>
                  ))}
                </select>
              </FieldRow>
              <FieldRow label="Takes call" description="Eligible for call shifts">
                <input type="checkbox" checked={ep.takesCall} onChange={(e) => updateField(ep.id, "takesCall", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
              <FieldRow label="Takes late" description="Eligible for late shifts">
                <input type="checkbox" checked={ep.takesLate} onChange={(e) => updateField(ep.id, "takesLate", e.target.checked)} className="rounded border-slate-600 w-4 h-4" />
              </FieldRow>
              <div className="py-2.5">
                <div className="text-sm text-slate-200 mb-2">Working days</div>
                <div className="flex gap-1">
                  {DAY_INDICES.map((d) => {
                    const active = ep.workingDays.includes(d);
                    return (
                      <button
                        key={d}
                        onClick={() => {
                          const next = active
                            ? ep.workingDays.filter((x) => x !== d)
                            : [...ep.workingDays, d].sort();
                          updateField(ep.id, "workingDays", next);
                        }}
                        className={[
                          "w-10 h-8 text-xs rounded font-medium transition-colors",
                          active ? "bg-blue-600/50 text-blue-200 border border-blue-500/50" : "bg-slate-700 text-slate-500 border border-slate-600",
                          "hover:brightness-125",
                        ].join(" ")}
                      >
                        {DAY_LABELS[d]}
                      </button>
                    );
                  })}
                </div>
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
                  placeholder="Add qualification…"
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
                  {saving ? "Saving…" : "Save"}
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
