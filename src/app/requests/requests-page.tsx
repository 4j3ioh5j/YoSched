"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { describeRequest, type RequestKind, type RequestStrength } from "@/lib/schedule-requests";
import { formatDate, type DateFormatKey, DEFAULT_DATE_FORMAT } from "@/lib/date-format";
import { filterAndSortRequests, type RequestSort, type RequestSortKey } from "@/lib/request-list";

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
  receivedAt: string;
  approvedAt: string | null;
  approverLabel: string | null; // resolved server-side; never a raw user id
  notes: string | null;
};

type Props = {
  canEdit: boolean;
  requests: RequestRow[];
  staffName: Record<string, { initials: string; name: string }>;
  shiftCode: Record<string, string>;
  dateFormat: string;
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

export function RequestsPage({ canEdit, requests: initial, staffName, shiftCode, dateFormat: dfProp }: Props) {
  const [requests, setRequests] = useState(initial);
  const [filter, setFilter] = useState<RequestStatus | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Client-side, session-only (no persistence, no server round-trip).
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<RequestSort | null>(null);
  const df = (dfProp || DEFAULT_DATE_FORMAT) as DateFormatKey;
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
  const fmtDateTime = (iso: string) => {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${formatDate(d, df)} ${hh}:${mm}`;
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: requests.length };
    for (const r of requests) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [requests]);

  // Click a header to sort by it (ascending); click the same header again to
  // reverse the direction. A different header always starts ascending.
  function toggleSort(key: RequestSortKey) {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  // Status tab (raw equality) → pure search + sort (lib/request-list). Each row
  // is projected into its comparable fields here, using the same display helpers
  // that render the cells so search/sort match exactly what the user sees.
  const rows = useMemo(() => {
    const statusFiltered = filter === "all" ? requests : requests.filter((r) => r.status === filter);
    return filterAndSortRequests(
      statusFiltered,
      (r) => {
        const prov = staffName[r.staffId];
        const haystack = [
          prov?.name,
          prov?.initials,
          dateRange(r),
          describeRequest(r, codeOf),
          r.strength === "soft" ? "soft" : "",
          r.notes,
          r.status,
          r.source,
          fmtDateTime(r.receivedAt),
          r.approvedAt ? fmtDateTime(r.approvedAt) : "",
          r.approverLabel ? `by ${r.approverLabel}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        return {
          staff: prov?.name ?? "",
          startDate: r.startDate,
          endDate: r.endDate,
          request: describeRequest(r, codeOf),
          // Rank by the status-tab order (pending → … → fulfilled), not alphabetical.
          statusRank: STATUS_FILTERS.indexOf(r.status),
          source: r.source,
          receivedAt: r.receivedAt,
          approvedAt: r.approvedAt,
          haystack,
        };
      },
      { query: search, sort },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, filter, search, sort, staffName, shiftCode, df]);

  async function patchStatus(id: string, status: RequestStatus) {
    setBusyId(id);
    setError(null);
    const prev = requests;
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
        setRequests(prev);
        setError("Failed to update request.");
      } else {
        const updated = await res.json();
        setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, status: updated.status, approvedAt: updated.approvedAt } : r)));
      }
    } catch {
      setRequests(prev);
      setError("Failed to update request.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    const prev = requests;
    setRequests((rs) => rs.filter((r) => r.id !== id));
    try {
      const res = await fetch(`/api/requests/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setRequests(prev);
        setError("Failed to delete request.");
      }
    } catch {
      setRequests(prev);
      setError("Failed to delete request.");
    } finally {
      setBusyId(null);
    }
  }

  function dateRange(r: RequestRow) {
    return r.startDate === r.endDate ? fmt(r.startDate) : `${fmt(r.startDate)} – ${fmt(r.endDate)}`;
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-slate-100">Schedule Requests</h1>
      </div>

      {/* Status filter tabs + free-text search */}
      <div className="flex items-center justify-between gap-3 mb-3">
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

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-700">
            {SORTABLE_COLUMNS.map(({ key, label }) => {
              const active = sort?.key === key;
              return (
                <th key={key} className="px-3 py-2">
                  <button
                    onClick={() => toggleSort(key)}
                    className={`inline-flex items-center gap-1 hover:text-slate-300 ${active ? "text-slate-200" : ""}`}
                    title={`Sort by ${label}${active ? " (click to reverse)" : ""}`}
                  >
                    {label}
                    <span className={`text-[9px] ${active ? "text-slate-300" : "text-slate-600"}`}>
                      {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </th>
              );
            })}
            {canEdit && <th className="px-3 py-2 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={canEdit ? 8 : 7} className="px-3 py-8 text-center text-slate-500">
                {search.trim() ? "No requests match your search." : `No ${filter === "all" ? "" : filter} requests.`}
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const prov = staffName[r.staffId];
            const busy = busyId === r.id;
            return (
              <tr key={r.id} className={`border-b border-slate-800 hover:bg-slate-800/40 ${busy ? "opacity-50" : ""}`}>
                <td className="px-3 py-2 font-medium text-slate-200" title={prov?.name}>
                  {prov?.initials ?? "—"}
                </td>
                <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{dateRange(r)}</td>
                <td className="px-3 py-2 text-slate-200">
                  {describeRequest(r, codeOf)}
                  {r.strength === "soft" && <span className="ml-1 text-xs text-slate-500">(soft)</span>}
                  {r.notes && <span className="block text-xs text-slate-500 italic">{r.notes}</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block text-xs px-2 py-0.5 rounded border capitalize ${STATUS_BADGE[r.status]}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-400 capitalize">{r.source}</td>
                <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{fmtDateTime(r.receivedAt)}</td>
                <td className="px-3 py-2 text-slate-400 whitespace-nowrap text-xs">
                  {r.approvedAt ? (
                    <>
                      {fmtDateTime(r.approvedAt)}
                      {r.approverLabel && <span className="block text-slate-500">by {r.approverLabel}</span>}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                {canEdit && (
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {r.status !== "approved" && (
                        <button
                          disabled={busy}
                          onClick={() => patchStatus(r.id, "approved")}
                          className="px-2 py-0.5 text-xs rounded bg-emerald-700/70 hover:bg-emerald-600 text-emerald-50 disabled:opacity-40"
                        >
                          Approve
                        </button>
                      )}
                      {r.status === "pending" && (
                        <button
                          disabled={busy}
                          onClick={() => patchStatus(r.id, "declined")}
                          className="px-2 py-0.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40"
                        >
                          Decline
                        </button>
                      )}
                      {r.status === "approved" && (
                        <button
                          disabled={busy}
                          onClick={() => patchStatus(r.id, "pending")}
                          className="px-2 py-0.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40"
                        >
                          Unapprove
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => remove(r.id)}
                        className="px-2 py-0.5 text-xs rounded text-rose-400 hover:bg-rose-900/30 disabled:opacity-40"
                        title="Delete request"
                      >
                        Delete
                      </button>
                    </div>
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
