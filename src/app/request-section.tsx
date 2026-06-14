"use client";

import { useState } from "react";
import type { PickerMarks, ShiftMark, RequestStrength } from "@/lib/schedule-requests";

type ShiftType = {
  id: string;
  code: string;
  name: string;
  color: string;
  category: string;
  isLeave: boolean;
  isOffShift: boolean;
};

type Props = {
  shiftTypes: ShiftType[];
  targetCount: number; // staff the request will apply to
  onSave: (marks: PickerMarks) => void;
};

// Polarity/strength implied by the modifiers held during a click.
function markFromEvent(e: { shiftKey: boolean; altKey: boolean }): {
  polarity: "accept" | "negate";
  strength: RequestStrength;
} {
  return {
    polarity: e.shiftKey ? "negate" : "accept",
    strength: e.altKey ? "soft" : "hard",
  };
}

// Border-only styling that mirrors how a request looks on the schedule grid
// (colored ring, NO background fill) so the Request tab reads instantly as the
// request surface vs the filled Assign tab. Want = emerald, avoid = rose,
// soft = faint border (matches the grid's pending/soft faint ring).
function workMarkClass(mark: ShiftMark | undefined): string {
  if (!mark) return "border border-slate-600 hover:border-slate-400";
  const faint = mark.strength === "soft";
  if (mark.polarity === "negate") return faint ? "border-2 border-rose-400/40 text-rose-300" : "border-2 border-rose-400 text-rose-300";
  return faint ? "border-2 border-emerald-400/40 text-emerald-300" : "border-2 border-emerald-400 text-emerald-300";
}

/** The "make a request" controls — embedded as a section inside the cell picker.
 *  Click a work shift = want (Shift = avoid, Alt = soft); OFF / leave too. */
export function RequestSection({ shiftTypes, targetCount, onSave }: Props) {
  const [shiftMarks, setShiftMarks] = useState<Map<string, ShiftMark>>(new Map());
  const [offStrength, setOffStrength] = useState<RequestStrength | null>(null);
  const [leaveIds, setLeaveIds] = useState<Set<string>>(new Set());

  function toggleShift(id: string, e: React.MouseEvent) {
    const next = markFromEvent(e);
    setShiftMarks((prev) => {
      const m = new Map(prev);
      const cur = m.get(id);
      if (cur && cur.polarity === next.polarity && cur.strength === next.strength) m.delete(id);
      else m.set(id, { shiftTypeId: id, ...next });
      return m;
    });
  }
  function toggleOff(e: React.MouseEvent) {
    const strength: RequestStrength = e.altKey ? "soft" : "hard";
    setOffStrength((cur) => (cur === strength ? null : strength));
  }
  function toggleLeave(id: string) {
    setLeaveIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  const workShifts = shiftTypes.filter((s) => s.category === "work");
  const leaveShifts = shiftTypes.filter((s) => s.category === "leave" && !s.isOffShift);
  const offShift = shiftTypes.find((s) => s.isOffShift);
  const markedCount = shiftMarks.size + (offStrength ? 1 : 0) + leaveIds.size;

  function save() {
    if (markedCount === 0) return;
    onSave({ shiftMarks: [...shiftMarks.values()], offStrength, leaveShiftTypeIds: [...leaveIds] });
  }

  return (
    <div className="border-t border-slate-700 mt-2 pt-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-300 px-1 py-0.5">
        Request{targetCount > 1 ? ` · ${targetCount} staff` : ""}
      </div>

      {/* Same Work / Leave / OFF layout as the Assign tab, but every control is
          rendered border-only (no fill) in the request category colors so the
          tab is unmistakably the request surface. */}
      <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 py-1">Work</div>
      <div className="grid grid-cols-3 gap-0.5">
        {workShifts.map((st) => {
          const mark = shiftMarks.get(st.id);
          return (
            <button
              key={st.id}
              onClick={(e) => toggleShift(st.id, e)}
              className={[
                "px-2 py-1.5 text-xs font-bold rounded text-center transition-colors bg-transparent",
                workMarkClass(mark),
              ].join(" ")}
              style={mark ? undefined : { color: st.color }}
              title={st.name}
            >
              {st.code}
            </button>
          );
        })}
      </div>

      {leaveShifts.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 py-1 mt-1">Leave</div>
          <div className="grid grid-cols-3 gap-0.5">
            {leaveShifts.map((st) => {
              const on = leaveIds.has(st.id);
              return (
                <button
                  key={st.id}
                  onClick={() => toggleLeave(st.id)}
                  className={[
                    "px-2 py-1.5 text-xs font-bold rounded text-center transition-colors bg-transparent",
                    on ? "border-2 border-amber-400 text-amber-300" : "border border-slate-600 hover:border-slate-400",
                  ].join(" ")}
                  style={on ? undefined : { color: st.color }}
                  title={`${st.name} (leave)`}
                >
                  {st.code}
                </button>
              );
            })}
          </div>
        </>
      )}

      {offShift && (
        <div className="border-t border-slate-700 mt-2 pt-1">
          <button
            onClick={(e) => toggleOff(e)}
            className={[
              "w-full px-2 py-1.5 text-xs font-bold rounded text-center transition-colors bg-transparent",
              offStrength === "hard" ? "border-2 border-sky-400 text-sky-300"
              : offStrength === "soft" ? "border-2 border-sky-400/40 text-sky-300"
              : "border border-slate-600 text-slate-400 hover:border-slate-400",
            ].join(" ")}
          >
            OFF{offStrength === "soft" ? " (prefer)" : ""}
          </button>
        </div>
      )}

      <div className="text-[9px] text-slate-500 px-1 pt-1 leading-snug">
        click <span className="text-emerald-400">want</span> ·{" "}
        <span className="text-slate-400">Shift</span> <span className="text-rose-400">avoid</span> ·{" "}
        <span className="text-slate-400">Alt</span> soft
      </div>

      <button
        onClick={save}
        disabled={markedCount === 0}
        className="w-full mt-1 px-2 py-1.5 text-xs font-semibold rounded transition-colors bg-violet-600/80 hover:bg-violet-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Save request{markedCount > 1 ? `s (${markedCount})` : ""}
      </button>
    </div>
  );
}
