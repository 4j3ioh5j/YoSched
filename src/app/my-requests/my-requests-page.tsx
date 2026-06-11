"use client";

import { useEffect, useMemo, useState } from "react";
import { describeRequest, type LeaveQueueSummary } from "@/lib/schedule-requests";
import { formatDate, type DateFormatKey } from "@/lib/date-format";

type Kind = "OFF" | "LEAVE" | "NEGATE_SHIFT" | "REQUEST_SHIFT";
type Status = "pending" | "approved" | "declined" | "withdrawn" | "fulfilled";

type RequestRow = {
  id: string;
  staffId: string;
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

// Two staff-facing categories. Each lets the staff click any number of shifts from
// the Work and Leave/Time-off groups (Request also offers the Off chip). "Request"
// is OR — scheduling any one of the picked shifts satisfies it.
type FormCategory = "REQUEST_SHIFT" | "NEGATE_SHIFT";
const CATEGORIES: { kind: FormCategory; label: string; hint: string }[] = [
  { kind: "REQUEST_SHIFT", label: "Request a shift", hint: "Shift(s) I'd like — work, a leave type, or the day off. Scheduling any one of them satisfies the request." },
  { kind: "NEGATE_SHIFT", label: "Avoid a shift", hint: "Please don't assign me these shift(s)." },
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
  staffName,
  dateFormat,
  maxLeavePerDay,
  shiftTypes,
  initialRequests,
}: {
  staffName: string;
  dateFormat: string;
  maxLeavePerDay: number;
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
  const offShift = useMemo(() => shiftTypes.find((s) => s.isOffShift) ?? null, [shiftTypes]);
  const isAwayId = useMemo(() => {
    const away = new Set(shiftTypes.filter((s) => s.isLeave || s.isOffShift).map((s) => s.id));
    return (id: string) => away.has(id);
  }, [shiftTypes]);

  const [requests, setRequests] = useState(initialRequests);
  const [kind, setKind] = useState<FormCategory>("REQUEST_SHIFT");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [shiftTypeIds, setShiftTypeIds] = useState<string[]>([]);
  const [flexible, setFlexible] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receiptFor, setReceiptFor] = useState<RequestRow | null>(null);
  const [queue, setQueue] = useState<LeaveQueueSummary | null>(null);

  const isRequest = kind === "REQUEST_SHIFT";
  // Time-off / leave chips: leave types, plus the Off shift in the Request category.
  const awayChoices = useMemo(
    () => (isRequest && offShift ? [...leaveShifts, offShift] : leaveShifts),
    [isRequest, offShift, leaveShifts]
  );
  // The queue feedback only makes sense when this is an "away" ask (off/leave picked).
  const requestingAway = isRequest && shiftTypeIds.some(isAwayId);

  // Live leave-queue feedback: how many others are already away over the chosen
  // range, and where this staff would stand. Debounced; counts only (the API
  // never returns identities). Cleared whenever the inputs can't produce one.
  useEffect(() => {
    if (!requestingAway || !startDate) {
      setQueue(null);
      return;
    }
    const end = endDate && endDate >= startDate ? endDate : startDate;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/my-requests/leave-queue?start=${startDate}&end=${end}`);
        if (!res.ok) { if (!cancelled) setQueue(null); return; }
        const data = await res.json();
        if (!cancelled) setQueue(data.summary ?? null);
      } catch {
        if (!cancelled) setQueue(null);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [requestingAway, startDate, endDate]);

  function resetForm() {
    setStartDate("");
    setEndDate("");
    setShiftTypeIds([]);
    setFlexible(false);
    setNotes("");
    setError("");
  }

  function pickKind(k: FormCategory) {
    setKind(k);
    setShiftTypeIds([]); // selections don't carry across categories
    setError("");
  }

  function toggleShift(id: string) {
    setShiftTypeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setError("");
    if (!startDate) return setError("Pick a start date.");
    if (endDate && endDate < startDate) return setError("End date can't be before the start date.");
    if (shiftTypeIds.length === 0) return setError("Pick at least one shift.");

    setSubmitting(true);
    const body = {
      kind,
      startDate,
      endDate: endDate || startDate,
      leaveShiftTypeId: null,
      shiftTypeIds,
      strength: flexible ? "soft" : "hard",
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
    setReceiptFor(created); // show the printable confirmation receipt
    resetForm();
  }

  // Human-readable describe of one request, for the receipt + list.
  function describe(r: RequestRow) {
    return describeRequest(r, codeOf);
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
    <div className="flex-1 overflow-auto bg-slate-950 text-slate-100 print:bg-white print:overflow-visible">
      {/* Page chrome is hidden when printing a receipt (see the overlay below). */}
      <div data-print-hide className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold">My Requests</h1>
          <p className="text-sm text-slate-400">Submitting as {staffName}.</p>
        </div>

        {/* ── New request form ── */}
        <div className="p-4 rounded border border-slate-700 bg-slate-900 space-y-4">
          <h2 className="text-sm font-medium text-slate-300">New request</h2>

          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((t) => {
              const active = kind === t.kind;
              return (
                <button
                  key={t.kind}
                  onClick={() => pickKind(t.kind)}
                  title={t.hint}
                  className={[
                    "px-3 py-2 rounded border text-sm text-left transition-colors",
                    active ? "border-blue-500 bg-blue-600/20 text-blue-200" : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 -mt-2">{CATEGORIES.find((t) => t.kind === kind)?.hint}</p>

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

          {requestingAway && queue && (() => {
            // The new request queues last, so positionOnPeak is also the total off
            // that day if it's granted. Over the soft cap → warn, never block.
            const overCap = maxLeavePerDay > 0 && queue.positionOnPeak > maxLeavePerDay;
            return (
              <div className={`p-2.5 rounded border text-xs ${overCap ? "border-amber-700/50 bg-amber-900/20 text-amber-200" : "border-sky-700/50 bg-sky-900/20 text-sky-200"}`}>
                <span className="font-medium">{queue.othersOnPeak}</span>{" "}
                {queue.othersOnPeak === 1 ? "person has" : "people have"} already requested leave on{" "}
                <span className="font-medium">{formatDate(parseDate(queue.peakDate), fmt)}</span>
                {(endDate || startDate) !== startDate ? " (the busiest day in your range)" : ""}. You&apos;d be{" "}
                <span className="font-medium">#{queue.positionOnPeak}</span> in the queue.
                {overCap && (
                  <> This is over the suggested limit of <span className="font-medium">{maxLeavePerDay}</span> off that day — you can still submit; the scheduler will decide.</>
                )}
              </div>
            );
          })()}

          {(() => {
            // Click any number across both groups; the picks become one request
            // (REQUEST_SHIFT = "any one is fine", NEGATE_SHIFT = "none of these").
            const chip = (s: ShiftType) => {
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
            };
            return (
              <div className="space-y-3 text-sm">
                <div>
                  <span className="block text-xs text-slate-400 mb-1">Work shifts</span>
                  <div className="flex flex-wrap gap-2">
                    {workShifts.map(chip)}
                    {workShifts.length === 0 && <span className="text-xs text-slate-500">No work shifts configured.</span>}
                  </div>
                </div>
                <div>
                  <span className="block text-xs text-slate-400 mb-1">{isRequest ? "Time off / leave" : "Leave"}</span>
                  <div className="flex flex-wrap gap-2">
                    {awayChoices.map(chip)}
                    {awayChoices.length === 0 && <span className="text-xs text-slate-500">No leave types configured.</span>}
                  </div>
                </div>
              </div>
            );
          })()}

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={flexible} onChange={(e) => setFlexible(e.target.checked)} className="accent-blue-500" />
            I&apos;m flexible — treat this as a preference, not a firm request.
          </label>

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
                <button onClick={() => setReceiptFor(r)} className="text-xs text-slate-500 hover:text-slate-300">
                  Receipt
                </button>
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

      {receiptFor && (
        <Receipt
          request={receiptFor}
          staffName={staffName}
          describe={describe}
          dateRangeLabel={dateRangeLabel}
          submittedLabel={submittedLabel}
          onClose={() => setReceiptFor(null)}
        />
      )}
    </div>
  );
}

// Printable confirmation receipt. On screen it's a centered modal; when printing
// the rest of the page is hidden (data-print-hide) so only this prints.
function Receipt({
  request,
  staffName,
  describe,
  dateRangeLabel,
  submittedLabel,
  onClose,
}: {
  request: RequestRow;
  staffName: string;
  describe: (r: RequestRow) => string;
  dateRangeLabel: (r: { startDate: string; endDate: string }) => string;
  submittedLabel: (iso: string) => string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 print:static print:bg-white print:block print:p-0">
      <div className="w-full max-w-md bg-white text-slate-900 rounded-lg shadow-xl p-6 print:shadow-none print:max-w-none">
        <div className="text-center border-b border-slate-200 pb-3 mb-3">
          <div className="text-lg font-bold">Schedule Request — Confirmation</div>
          <div className="text-xs text-slate-500">YoSched</div>
        </div>
        <dl className="text-sm space-y-2">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Staff</dt>
            <dd className="font-medium text-right">{staffName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Request</dt>
            <dd className="font-medium text-right">
              {describe(request)}
              {request.strength === "soft" && <span className="text-slate-500"> (preference)</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Date(s)</dt>
            <dd className="font-medium text-right">{dateRangeLabel(request)}</dd>
          </div>
          {request.notes && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Note</dt>
              <dd className="text-right">{request.notes}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Status</dt>
            <dd className="font-medium text-right capitalize">{request.status}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Submitted</dt>
            <dd className="font-medium text-right">{submittedLabel(request.receivedAt)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Reference</dt>
            <dd className="font-mono text-xs text-right break-all">{request.id}</dd>
          </div>
        </dl>
        <div data-print-hide className="flex gap-2 justify-end mt-5">
          <button onClick={() => window.print()} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded">
            Print
          </button>
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
