"use client";

import { useTimeZone } from "@/app/time-zone-provider";
import { formatDateTimeZoned } from "@/lib/time-zone";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { describeRequest, describeOffStrategy, type RequestKind, type RequestStrength } from "@/lib/schedule-requests";
import { formatDate, type DateFormatKey, DEFAULT_DATE_FORMAT } from "@/lib/date-format";
import { filterAndSortRequests, type RequestSort, type RequestSortKey } from "@/lib/request-list";
import { groupRequestLines, isArchivedDay, type ArchiveLeaveRule, type LinePart, type PartOutcome, type RequestLine, type ShiftFacts } from "@/lib/request-lines";

type RequestStatus = "pending" | "approved" | "declined" | "withdrawn" | "fulfilled";

type RequestRow = {
  id: string;
  staffId: string;
  startDate: string;
  endDate: string;
  kind: RequestKind;
  shiftTypeIds: string[];
  leaveShiftTypeId: string | null;
  strength: RequestStrength;
  status: RequestStatus;
  source: string;
  offStrategyOrder: string[];
  receivedAt: string;
  approvedAt: string | null;
  approverLabel: string | null; // resolved server-side; never a raw user id
  notes: string | null;
  // Card #67: a pending request whose approval could not be honoured without breaking a
  // hard rule carries the server's sentence — shown as "Needs resolving".
  flaggedReason?: string | null;
};

type Props = {
  canEdit: boolean;
  requests: RequestRow[];
  staffName: Record<string, { initials: string; name: string }>;
  shiftCode: Record<string, string>;
  dateFormat: string;
  // Card #332: what the Archive needs (computed server-side in the Settings time zone).
  archive: {
    today: string;
    archiveDays: number;
    leaveRule: ArchiveLeaveRule;
    months: string[];
    month: string | null;
    cells: Record<string, string>; // "staffId|date" → shift id, the selected archive month only
    notes: Record<string, string>; // "staffId|date" → note
    shiftFacts: Record<string, ShiftFacts>;
    opened: boolean; // the page was opened on the Archive (?archive=…)
  };
};

const STATUS_FILTERS: (RequestStatus | "all")[] = ["all", "pending", "approved", "declined", "withdrawn", "fulfilled"];

// Sortable header columns in render order (matches the table body cells).
const SORTABLE_COLUMNS: { key: RequestSortKey; label: string }[] = [
  { key: "staff", label: "Staff" },
  { key: "dates", label: "Dates" },
  { key: "request", label: "Request" },
  { key: "status", label: "Status" },
  { key: "source", label: "Source" },
  { key: "received", label: "Received" },
  { key: "approved", label: "Approved" },
];

const STATUS_BADGE: Record<RequestStatus, string> = {
  pending: "bg-amber-900/40 text-amber-300 border-amber-700/50",
  approved: "bg-emerald-900/40 text-emerald-300 border-emerald-700/50",
  declined: "bg-rose-900/40 text-rose-300 border-rose-700/50",
  withdrawn: "bg-slate-700/50 text-slate-400 border-slate-600/50",
  fulfilled: "bg-sky-900/40 text-sky-300 border-sky-700/50",
};

const OUTCOME_BADGE: Record<PartOutcome, string> = {
  met: "bg-emerald-900/40 text-emerald-300 border-emerald-700/50",
  unmet: "bg-rose-900/40 text-rose-300 border-rose-700/50",
  withdrawn: "bg-slate-700/50 text-slate-400 border-slate-600/50",
};
const OUTCOME_LABEL: Record<PartOutcome, string> = { met: "Met", unmet: "Not met", withdrawn: "Withdrawn" };

export function RequestsPage({ canEdit, requests: initial, staffName, shiftCode, dateFormat: dfProp, archive }: Props) {
  const [requests, setRequests] = useState(initial);
  const [filter, setFilter] = useState<RequestStatus | "all">("all");
  // Card #332: Current (this and future months) or Archive (finished months). Opening the page
  // with ?archive=… (the month picker) shows the Archive.
  const [view, setView] = useState<"current" | "archive">(archive.opened ? "archive" : "current");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // After an unapprove/reopen, the days the request STILL satisfies via a shift it
  // didn't place (auto/manual). Such a pending request silently re-approves on the
  // next reconcile, so we offer to clear the shift too.
  const [stillPrompt, setStillPrompt] = useState<{ staffId: string; cells: { date: string; code: string }[] } | null>(null);
  // Client-side, session-only (no persistence, no server round-trip).
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<RequestSort | null>(null);
  const df = (dfProp || DEFAULT_DATE_FORMAT) as DateFormatKey;
  const { zone } = useTimeZone();
  const router = useRouter();

  // Adopt fresh server data after a router.refresh() (below) or any navigation
  // that re-runs the force-dynamic loader. useState(initial) freezes the first
  // array, so without this the inbox never reflects status changes made elsewhere
  // — e.g. a schedule assignment honoring/un-honoring a request (the backend
  // already writes the new status via syncRequestApprovals). page.tsx builds a NEW
  // requests array every render, so a changed identity means genuinely fresh data
  // (the hydration render keeps the same ref → no spurious reset). Defer adoption
  // while a mutation is in flight so it can't clobber an optimistic row; crucially
  // we DON'T advance adoptedRef until we actually adopt, so a refresh that lands
  // mid-mutation isn't lost — busyId in the deps re-runs this once it clears.
  const adoptedRef = useRef(initial);
  useEffect(() => {
    if (initial === adoptedRef.current) return;
    if (busyId) return; // a mutation is in flight; adopt once it settles
    adoptedRef.current = initial;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt fresh server data once no mutation is in flight (see above)
    setRequests(initial);
  }, [initial, busyId]);

  // Revalidate on focus/visibility (SWR revalidateOnFocus-style): when the admin
  // assigns on the schedule page and returns to this tab, pull fresh status with no
  // manual reload. Debounced so focus + visibilitychange — which fire together —
  // coalesce into a single refresh; the short trailing delay also catches an
  // assignment write that finishes just after the tab refocuses.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 200);
    };
    document.addEventListener("visibilitychange", scheduleRefresh);
    window.addEventListener("focus", scheduleRefresh);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", scheduleRefresh);
      window.removeEventListener("focus", scheduleRefresh);
    };
  }, [router]);

  const codeOf = (id: string) => shiftCode[id] ?? id;
  // Date-only (for the requested start/end @db.Date values).
  const fmt = (iso: string) => formatDate(new Date(iso.slice(0, 10) + "T12:00:00"), df);
  // Date + 24h time, for the received/approved audit timestamps.
  // Card #320: in the Settings time zone, with its label.
  const fmtDateTime = (iso: string) => formatDateTimeZoned(new Date(iso), zone, df);

  // Latest list for the sequential part actions (each awaits the server before the next).
  const requestsRef = useRef(requests);
  useEffect(() => { requestsRef.current = requests; }, [requests]);
  const byId = useMemo(() => new Map(requests.map((r) => [r.id, r])), [requests]);

  // Card #332: notes on archived lines, keyed "staffId|date". Adopt fresh server data like the list.
  const [notes, setNotes] = useState(archive.notes);
  const [notesFrom, setNotesFrom] = useState(archive.notes);
  if (notesFrom !== archive.notes) {
    setNotesFrom(archive.notes);
    setNotes(archive.notes);
  }
  const [noteEdit, setNoteEdit] = useState<{ key: string; staffId: string; dates: string[]; text: string } | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);

  // Days are archived once their month is over (plus the Settings wait); computed, never stored.
  const currentLines = useMemo(
    () => groupRequestLines(requests, { includeDate: (d) => !isArchivedDay(d, archive.today, archive.archiveDays) }),
    [requests, archive.today, archive.archiveDays],
  );
  const archiveLines = useMemo(() => {
    const month = archive.month;
    if (!month) return [];
    return groupRequestLines(requests, {
      includeDate: (d) => d.startsWith(month + "-") && isArchivedDay(d, archive.today, archive.archiveDays),
      archived: {
        cellOf: (staffId, date) => archive.cells[`${staffId}|${date}`] ?? null,
        factsOf: (id) => archive.shiftFacts[id],
        rule: archive.leaveRule,
      },
    });
  }, [requests, archive]);
  const lines = view === "archive" ? archiveLines : currentLines;

  const partRequests = (p: LinePart) => p.requestIds.map((id) => byId.get(id)).filter((r): r is RequestRow => !!r);
  const lineRequests = (l: RequestLine) => l.parts.flatMap(partRequests);
  const describePart = (p: LinePart) => describeRequest(p, codeOf);
  const gotText = (l: RequestLine) => (l.got === undefined ? "" : l.got === null ? "nothing scheduled" : `got ${codeOf(l.got)}`);
  const lineNote = (l: RequestLine): { text: string | null; differ: boolean } => {
    const vals = l.dates.map((d) => notes[`${l.staffId}|${d}`] ?? null);
    const first = vals[0];
    return vals.every((v) => v === first) ? { text: first, differ: false } : { text: null, differ: true };
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: currentLines.length };
    for (const l of currentLines) for (const st of new Set(l.parts.map((p) => p.status))) c[st] = (c[st] ?? 0) + 1;
    return c;
  }, [currentLines]);

  // Click a header to sort by it (ascending); click the same header again to
  // reverse the direction. A different header always starts ascending.
  function toggleSort(key: RequestSortKey) {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  // Status tab (current list: a line with any part of that status) → pure search + sort
  // (lib/request-list). Each line is projected with the same display helpers that render it.
  const rows = useMemo(() => {
    const statusFiltered = view === "archive" || filter === "all" ? lines : lines.filter((l) => l.parts.some((p) => p.status === filter));
    const ordered = [...statusFiltered].sort((a, b) => a.startDate.localeCompare(b.startDate) || (staffName[a.staffId]?.name ?? "").localeCompare(staffName[b.staffId]?.name ?? ""));
    return filterAndSortRequests(
      ordered,
      (l) => {
        const prov = staffName[l.staffId];
        const reqs = lineRequests(l);
        const received = reqs.map((r) => r.receivedAt).sort().at(-1) ?? "";
        const approved = reqs.map((r) => r.approvedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
        const note = lineNote(l);
        const haystack = [
          prov?.name,
          prov?.initials,
          lineDates(l),
          ...l.parts.map((p) => `${describePart(p)} ${p.status} ${p.outcome === "unmet" ? "not met" : p.outcome ?? ""}`),
          ...reqs.map((r) => [r.offStrategyOrder.map((t) => describeOffStrategy(t, codeOf)).join(" "), r.strength === "soft" ? "soft" : "", r.notes, r.source, r.approverLabel ? `by ${r.approverLabel}` : ""].join(" ")),
          gotText(l),
          note.text,
          fmtDateTime(received),
          approved ? fmtDateTime(approved) : "",
        ]
          .filter(Boolean)
          .join(" ");
        return {
          staff: prov?.name ?? "",
          startDate: l.startDate,
          endDate: l.endDate,
          request: l.parts.map(describePart).join(" · "),
          // Rank by the status-tab order (pending → … → fulfilled), not alphabetical.
          statusRank: Math.min(...l.parts.map((p) => STATUS_FILTERS.indexOf(p.status))),
          source: [...new Set(reqs.map((r) => r.source))].sort().join(", "),
          receivedAt: received,
          approvedAt: approved,
          haystack,
        };
      },
      { query: search, sort },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, view, filter, search, sort, staffName, shiftCode, df, notes, byId]);

  // Card #332: one button acts on every request behind a part, one after another.
  async function runPart(p: LinePart, status: RequestStatus | "delete") {
    for (const id of [...p.requestIds]) {
      if (status === "delete") await remove(id);
      else await patchStatus(id, status);
    }
  }

  // A part's requests that also cover days outside this line (the action acts on the whole request).
  function alsoCovers(l: RequestLine, p: LinePart): string {
    const outside = partRequests(p).filter((r) => r.startDate < l.startDate || r.endDate > l.endDate);
    if (outside.length === 0) return "";
    return ` — acts on the whole request${outside.length > 1 ? "s" : ""}: ${outside.map((r) => dateRangeOf(r.startDate, r.endDate)).join("; ")}`;
  }

  async function saveNote() {
    if (!noteEdit) return;
    const edit = noteEdit;
    setNoteBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/request-day-notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: edit.staffId, dates: edit.dates, note: edit.text.trim() || null }),
      });
      if (!res.ok) {
        const msg = await res.json().then((j) => j?.error).catch(() => null);
        setError(typeof msg === "string" ? msg : "Failed to save the note.");
        return;
      }
      const saved: { note: string | null } = await res.json();
      // Keyed by person and day, so a late answer lands on the right days whatever is shown now.
      setNotes((n) => {
        const next = { ...n };
        for (const d of edit.dates) {
          if (saved.note) next[`${edit.staffId}|${d}`] = saved.note;
          else delete next[`${edit.staffId}|${d}`];
        }
        return next;
      });
      setNoteEdit((cur) => (cur?.key === edit.key ? null : cur));
    } catch {
      setError("Failed to save the note.");
    } finally {
      setNoteBusy(false);
    }
  }

  function pickMonth(m: string) {
    router.push(`/requests?archive=${encodeURIComponent(m)}`);
  }
  async function patchStatus(id: string, status: RequestStatus) {
    setBusyId(id);
    setError(null);
    // Per-row rollback: a part action runs several requests in a row, so a failure must undo only its own row.
    const prevRow = requestsRef.current.find((r) => r.id === id);
    const rollback = () => { if (prevRow) setRequests((rs) => rs.map((r) => (r.id === id ? prevRow : r))); };
    // Optimistic.
    setRequests((rs) =>
      rs.map((r) =>
        r.id === id
          ? { ...r, status, approvedAt: status === "approved" ? new Date().toISOString() : null, approverLabel: status === "approved" ? "you" : null }
          : r,
      ),
    );
    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        rollback();
        setError("Failed to update request.");
      } else {
        const updated = await res.json();
        if (updated.flagged) {
          // Card #67: not placed — the request stays pending, marked "needs resolving".
          const why: string = typeof updated.flaggedReason === "string" ? updated.flaggedReason : "the day is full";
          setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, status: "pending", approvedAt: null, approverLabel: null, flaggedReason: why } : r)));
          setError(`Not approved — ${why}.`);
          return;
        }
        setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, status: updated.status, approvedAt: updated.approvedAt, flaggedReason: updated.flaggedReason ?? null } : r)));
        // Unapproved/reopened but a non-request shift still sits on the cell → it
        // will re-approve unless that shift is cleared. Offer the one-click fix.
        const still = updated.stillScheduled as { date: string; shiftTypeId: string; code: string }[] | undefined;
        if (status === "pending" && still && still.length > 0) {
          setStillPrompt({ staffId: prevRow?.staffId ?? "", cells: still.map((s) => ({ date: s.date, code: s.code })) });
        }
      }
    } catch {
      rollback();
      setError("Failed to update request.");
    } finally {
      setBusyId(null);
    }
  }

  // Clear the leftover shift(s) a just-unapproved request still satisfies, so it
  // won't silently re-approve. A plain assignment delete on each (staff, day).
  async function clearStillScheduled() {
    if (!stillPrompt) return;
    setBusyId("still");
    setError(null);
    try {
      const results = await Promise.all(
        stillPrompt.cells.map((c) =>
          fetch("/api/assignments", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ staffId: stillPrompt.staffId, date: c.date }),
          }).then((r) => r.ok).catch(() => false),
        ),
      );
      if (results.some((ok) => !ok)) setError("Some shifts couldn't be cleared.");
      setStillPrompt(null);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    const prevRow = requestsRef.current.find((r) => r.id === id);
    const prevIndex = requestsRef.current.findIndex((r) => r.id === id);
    const rollback = () => {
      if (!prevRow) return;
      setRequests((rs) => (rs.some((r) => r.id === id) ? rs : [...rs.slice(0, prevIndex), prevRow, ...rs.slice(prevIndex)]));
    };
    setRequests((rs) => rs.filter((r) => r.id !== id));
    try {
      const res = await fetch(`/api/requests/${id}`, { method: "DELETE" });
      if (!res.ok) {
        rollback();
        setError("Failed to delete request.");
      }
    } catch {
      rollback();
      setError("Failed to delete request.");
    } finally {
      setBusyId(null);
    }
  }

  function dateRangeOf(start: string, end: string) {
    return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
  }
  function lineDates(l: RequestLine) {
    return dateRangeOf(l.startDate, l.endDate);
  }
  const monthLabel = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    return new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  };
  const colCount = view === "archive" ? 6 : canEdit ? 7 : 6;

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-slate-100">Schedule Requests</h1>
        <div className="flex items-center gap-1" role="tablist" aria-label="Requests list">
          {(["current", "archive"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={[
                "px-3 py-1 text-sm rounded transition-colors",
                view === v ? "bg-slate-700 text-slate-100 font-medium" : "text-slate-400 hover:text-slate-200",
              ].join(" ")}
            >
              {v === "current" ? "Current" : "Archive"}
            </button>
          ))}
        </div>
      </div>

      {/* Status filter tabs (or the archive month) + free-text search */}
      <div className="flex items-center justify-between gap-3 mb-3">
        {view === "current" ? (
          <div className="flex items-center gap-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={[
                  "px-3 py-1 text-sm rounded transition-colors capitalize",
                  filter === s ? "bg-slate-700 text-slate-100 font-medium" : "text-slate-400 hover:text-slate-200",
                ].join(" ")}
              >
                {s} <span className="text-xs text-slate-500">{counts[s] ?? 0}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            {archive.months.length === 0 ? (
              <span>No month has been archived yet. A month&apos;s requests move here once it is over.</span>
            ) : (
              <>
                <label htmlFor="archive-month">Month</label>
                <select
                  id="archive-month"
                  value={archive.month ?? ""}
                  onChange={(e) => pickMonth(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
                >
                  {archive.months.map((m) => (
                    <option key={m} value={m}>{monthLabel(m)}</option>
                  ))}
                </select>
                <span className="text-xs text-slate-500">Met or not met is read from the schedule as it stands now.</span>
              </>
            )}
          </div>
        )}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search requests…"
          aria-label="Search requests"
          className="w-56 shrink-0 bg-slate-800 border border-slate-700 rounded px-3 py-1 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-500"
        />
      </div>

      {error && (
        <div role="alert" className="mb-3 bg-red-900/60 border border-red-500/50 text-red-100 text-sm px-3 py-2 rounded">
          {error}
        </div>
      )}

      {stillPrompt && (
        <div className="mb-3 bg-amber-900/40 border border-amber-500/50 text-amber-100 text-sm px-3 py-2 rounded flex items-center gap-3">
          <span className="flex-1">
            {staffName[stillPrompt.staffId]?.initials ?? "Staff"} is still scheduled{" "}
            {stillPrompt.cells.map((c) => `${c.code} on ${fmt(c.date)}`).join(", ")} — the request will
            re-approve unless that shift is cleared.
          </span>
          <button
            disabled={busyId === "still"}
            onClick={clearStillScheduled}
            className="shrink-0 px-2 py-0.5 text-xs rounded bg-amber-700/70 hover:bg-amber-600 text-amber-50 disabled:opacity-40"
          >
            Clear shift{stillPrompt.cells.length > 1 ? "s" : ""}
          </button>
          <button
            onClick={() => setStillPrompt(null)}
            className="shrink-0 px-2 py-0.5 text-xs rounded text-amber-200 hover:bg-amber-800/40"
          >
            Keep
          </button>
        </div>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-700">
            {SORTABLE_COLUMNS.filter((c) => view === "current" || c.key !== "approved").map(({ key, label }) => {
              const active = sort?.key === key;
              return (
                <th key={key} className="px-3 py-2">
                  <button
                    onClick={() => toggleSort(key)}
                    className={`inline-flex items-center gap-1 hover:text-slate-300 ${active ? "text-slate-200" : ""}`}
                    title={`Sort by ${label}${active ? " (click to reverse)" : ""}`}
                  >
                    {view === "archive" && key === "status" ? "Outcome" : label}
                    <span className={`text-[9px] ${active ? "text-slate-300" : "text-slate-600"}`}>
                      {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </th>
              );
            })}
            {view === "current" && canEdit && <th className="px-3 py-2 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={colCount + 1} className="px-3 py-8 text-center text-slate-500">
                {search.trim()
                  ? "No requests match your search."
                  : view === "archive"
                    ? archive.month ? "No requests in this month." : "Nothing archived yet."
                    : `No ${filter === "all" ? "" : filter} requests.`}
              </td>
            </tr>
          )}
          {rows.map((l) => {
            const prov = staffName[l.staffId];
            const reqs = lineRequests(l);
            const busy = reqs.some((r) => r.id === busyId);
            const received = reqs.map((r) => r.receivedAt).sort().at(-1);
            const approvedReq = reqs.filter((r) => r.approvedAt).sort((a, b) => a.approvedAt!.localeCompare(b.approvedAt!)).at(-1);
            const sources = [...new Set(reqs.map((r) => r.source))].sort().join(", ");
            const note = view === "archive" ? lineNote(l) : null;
            const editing = noteEdit?.key === l.key;
            return (
              <tr key={l.key} className={`border-b border-slate-800 hover:bg-slate-800/40 align-top ${busy ? "opacity-50" : ""}`}>
                <td className="px-3 py-2 font-medium text-slate-200" title={prov?.name}>
                  {prov?.initials ?? "—"}
                </td>
                <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
                  {lineDates(l)}
                  {l.dates.length > 1 && <span className="block text-xs text-slate-500">{l.dates.length} days</span>}
                </td>
                <td className="px-3 py-2 text-slate-200">
                  {l.parts.map((p) => {
                    const preqs = partRequests(p);
                    const strategies = [...new Set(preqs.flatMap((r) => r.offStrategyOrder.length ? [r.offStrategyOrder.map((t) => describeOffStrategy(t, codeOf)).join(" → ")] : []))];
                    const reqNotes = [...new Set(preqs.map((r) => r.notes).filter((x): x is string => !!x))];
                    return (
                      <div key={p.key} className="py-0.5">
                        {describePart(p)}
                        {p.strength === "soft" && <span className="ml-1 text-xs text-slate-500">(soft)</span>}
                        {strategies.map((t) => (
                          <span key={t} className="block text-xs text-slate-400">via {t}</span>
                        ))}
                        {reqNotes.map((t) => (
                          <span key={t} className="block text-xs text-slate-500 italic">{t}</span>
                        ))}
                      </div>
                    );
                  })}
                  {view === "archive" && l.got !== undefined && <span className="block text-xs text-rose-300/90">{gotText(l)}</span>}
                  {note && !editing && (note.text || note.differ) && (
                    <span className="block text-xs text-slate-300 mt-0.5">
                      Note:{" "}
                      {note.differ
                        ? l.dates.filter((d) => notes[`${l.staffId}|${d}`]).map((d) => `${fmt(d)}: ${notes[`${l.staffId}|${d}`]}`).join("; ")
                        : note.text}
                    </span>
                  )}
                  {view === "archive" && canEdit && !editing && (
                    <button
                      onClick={() => setNoteEdit({ key: l.key, staffId: l.staffId, dates: l.dates, text: note?.text ?? "" })}
                      className="mt-0.5 text-xs text-sky-400 hover:text-sky-300"
                    >
                      {note?.text || note?.differ ? "Edit note" : "Add note"}
                    </button>
                  )}
                  {editing && (
                    <div className="mt-1 flex flex-col gap-1 max-w-md">
                      <textarea
                        value={noteEdit.text}
                        maxLength={500}
                        rows={2}
                        onChange={(e) => setNoteEdit({ ...noteEdit, text: e.target.value })}
                        aria-label="Note for these days"
                        className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
                      />
                      {note?.differ && <span className="text-[11px] text-amber-300/90">Saving replaces the different notes on these days.</span>}
                      <div className="flex gap-1">
                        <button disabled={noteBusy} onClick={saveNote} className="px-2 py-0.5 text-xs rounded bg-sky-700/70 hover:bg-sky-600 text-sky-50 disabled:opacity-40">Save</button>
                        <button disabled={noteBusy} onClick={() => setNoteEdit(null)} className="px-2 py-0.5 text-xs rounded text-slate-300 hover:bg-slate-700">Cancel</button>
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {l.parts.map((p) => {
                    const flagged = partRequests(p).find((r) => r.status === "pending" && r.flaggedReason)?.flaggedReason;
                    return (
                      <div key={p.key} className="py-0.5">
                        {view === "archive" && p.outcome ? (
                          <>
                            <span className={`inline-block text-xs px-2 py-0.5 rounded border ${OUTCOME_BADGE[p.outcome]}`}>{OUTCOME_LABEL[p.outcome]}</span>
                            {p.outcome !== "withdrawn" && <span className="ml-1 text-xs text-slate-500">was {p.status}</span>}
                          </>
                        ) : (
                          <span className={`inline-block text-xs px-2 py-0.5 rounded border capitalize ${STATUS_BADGE[p.status]}`}>{p.status}</span>
                        )}
                        {view === "current" && flagged && (
                          <>
                            <span className="ml-1 inline-block text-xs px-2 py-0.5 rounded border bg-amber-900/30 border-amber-700/60 text-amber-300">Needs resolving</span>
                            <span className="block text-xs text-amber-300/90 mt-0.5">{flagged}</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </td>
                <td className="px-3 py-2 text-slate-400 capitalize">{sources}</td>
                <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{received ? fmtDateTime(received) : "—"}</td>
                {view === "current" && (
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap text-xs">
                    {approvedReq?.approvedAt ? (
                      <>
                        {fmtDateTime(approvedReq.approvedAt)}
                        {approvedReq.approverLabel && <span className="block text-slate-500">by {approvedReq.approverLabel}</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                )}
                {view === "current" && canEdit && (
                  <td className="px-3 py-2">
                    {l.parts.map((p) => {
                      const also = alsoCovers(l, p);
                      const what = describePart(p);
                      return (
                        <div key={p.key} className="flex items-center justify-end gap-1 py-0.5">
                          {p.status !== "approved" && (
                            <button disabled={busy} onClick={() => runPart(p, "approved")} title={`Approve "${what}"${also}`}
                              className="px-2 py-0.5 text-xs rounded bg-emerald-700/70 hover:bg-emerald-600 text-emerald-50 disabled:opacity-40">
                              Approve
                            </button>
                          )}
                          {p.status === "pending" && (
                            <button disabled={busy} onClick={() => runPart(p, "declined")} title={`Decline "${what}"${also}`}
                              className="px-2 py-0.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40">
                              Decline
                            </button>
                          )}
                          {p.status === "approved" && (
                            <button disabled={busy} onClick={() => runPart(p, "pending")} title={`Unapprove "${what}"${also}`}
                              className="px-2 py-0.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40">
                              Unapprove
                            </button>
                          )}
                          {(p.status === "declined" || p.status === "withdrawn") && (
                            <button disabled={busy} onClick={() => runPart(p, "pending")} title={`Return "${what}" to pending (no decision)${also}`}
                              className="px-2 py-0.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40">
                              Reopen
                            </button>
                          )}
                          <button disabled={busy} onClick={() => runPart(p, "delete")} title={`Delete "${what}"${also}`}
                            className="px-2 py-0.5 text-xs rounded text-rose-400 hover:bg-rose-900/30 disabled:opacity-40">
                            Delete
                          </button>
                        </div>
                      );
                    })}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
