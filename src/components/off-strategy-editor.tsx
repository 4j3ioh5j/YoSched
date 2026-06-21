"use client";

// Reorderable editor for a day-off fulfillment order (offStrategyOrder). Shared by
// the My Requests form (per-request order) and Settings (department default). Each
// row is a strategy the engine will try top-down; reorder with the arrows, drop one
// with ×, and add unused methods (the two fixed strategies + any eligible leave type)
// from the dropdown. Tokens: ORC_ADJACENT | ORL_PAIR | LEAVE:<shiftTypeId>.

import { useMemo } from "react";
import { OFF_STRATEGY_FIXED, LEAVE_STRATEGY_PREFIX, describeOffStrategy } from "@/lib/schedule-requests";

type LeaveType = { id: string; code: string; name: string };

export function OffStrategyEditor({
  order,
  onChange,
  leaveTypes,
  disabled = false,
}: {
  order: string[];
  onChange: (next: string[]) => void;
  leaveTypes: LeaveType[];
  disabled?: boolean;
}) {
  const codeOf = useMemo(() => {
    const m = new Map(leaveTypes.map((s) => [s.id, s.code]));
    return (id: string) => m.get(id) ?? id;
  }, [leaveTypes]);

  // Methods not already in the order, in a stable display sequence: the two fixed
  // strategies first, then each eligible leave type.
  const available = useMemo(() => {
    const inUse = new Set(order);
    const opts: { token: string; label: string }[] = [];
    for (const t of OFF_STRATEGY_FIXED) {
      if (!inUse.has(t)) opts.push({ token: t, label: describeOffStrategy(t, codeOf) });
    }
    for (const lt of leaveTypes) {
      const token = `${LEAVE_STRATEGY_PREFIX}${lt.id}`;
      if (!inUse.has(token)) opts.push({ token, label: `${lt.code} leave` });
    }
    return opts;
  }, [order, leaveTypes, codeOf]);

  function move(idx: number, delta: number) {
    const next = [...order];
    const j = idx + delta;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  }
  function remove(idx: number) {
    onChange(order.filter((_, i) => i !== idx));
  }
  function add(token: string) {
    if (!token || order.includes(token)) return;
    onChange([...order, token]);
  }

  return (
    <div className="space-y-2">
      {order.length === 0 && (
        <p className="text-xs text-slate-500">
          No preference set — the scheduler decides how to give the day off.
        </p>
      )}
      <ol className="space-y-1.5">
        {order.map((token, idx) => (
          <li
            key={token}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-slate-700 bg-slate-800/60 text-sm"
          >
            <span className="w-5 text-center text-xs text-slate-500 shrink-0">{idx + 1}</span>
            <span className="flex-1 text-slate-200">{describeOffStrategy(token, codeOf)}</span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={disabled || idx === 0}
                aria-label="Move up"
                className="px-1.5 text-slate-400 hover:text-slate-100 disabled:opacity-30 disabled:hover:text-slate-400"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={disabled || idx === order.length - 1}
                aria-label="Move down"
                className="px-1.5 text-slate-400 hover:text-slate-100 disabled:opacity-30 disabled:hover:text-slate-400"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(idx)}
                disabled={disabled}
                aria-label="Remove"
                className="px-1.5 text-rose-500/70 hover:text-rose-400 disabled:opacity-30"
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ol>
      {available.length > 0 && (
        <select
          value=""
          disabled={disabled}
          onChange={(e) => {
            add(e.target.value);
            e.target.value = "";
          }}
          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        >
          <option value="">+ Add a method…</option>
          {available.map((o) => (
            <option key={o.token} value={o.token}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
