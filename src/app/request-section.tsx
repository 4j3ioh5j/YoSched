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
  targetCount: number; // providers the request will apply to
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

function markGlyph(m: { polarity: "accept" | "negate"; strength: RequestStrength }) {
  return { sign: m.polarity === "negate" ? "✗" : "○", faint: m.strength === "soft" };
}

/** The "make a request" controls — embedded as a section inside the cell picker.
 *  Click a work shift = ○ want (Shift = ✗ won't, Alt = soft); OFF / leave too. */
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
        Request{targetCount > 1 ? ` · ${targetCount} providers` : ""}
      </div>

      <div className="grid grid-cols-3 gap-0.5">
        {workShifts.map((st) => {
          const mark = shiftMarks.get(st.id);
          const g = mark ? markGlyph(mark) : null;
          return (
            <button
              key={st.id}
              onClick={(e) => toggleShift(st.id, e)}
              className={[
                "px-2 py-1.5 text-xs font-bold rounded text-center transition-colors relative",
                mark ? "ring-2 ring-violet-400/70" : "",
              ].join(" ")}
              style={{ backgroundColor: st.color + "30", color: st.color }}
              title={st.name}
            >
              {st.code}
              {g && (
                <span
                  className={`absolute -top-1 -right-1 text-[11px] leading-none rounded-full px-0.5 bg-slate-900 ${
                    mark!.polarity === "negate" ? "text-red-400" : "text-emerald-400"
                  } ${g.faint ? "opacity-50" : ""}`}
                >
                  {g.sign}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {leaveShifts.length > 0 && (
        <div className="grid grid-cols-3 gap-0.5 mt-0.5">
          {leaveShifts.map((st) => (
            <button
              key={st.id}
              onClick={() => toggleLeave(st.id)}
              className={[
                "px-2 py-1.5 text-xs font-bold rounded text-center transition-colors",
                leaveIds.has(st.id) ? "ring-2 ring-violet-400/70" : "",
              ].join(" ")}
              style={{ backgroundColor: st.color + "30", color: st.color }}
              title={`${st.name} (leave)`}
            >
              {st.code}
            </button>
          ))}
        </div>
      )}

      {offShift && (
        <button
          onClick={(e) => toggleOff(e)}
          className={[
            "w-full mt-0.5 px-2 py-1.5 text-xs font-bold rounded text-center text-slate-300 bg-slate-700/50 hover:bg-slate-600/50 transition-colors",
            offStrength ? "ring-2 ring-violet-400/70" : "",
          ].join(" ")}
        >
          OFF{offStrength === "soft" ? " (prefer)" : ""}
        </button>
      )}

      <div className="text-[9px] text-slate-500 px-1 pt-1 leading-snug">
        click ○ want · <span className="text-slate-400">Shift</span> ✗ won&apos;t ·{" "}
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
