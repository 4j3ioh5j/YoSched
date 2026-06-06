"use client";

import { useEffect, useRef, useState } from "react";
import type { Warning } from "@/lib/constraints";
import type { PickerMarks } from "@/lib/schedule-requests";
import { RequestSection } from "./request-section";

type ShiftType = {
  id: string;
  code: string;
  name: string;
  color: string;
  category: string;
  isLeave: boolean;
  isOffShift: boolean;
};

// A cell's existing request, shown at the top of the picker with a delete button.
export type ExistingRequest = { id: string; label: string; pending: boolean };

type Props = {
  shiftTypes: ShiftType[];
  currentShiftTypeId: string | null;
  position: { x: number; y: number };
  onSelect: (shiftTypeId: string) => void;
  onClear: () => void;
  onClose: () => void;
  warnings?: Map<string, Warning[]>;
  bulkCount?: number;
  // Request controls (unified picker). When onSaveRequest is set, the picker
  // also shows the "Request" section and any existing requests on this cell.
  existingRequests?: ExistingRequest[];
  onDeleteRequest?: (id: string) => void;
  onSaveRequest?: (marks: PickerMarks) => void;
  requestTargetCount?: number;
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

export function ShiftPicker({ shiftTypes, currentShiftTypeId, position, onSelect, onClear, onClose, warnings, bulkCount, existingRequests, onDeleteRequest, onSaveRequest, requestTargetCount }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"assign" | "request">("assign");

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

  // Keep the whole popover inside the viewport (clamp, not just flip) so it never
  // opens partly off-screen or with its bottom (Save) below the edge — important
  // on iPad where the popover can be tall and the tap can be near an edge.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = position.x + 12;
    let top = position.y + 12;
    if (left + rect.width > vw - margin) left = position.x - rect.width - 12; // flip left
    left = Math.min(Math.max(margin, left), Math.max(margin, vw - rect.width - margin));
    if (top + rect.height > vh - margin) top = position.y - rect.height - 12; // flip up
    top = Math.min(Math.max(margin, top), Math.max(margin, vh - rect.height - margin));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [position, tab, existingRequests]);

  const workShifts = shiftTypes.filter((s) => s.category === "work");
  const leaveShifts = shiftTypes.filter((s) => s.category === "leave");
  const offShift = shiftTypes.find((s) => s.isOffShift);

  // Assign vs Request — a tab so the request controls are discoverable rather
  // than buried below the assign grid. Tabs only show when requests are enabled.
  const showRequest = !!onSaveRequest;

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-2 min-w-[200px] max-h-[85dvh] overflow-y-auto"
      style={{ left: position.x + 12, top: position.y + 12 }}
    >
      {showRequest && (
        <div className="flex gap-1 mb-1 pb-1 border-b border-slate-700">
          <button
            onClick={() => setTab("assign")}
            className={[
              "flex-1 px-2 py-1 text-xs font-semibold rounded transition-colors",
              tab === "assign" ? "bg-slate-600 text-white" : "text-slate-400 hover:text-slate-200",
            ].join(" ")}
          >
            Assign
          </button>
          <button
            onClick={() => setTab("request")}
            className={[
              "flex-1 px-2 py-1 text-xs font-semibold rounded transition-colors",
              tab === "request" ? "bg-violet-600 text-white" : "text-violet-300 hover:text-violet-200",
            ].join(" ")}
          >
            Request
          </button>
        </div>
      )}

      {/* A cell's existing requests — always visible so they can be deleted. */}
      {existingRequests && existingRequests.length > 0 && (
        <div className="border-b border-slate-700 mb-1 pb-1">
          <div className="text-[10px] uppercase tracking-wider text-violet-300 px-2 py-0.5">On this day</div>
          {existingRequests.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 px-2 py-0.5 text-xs">
              <span className={r.pending ? "text-slate-400" : "text-slate-200"}>
                {r.label}
                {r.pending && <span className="text-[9px] text-amber-400 ml-1">pending</span>}
              </span>
              {onDeleteRequest && (
                <button
                  onClick={() => onDeleteRequest(r.id)}
                  className="text-slate-500 hover:text-red-400 text-sm leading-none px-1"
                  title="Delete request"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "assign" || !showRequest ? (
        <>
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
        </>
      ) : (
        <RequestSection shiftTypes={shiftTypes} targetCount={requestTargetCount ?? 1} onSave={onSaveRequest} />
      )}
    </div>
  );
}
