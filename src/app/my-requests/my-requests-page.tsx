"use client";

import { useMemo, useState } from "react";
import { describeRequest } from "@/lib/schedule-requests";
import { formatDate, type DateFormatKey } from "@/lib/date-format";

type Kind = "OFF" | "LEAVE" | "NEGATE_SHIFT" | "REQUEST_SHIFT";
type Status = "pending" | "approved" | "declined" | "withdrawn" | "fulfilled";

type RequestRow = {
  id: string;
  providerId: string;
  startDate: string;
  endDate: string;
  kind: Kind;
  shiftTypeIds: string[];
  leaveShiftTypeId: string | null;
  strength: "hard" | "soft";
  status: Status;
  source: string;
  receivedAt: string;
  approvedAt: string | null;
  notes: string | null;
};

type ShiftType = { id: string; code: string; name: string; isLeave: boolean; isOffShift: boolean };

// The four provider-facing templates, mapped to request kinds. Keeps the provider
// out of freeform rambling — they pick a template, dates, and (sometimes) shifts.
const TEMPLATES: { kind: Kind; label: string; hint: string }[] = [
  { kind: "OFF", label: "Time off", hint: "A day (or range) I can't work." },
  { kind: "LEAVE", label: "Leave", hint: "Vacation, sick, etc. — pick the leave type." },
  { kind: "NEGATE_SHIFT", label: "Avoid a shift", hint: "Please don't assign me these shift(s)." },
  { kind: "REQUEST_SHIFT", label: "Request a shift", hint: "I'd like to work these shift(s)." },
];

const STATUS_BADGE: Record<Status, string> = {
  pending: "bg-amber-900/40 text-amber-300 border-amber-700/50",
  approved: "bg-emerald-900/40 text-emerald-300 border-emerald-700/50",
  declined: "bg-rose-900/40 text-rose-300 border-rose-700/50",
  withdrawn: "bg-slate-700/40 text-slate-400 border-slate-600/50",
  fulfilled: "bg-sky-900/40 text-sky-300 border-sky-700/50",
};

function parseDate(s: string): Date {
  return new Date(s + "T00:00:00");
}

export function MyRequestsPage({
  providerName,
  dateFormat,
  shiftTypes,
  initialRequests,
}: {
  providerName: string;
  dateFormat: string;
  shiftTypes: ShiftType[];
  initialRequests: RequestRow[];
}) {
  const fmt = dateFormat as DateFormatKey;
  const codeOf = useMemo(() => {
    const m = new Map(shiftTypes.map((s) => [s.id, s.code]));
    return (id: string) => m.get(id) ?? id;
  }, [shiftTypes]);

  const leaveShifts = useMemo(() => shiftTypes.filter((s) => s.isLeave), [shiftTypes]);
  const workShifts = useMemo(() => shiftTypes.filter((s) => !s.isLeave && !s.isOffShift), [shiftTypes]);

  const [requests, setRequests] = useState(initialRequests);
  const [kind, setKind] = useState<Kind>("OFF");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [leaveShiftTypeId, setLeaveShiftTypeId] = useState("");
  const [shiftTypeIds, setShiftTypeIds] = useState<string[]>([]);
  const [flexible, setFlexible] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState<RequestRow | null>(null);

  const needsShifts = kind === "NEGATE_SHIFT" || kind === "REQUEST_SHIFT";
  const needsLeave = kind === "LEAVE";
  // Leave is inherently firm; the flexible toggle only applies to the others.
  const showFlexible = kind !== "LEAVE";

  function resetForm() {
    setStartDate("");
    setEndDate("");
    setLeaveShiftTypeId("");
    setShiftTypeIds([]);
    setFlexible(false);
    setNotes("");
    setError("");
  }

  function pickKind(k: Kind) {
    setKind(k);
    setLeaveShiftTypeId("");
    setShiftTypeIds([]);
    setError("");
  }

  function toggleShift(id: string) {
    setShiftTypeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setError("");
    if (!startDate) return setError("Pick a start date.");
    if (endDate && endDate < startDate) return setError("End date can't be before the start date.");
    if (needsLeave && !leaveShiftTypeId) return setError("Pick which leave type.");
    if (needsShifts && shiftTypeIds.length === 0) return setError("Pick at least one shift.");

    setSubmitting(true);
    const body = {
      kind,
      startDate,
      endDate: endDate || startDate,
      leaveShiftTypeId: needsLeave ? leaveShiftTypeId : null,
      shiftTypeIds: needsShifts ? shiftTypeIds : [],
      strength: showFlexible && flexible ? "soft" : "hard",
      notes: notes.trim() || null,
    };
    const res = await fetch("/api/my-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not submit your request.");
      return;
    }
    const created: RequestRow = await res.json();
    setRequests((prev) => [created, ...prev]);
    setJustSubmitted(created);
    resetForm();
  }

  async function withdraw(id: string) {
    const res = await fetch("/api/my-requests", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      const updated: RequestRow = await res.json();
      setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
    }
  }

  function dateRangeLabel(r: { startDate: string; endDate: string }) {
    const start = formatDate(parseDate(r.startDate), fmt);
    if (r.startDate === r.endDate) return start;
    return `${start} – ${formatDate(parseDate(r.endDate), fmt)}`;
  }

  // Submission stamp: date + 24h time (matches the /requests audit page).
  function submittedLabel(iso: string) {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${formatDate(d, fmt)} ${hh}:${mm}`;
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-950 text-slate-100">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold">My Requests</h1>
          <p className="text-sm text-slate-400">Submitting as {providerName}.</p>
        </div>

        {justSubmitted && (
          <div className="p-3 rounded border border-emerald-700/50 bg-emerald-900/20 text-sm text-emerald-200">
            Request submitted and timestamped — the scheduler will review it. It now shows as
            <span className="font-medium"> Pending</span> below.
          </div>
        )}

        {/* ── New request form ── */}
        <div className="p-4 rounded border border-slate-700 bg-slate-900 space-y-4">
          <h2 className="text-sm font-medium text-slate-300">New request</h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TEMPLATES.map((t) => {
              const disabled = t.kind === "LEAVE" && leaveShifts.length === 0;
              const active = kind === t.kind;
              return (
                <button
                  key={t.kind}
                  disabled={disabled}
                  onClick={() => pickKind(t.kind)}
                  title={disabled ? "No leave types are configured" : t.hint}
                  className={[
                    "px-3 py-2 rounded border text-sm text-left transition-colors",
                    active ? "border-blue-500 bg-blue-600/20 text-blue-200" : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500",
                    disabled ? "opacity-40 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 -mt-2">{TEMPLATES.find((t) => t.kind === kind)?.hint}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-slate-400 mb-1">Start date</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-slate-400 mb-1">End date <span className="text-slate-600">(optional — same day if blank)</span></span>
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>

          {needsLeave && (
            <label className="block text-sm">
              <span className="block text-xs text-slate-400 mb-1">Leave type</span>
              <select
                value={leaveShiftTypeId}
                onChange={(e) => setLeaveShiftTypeId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Pick leave type —</option>
                {leaveShifts.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            </label>
          )}

          {needsShifts && (
            <div className="text-sm">
              <span className="block text-xs text-slate-400 mb-1">
                {kind === "NEGATE_SHIFT" ? "Shift(s) to avoid" : "Shift(s) wanted"}
              </span>
              <div className="flex flex-wrap gap-2">
                {workShifts.map((s) => {
                  const on = shiftTypeIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleShift(s.id)}
                      className={[
                        "px-2.5 py-1 rounded border text-xs transition-colors",
                        on ? "border-blue-500 bg-blue-600/20 text-blue-200" : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500",
                      ].join(" ")}
                      title={s.name}
                    >
                      {s.code}
                    </button>
                  );
                })}
                {workShifts.length === 0 && <span className="text-xs text-slate-500">No shifts configured.</span>}
              </div>
            </div>
          )}

          {showFlexible && (
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={flexible} onChange={(e) => setFlexible(e.target.checked)} className="accent-blue-500" />
              I&apos;m flexible — treat this as a preference, not a firm request.
            </label>
          )}

          <label className="block text-sm">
            <span className="block text-xs text-slate-400 mb-1">Note <span className="text-slate-600">(optional)</span></span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything the scheduler should know"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-600"
            />
          </label>

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit request"}
            </button>
            <button onClick={resetForm} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
              Clear
            </button>
          </div>
        </div>

        {/* ── Existing requests ── */}
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-slate-300">Your requests</h2>
          {requests.length === 0 && <p className="text-sm text-slate-500">You haven&apos;t made any requests yet.</p>}
          {requests.map((r) => (
            <div key={r.id} className="p-3 rounded border border-slate-800 bg-slate-900/60 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-slate-100">
                  {describeRequest(r, codeOf)}
                  {r.strength === "soft" && <span className="ml-1 text-xs text-slate-500">(preference)</span>}
                </div>
                <div className="text-xs text-slate-400">{dateRangeLabel(r)}</div>
                {r.notes && <div className="text-xs text-slate-500 mt-0.5 truncate">“{r.notes}”</div>}
                <div className="text-[11px] text-slate-600 mt-0.5">
                  Submitted {submittedLabel(r.receivedAt)}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span className={`inline-block text-xs px-2 py-0.5 rounded border capitalize ${STATUS_BADGE[r.status]}`}>
                  {r.status}
                </span>
                {r.status === "pending" && (
                  <button onClick={() => withdraw(r.id)} className="text-xs text-rose-500/70 hover:text-rose-400">
                    Withdraw
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
