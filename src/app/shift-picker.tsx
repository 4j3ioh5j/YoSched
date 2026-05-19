"use client";

import { useEffect, useRef } from "react";

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
};

export function ShiftPicker({ shiftTypes, currentShiftTypeId, position, onSelect, onClear, onClose }: Props) {
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
      ref.current.style.left = `${position.x - rect.width}px`;
    }
    if (rect.bottom > vh) {
      ref.current.style.top = `${position.y - rect.height}px`;
    }
  }, [position]);

  const workShifts = shiftTypes.filter((s) => s.category === "work");
  const leaveShifts = shiftTypes.filter((s) => s.category === "leave");

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-2 min-w-[180px] max-h-[400px] overflow-y-auto"
      style={{ left: position.x, top: position.y }}
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 py-1">Work</div>
      <div className="grid grid-cols-3 gap-0.5">
        {workShifts.map((st) => (
          <button
            key={st.id}
            onClick={() => onSelect(st.id)}
            className={[
              "px-2 py-1.5 text-xs font-bold rounded text-center transition-colors",
              st.id === currentShiftTypeId ? "ring-2 ring-white/50" : "",
            ].join(" ")}
            style={{
              backgroundColor: st.color + "30",
              color: st.color,
            }}
            title={st.name}
          >
            {st.code}
          </button>
        ))}
      </div>

      <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 py-1 mt-1">Leave</div>
      <div className="grid grid-cols-3 gap-0.5">
        {leaveShifts.map((st) => (
          <button
            key={st.id}
            onClick={() => onSelect(st.id)}
            className={[
              "px-2 py-1.5 text-xs font-bold rounded text-center transition-colors",
              st.id === currentShiftTypeId ? "ring-2 ring-white/50" : "",
            ].join(" ")}
            style={{
              backgroundColor: st.color + "30",
              color: st.color,
            }}
            title={st.name}
          >
            {st.code}
          </button>
        ))}
      </div>

      {currentShiftTypeId && (
        <>
          <div className="border-t border-slate-700 mt-2 pt-1">
            <button
              onClick={onClear}
              className="w-full px-2 py-1.5 text-xs text-red-400 hover:bg-red-900/30 rounded transition-colors"
            >
              Clear
            </button>
          </div>
        </>
      )}
    </div>
  );
}
