"use client";

import { useEffect, useRef } from "react";
import type { Warning } from "@/lib/constraints";

type ShiftType = {
  id: string;
  code: string;
  name: string;
  color: string;
  category: string;
  isLeave: boolean;
};

type Props = {
  shiftTypes: ShiftType[];
  currentShiftTypeId: string | null;
  position: { x: number; y: number };
  onSelect: (shiftTypeId: string) => void;
  onClear: () => void;
  onClose: () => void;
  warnings?: Map<string, Warning[]>;
  bulkCount?: number;
};

function ShiftButton({
  st,
  isCurrent,
  warnings,
  onSelect,
}: {
  st: ShiftType;
  isCurrent: boolean;
  warnings?: Warning[];
  onSelect: (id: string) => void;
}) {
  const hasWarning = warnings && warnings.length > 0;
  const hasError = warnings?.some((w) => w.type === "post-shift" || w.type === "over-hours");

  return (
    <button
      onClick={() => onSelect(st.id)}
      className={[
        "px-2 py-1.5 text-xs font-bold rounded text-center transition-colors relative",
        isCurrent ? "ring-2 ring-white/50" : "",
      ].join(" ")}
      style={{
        backgroundColor: st.color + "30",
        color: st.color,
      }}
      title={hasWarning ? warnings!.map((w) => w.message).join("\n") : st.name}
    >
      {st.code}
      {hasWarning && (
        <span
          className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${hasError ? "bg-red-500" : "bg-amber-500"}`}
        />
      )}
    </button>
  );
}

export function ShiftPicker({ shiftTypes, currentShiftTypeId, position, onSelect, onClear, onClose, warnings, bulkCount }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) {
      ref.current.style.left = `${position.x - rect.width - 12}px`;
    }
    if (rect.bottom > vh) {
      ref.current.style.top = `${position.y - rect.height - 12}px`;
    }
  }, [position]);

  const workShifts = shiftTypes.filter((s) => s.category === "work");
  const leaveShifts = shiftTypes.filter((s) => s.category === "leave");
  const offShift = shiftTypes.find((s) => s.code === "X");

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-2 min-w-[200px] max-h-[400px] overflow-y-auto"
      style={{ left: position.x + 12, top: position.y + 12 }}
    >
      {bulkCount && (
        <div className="text-[10px] font-semibold text-emerald-400 px-2 py-1 border-b border-slate-700 mb-1">
          Assign {bulkCount} cells
        </div>
      )}
      <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 py-1">Work</div>
      <div className="grid grid-cols-3 gap-0.5">
        {workShifts.map((st) => (
          <ShiftButton
            key={st.id}
            st={st}
            isCurrent={st.id === currentShiftTypeId}
            warnings={warnings?.get(st.id)}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 py-1 mt-1">Leave</div>
      <div className="grid grid-cols-3 gap-0.5">
        {leaveShifts.map((st) => (
          <ShiftButton
            key={st.id}
            st={st}
            isCurrent={st.id === currentShiftTypeId}
            warnings={warnings?.get(st.id)}
            onSelect={onSelect}
          />
        ))}
      </div>

      {offShift && (
        <div className="border-t border-slate-700 mt-2 pt-1">
          <button
            onClick={() => onSelect(offShift.id)}
            className={[
              "w-full px-2 py-1.5 text-xs font-bold rounded text-center text-slate-400 bg-slate-700/50 hover:bg-slate-600/50 transition-colors",
              offShift.id === currentShiftTypeId ? "ring-2 ring-white/50" : "",
            ].join(" ")}
          >
            OFF
          </button>
        </div>
      )}
      {(currentShiftTypeId || bulkCount) && (
        <div className="border-t border-slate-700 mt-1 pt-1">
          <button
            onClick={onClear}
            className="w-full px-2 py-1.5 text-xs text-red-400 hover:bg-red-900/30 rounded transition-colors"
          >
            {bulkCount ? `Clear ${bulkCount} cells` : "Clear"}
          </button>
        </div>
      )}
    </div>
  );
}
