"use client";

import { useState } from "react";
import type { GraphStaffFilter } from "@/lib/graph/spec";

export type StaffPickerStaff = {
  id: string;
  initials: string;
  name: string;
  employmentTypeName: string;
  ftePercentage: number;
};

export function StaffPicker({
  value,
  staff,
  onChange,
}: {
  value: GraphStaffFilter;
  staff: StaffPickerStaff[];
  onChange: (s: GraphStaffFilter) => void;
}) {
  const [showNames, setShowNames] = useState((value.names?.length ?? 0) > 0);

  const employmentTypes = [...new Set(staff.map((p) => p.employmentTypeName))].sort();
  const selectedNames = new Set(value.names ?? []);

  // A staff is offerable when it satisfies the other active staff filters
  // (employment type + min FTE). The "By name" chips only show offerable
  // staff, so the filters can't be combined into a contradictory (empty)
  // selection.
  function matches(p: StaffPickerStaff, employmentType: string | null, minFtePct: number | null): boolean {
    if (employmentType && p.employmentTypeName !== employmentType) return false;
    if (minFtePct && minFtePct > 0 && p.ftePercentage < minFtePct) return false;
    return true;
  }

  const visibleStaff = staff.filter((p) => matches(p, value.employmentType ?? null, value.minFtePct ?? null));

  // Drop already-picked names that no longer satisfy the filters, so the chip
  // count and the narrowed list stay consistent.
  function prunedNames(employmentType: string | null, minFtePct: number | null): string[] | undefined {
    if (!value.names) return value.names;
    return value.names.filter((id) => {
      const p = staff.find((pp) => pp.id === id);
      return p ? matches(p, employmentType, minFtePct) : false;
    });
  }

  function patch(next: Partial<GraphStaffFilter>) {
    onChange({ ...value, ...next });
  }

  function selectType(type: string) {
    const employmentType = type || null;
    onChange({ ...value, employmentType, names: prunedNames(employmentType, value.minFtePct ?? null) });
  }

  function setMinFte(raw: string) {
    const minFtePct = parseFloat(raw) || null;
    onChange({ ...value, minFtePct, names: prunedNames(value.employmentType ?? null, minFtePct) });
  }

  function toggleName(id: string) {
    const set = new Set(selectedNames);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    patch({ names: [...set] });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500 w-16">Staff</span>

        <select
          value={value.employmentType ?? ""}
          onChange={(e) => selectType(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
        >
          <option value="">All types</option>
          {employmentTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <label className="text-xs text-slate-500">Min FTE</label>
        <input
          type="number"
          step="0.1"
          min="0"
          max="9.999"
          className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-300"
          value={value.minFtePct || ""}
          onChange={(e) => setMinFte(e.target.value)}
          placeholder="0"
        />

        <button
          onClick={() => setShowNames((v) => !v)}
          className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${selectedNames.size > 0 ? "bg-blue-600/20 text-blue-300 border-blue-500/40" : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700"}`}
        >
          By name{selectedNames.size > 0 ? ` (${selectedNames.size})` : ""}
        </button>
        {selectedNames.size > 0 && (
          <button
            onClick={() => patch({ names: [] })}
            className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            clear
          </button>
        )}
      </div>

      {showNames && (
        <div className="flex flex-wrap gap-1.5 pl-[72px]">
          {visibleStaff.map((p) => {
            const active = selectedNames.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggleName(p.id)}
                title={p.name}
                className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${active ? "bg-blue-600/20 text-blue-300 border-blue-500/40" : "bg-slate-800 text-slate-500 border-slate-700 hover:bg-slate-700"}`}
              >
                {p.initials}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
