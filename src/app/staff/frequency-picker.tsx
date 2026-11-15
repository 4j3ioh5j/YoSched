"use client";

import {
  frequencyModeOf,
  applyFrequencyMode,
  describeFrequency,
  type FrequencyMode,
  type ShiftMinTarget,
} from "@/lib/shift-eligibility";

// Sentence-builder for the HOW-OFTEN axis (per-staff shift count targets). The
// stored shape stays {minCount, maxCount, window, windowCount/windowDays} so the
// scheduler is unchanged; this surfaces the implicit min/max encoding as an
// explicit mode. Clamps impossible ranges so invalid targets can't be created.

type Target = {
  shiftTypeId: string;
  minCount: number;
  maxCount?: number | null;
  window: string;
  windowDays?: number | null;
  windowCount?: number | null;
  strength?: string; // card #189: "rule" (Hard) | "preference" (Prefer)
};

// The target a count/mode edit commits: the window and the Hard/Prefer choice carry over
// (card #189: an edit must never quietly turn a Prefer back into Hard). "" / 0 deletes.
export function committedTarget(t: Target, shiftTypeId: string, minCount: number, maxCount: number | null): Target | undefined {
  if (minCount <= 0 && (maxCount == null || maxCount <= 0)) return undefined;
  return {
    shiftTypeId,
    minCount: Math.max(0, minCount),
    maxCount: maxCount == null ? null : Math.max(0, maxCount),
    window: t.window,
    windowDays: t.window === "days" ? t.windowDays ?? 7 : null,
    windowCount: t.window === "days" ? 1 : t.windowCount ?? 1,
    strength: t.strength === "preference" ? "preference" : "rule",
  };
}

const STRENGTH_HINT: Record<string, string> = {
  rule: "Hard: always kept — an “at least” is met even past their hours, an “at most” is never exceeded; warns if it can't be.",
  preference: "Prefer: aimed for only when it fits their hours; an “at most” is only discouraged; no warning.",
};

const MODE_OPTIONS: { value: FrequencyMode; label: string }[] = [
  { value: "atLeast", label: "At least" },
  { value: "atMost", label: "At most" },
  { value: "exactly", label: "Exactly" },
  { value: "between", label: "Between" },
];

const UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: "week", label: "week" },
  { value: "pay_period", label: "pay period" },
  { value: "month", label: "month" },
  { value: "days", label: "day(s) — rolling" },
];

/** The picker's empty state; its strength is what a new target is saved with (card #258). */
export function blankTarget(shiftTypeId: string, defaultStrength: string = "rule"): Target {
  return {
    shiftTypeId,
    minCount: 0,
    maxCount: null,
    window: "pay_period",
    windowDays: null,
    windowCount: 1,
    strength: defaultStrength === "preference" ? "preference" : "rule",
  };
}

export function FrequencyPicker({
  shiftTypeId,
  target,
  onChange,
  defaultStrength,
}: {
  shiftTypeId: string;
  target: Target | undefined;
  onChange: (t: Target | undefined) => void;
  /** Card #258: the strength a NEW target starts with (staff cards: Hard; Pay-period preferences: Prefer). */
  defaultStrength?: string;
}) {
  const has = !!target;
  const t: Target = target ?? blankTarget(shiftTypeId, defaultStrength);
  const mode = frequencyModeOf(t);
  const isBetween = mode === "between";
  const isDays = t.window === "days";

  // The number shown in the primary input (the cap, for "at most").
  const primary = mode === "atMost" ? t.maxCount ?? 0 : t.minCount ?? 0;
  const upper = t.maxCount ?? Math.max(primary + 1, 1);

  // Preserve the current window selection on every commit; "" / 0 deletes.
  function commit(minCount: number, maxCount: number | null) {
    onChange(committedTarget(t, shiftTypeId, minCount, maxCount));
  }

  function changeStrength(strength: string) {
    if (!target) return;
    onChange({ ...t, strength });
  }

  function changeMode(m: FrequencyMode) {
    // Picking a mode means "set a target": default a meaningful count of 1.
    const a = Math.max(1, primary);
    const b = Math.max(a + 1, upper);
    const { minCount, maxCount } = applyFrequencyMode(m, a, m === "between" ? b : a);
    commit(minCount, maxCount);
  }

  function changePrimary(v: number) {
    const n = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    if (mode === "atMost") {
      commit(0, n);
    } else if (mode === "between") {
      // Keep max >= min.
      commit(n, Math.max(n, upper));
    } else {
      // atLeast / exactly
      commit(n, mode === "exactly" ? n : null);
    }
  }

  function changeUpper(v: number) {
    const n = Number.isFinite(v) ? Math.floor(v) : 0;
    commit(t.minCount ?? 0, Math.max(n, t.minCount ?? 0)); // clamp max >= min
  }

  function changeWindowAmount(v: number) {
    const n = Math.max(1, Number.isFinite(v) ? Math.floor(v) : 1);
    if (!target) return;
    onChange(isDays ? { ...t, windowDays: n } : { ...t, windowCount: n });
  }

  function changeUnit(window: string) {
    if (!target) return;
    onChange({
      ...t,
      window,
      windowDays: window === "days" ? t.windowDays ?? 7 : null,
      windowCount: window === "days" ? 1 : t.windowCount ?? 1,
    });
  }

  const numCls = "w-12 bg-slate-700 text-slate-200 rounded px-1 py-0.5 border border-slate-600 text-center disabled:opacity-40";
  const selCls = "bg-slate-700 text-slate-200 rounded px-1.5 py-0.5 border border-slate-600 disabled:opacity-40";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs flex-wrap">
        {has && (
          <select value={t.strength === "preference" ? "preference" : "rule"} onChange={(e) => changeStrength(e.target.value)} className={selCls} title="Hard or Prefer">
            <option value="rule">Hard</option>
            <option value="preference">Prefer</option>
          </select>
        )}
        <select value={mode} onChange={(e) => changeMode(e.target.value as FrequencyMode)} className={selCls}>
          {MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input
          type="number"
          min={mode === "atMost" ? 0 : 1}
          max={99}
          value={has ? primary : ""}
          placeholder="0"
          onChange={(e) => changePrimary(parseInt(e.target.value) || 0)}
          className={numCls}
        />
        {isBetween && (
          <>
            <span className="text-slate-400">and</span>
            <input
              type="number"
              min={Math.max(1, t.minCount ?? 0)}
              max={99}
              value={upper}
              onChange={(e) => changeUpper(parseInt(e.target.value) || 0)}
              className={numCls}
            />
          </>
        )}
        <span className="text-slate-400">per</span>
        <input
          type="number"
          min={1}
          max={isDays ? 365 : 12}
          value={isDays ? t.windowDays ?? 7 : t.windowCount ?? 1}
          onChange={(e) => changeWindowAmount(parseInt(e.target.value) || 1)}
          disabled={!has}
          title={isDays ? "Rolling window length in days" : "Number of fixed, non-overlapping windows per bucket"}
          className={numCls}
        />
        <select value={t.window} onChange={(e) => changeUnit(e.target.value)} disabled={!has} className={selCls}>
          {UNIT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {has && (
          <button
            onClick={() => onChange(undefined)}
            className="text-slate-500 hover:text-red-400 ml-1"
            title="Clear target"
          >
            ×
          </button>
        )}
      </div>
      {has && <div className="text-[10px] text-slate-400 italic">{describeFrequency(t as ShiftMinTarget)}</div>}
      {has && <div className="text-[10px] text-slate-500">{STRENGTH_HINT[t.strength === "preference" ? "preference" : "rule"]}</div>}
    </div>
  );
}
