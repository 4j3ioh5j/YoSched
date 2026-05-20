"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Provider = {
  id: string;
  name: string;
  initials: string;
  employmentType: string;
  ftePercentage: number;
  workingDays: number[];
  takesCall: boolean;
  takesLate: boolean;
  specialQualifications: string[];
  isActive: boolean;
  sortOrder: number;
};

type Props = {
  providers: Provider[];
};

type UndoAction = {
  label: string;
  execute: () => Promise<void>;
};

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_INDICES = [0, 1, 2, 3, 4, 5, 6];

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

function StaffRow({
  provider,
  isEditing,
  onEdit,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  provider: Provider;
  isEditing: boolean;
  onEdit: () => void;
  onChange: (field: keyof Provider, value: unknown) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const p = provider;

  return (
    <tr
      className={[
        "transition-colors",
        isEditing ? "bg-slate-700/30" : "hover:bg-slate-800/50 cursor-pointer",
        !p.isActive ? "opacity-50" : "",
      ].join(" ")}
      onClick={() => !isEditing && onEdit()}
    >
      <td className="py-2 px-3">
        {isEditing ? (
          <input
            className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-xs font-mono font-bold"
            value={p.initials}
            onChange={(e) => onChange("initials", e.target.value)}
          />
        ) : (
          <span className={`font-mono font-bold ${p.employmentType === "fee_basis" ? "text-amber-400" : "text-slate-200"}`}>
            {p.initials}
          </span>
        )}
      </td>
      <td className="py-2 px-3">
        {isEditing ? (
          <input
            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-sm"
            value={p.name}
            onChange={(e) => onChange("name", e.target.value)}
          />
        ) : (
          <span className="text-sm text-slate-300">{p.name}</span>
        )}
      </td>
      <td className="py-2 px-3 text-center">
        {isEditing ? (
          <select
            className="bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-xs"
            value={p.employmentType}
            onChange={(e) => onChange("employmentType", e.target.value)}
          >
            <option value="fte">FTE</option>
            <option value="fee_basis">Fee basis</option>
          </select>
        ) : (
          <span className={`text-xs ${p.employmentType === "fee_basis" ? "text-amber-400" : "text-slate-400"}`}>
            {p.employmentType === "fee_basis" ? "Fee" : "FTE"}
          </span>
        )}
      </td>
      <td className="py-2 px-3 text-center">
        {isEditing ? (
          <select
            className="bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-xs"
            value={p.ftePercentage}
            onChange={(e) => onChange("ftePercentage", parseFloat(e.target.value))}
          >
            {[1.0, 0.8, 0.6, 0.5, 0.4, 0.2].map((v) => (
              <option key={v} value={v}>{(v * 100).toFixed(0)}%</option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-slate-400 font-mono">
            {p.employmentType === "fee_basis" ? "—" : `${(p.ftePercentage * 100).toFixed(0)}%`}
          </span>
        )}
      </td>
      <td className="py-2 px-3">
        <div className="flex gap-0.5 justify-center">
          {DAY_INDICES.map((d) => {
            const active = p.workingDays.includes(d);
            return (
              <button
                key={d}
                disabled={!isEditing}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isEditing) return;
                  const next = active
                    ? p.workingDays.filter((x) => x !== d)
                    : [...p.workingDays, d].sort();
                  onChange("workingDays", next);
                }}
                className={[
                  "w-5 h-5 text-[10px] rounded font-medium transition-colors",
                  active ? "bg-blue-600/40 text-blue-300" : "bg-slate-700/50 text-slate-600",
                  isEditing ? "hover:brightness-125 cursor-pointer" : "cursor-default",
                ].join(" ")}
              >
                {DAY_LABELS[d]}
              </button>
            );
          })}
        </div>
      </td>
      <td className="py-2 px-3 text-center">
        <input
          type="checkbox"
          checked={p.takesCall}
          disabled={!isEditing}
          onChange={(e) => onChange("takesCall", e.target.checked)}
          className="rounded border-slate-600"
        />
      </td>
      <td className="py-2 px-3 text-center">
        <input
          type="checkbox"
          checked={p.takesLate}
          disabled={!isEditing}
          onChange={(e) => onChange("takesLate", e.target.checked)}
          className="rounded border-slate-600"
        />
      </td>
      <td className="py-2 px-3 text-center">
        <input
          type="checkbox"
          checked={p.isActive}
          disabled={!isEditing}
          onChange={(e) => onChange("isActive", e.target.checked)}
          className="rounded border-slate-600"
        />
      </td>
      <td className="py-2 px-3 text-center">
        {isEditing && (
          <div className="flex gap-1 justify-center">
            <button
              onClick={(e) => { e.stopPropagation(); onSave(); }}
              className="px-2 py-0.5 text-xs bg-emerald-700 hover:bg-emerald-600 rounded transition-colors"
            >
              Save
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onCancel(); }}
              className="px-2 py-0.5 text-xs bg-slate-600 hover:bg-slate-500 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="px-2 py-0.5 text-xs bg-red-800 hover:bg-red-700 rounded transition-colors"
            >
              Delete
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export function StaffPage({ providers: initial }: Props) {
  const [providers, setProviders] = useState(initial);
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

  function updateField(id: string, field: keyof Provider, value: unknown) {
    setProviders((prev) => prev.map((p) => p.id === id ? { ...p, [field]: value } : p));
  }

  function cancelEdit() {
    if (!editingId) return;
    const orig = initial.find((p) => p.id === editingId);
    if (orig) setProviders((prev) => prev.map((p) => p.id === editingId ? orig : p));
    setEditingId(null);
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
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Provider", initials: "NEW" }),
      });
      const created = await res.json();
      const newProv: Provider = {
        id: created.id,
        name: created.name,
        initials: created.initials,
        employmentType: created.employmentType,
        ftePercentage: created.ftePercentage ?? 1.0,
        workingDays: created.workingDays,
        takesCall: created.takesCall,
        takesLate: created.takesLate,
        specialQualifications: created.specialQualifications ?? [],
        isActive: created.isActive,
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
  const fteCount = activeProviders.filter((p) => p.employmentType === "fte").length;
  const feeCount = activeProviders.filter((p) => p.employmentType === "fee_basis").length;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Staff Directory</h2>
            <p className="text-sm text-slate-400">
              {activeProviders.length} active ({fteCount} FTE, {feeCount} fee basis)
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
                  <th
                    className="text-left py-2.5 px-3 w-16 cursor-pointer hover:text-slate-200 transition-colors select-none"
                    onClick={() => toggleSort("initials")}
                  >
                    ID {sortBy === "initials" ? (sortAsc ? "▲" : "▼") : ""}
                  </th>
                  <th
                    className="text-left py-2.5 px-3 cursor-pointer hover:text-slate-200 transition-colors select-none"
                    onClick={() => toggleSort("name")}
                  >
                    Name {sortBy === "name" ? (sortAsc ? "▲" : "▼") : ""}
                  </th>
                  <th className="text-center py-2.5 px-3 w-16">Type</th>
                  <th className="text-center py-2.5 px-3 w-14">FTE</th>
                  <th className="text-center py-2.5 px-3 w-40">Working Days</th>
                  <th className="text-center py-2.5 px-3 w-12">Call</th>
                  <th className="text-center py-2.5 px-3 w-12">Late</th>
                  <th className="text-center py-2.5 px-3 w-14">Active</th>
                  <th className="text-center py-2.5 px-3 w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {activeProviders.map((p) => (
                  <StaffRow
                    key={p.id}
                    provider={p}
                    isEditing={editingId === p.id}
                    onEdit={() => setEditingId(p.id)}
                    onChange={(f, v) => updateField(p.id, f, v)}
                    onSave={() => saveProvider(p)}
                    onCancel={cancelEdit}
                    onDelete={() => deleteProvider(p.id)}
                  />
                ))}
                {showInactive && inactiveProviders.map((p) => (
                  <StaffRow
                    key={p.id}
                    provider={p}
                    isEditing={editingId === p.id}
                    onEdit={() => setEditingId(p.id)}
                    onChange={(f, v) => updateField(p.id, f, v)}
                    onSave={() => saveProvider(p)}
                    onCancel={cancelEdit}
                    onDelete={() => deleteProvider(p.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 px-1">
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="text-slate-200 font-mono font-bold">AB</span> FTE
            </span>
            <span className="flex items-center gap-1">
              <span className="text-amber-400 font-mono font-bold">AB</span> Fee basis
            </span>
            <span className="text-slate-600">|</span>
            <span>Click row to edit, Save to commit</span>
          </div>
        </div>
      </div>

      {undo && <UndoToast action={undo} onUndo={executeUndo} onDismiss={dismissUndo} />}
    </div>
  );
}
