"use client";

/**
 * Card #367: "Ask the schedule". Build a question from pickers, answer it in the browser with the
 * pure engine (src/lib/ask/engine.ts), and keep useful questions by name. A saved question that
 * names something since deleted is refused with a way to edit it — never quietly broadened.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { answer, type AskData, type AskResult, type AskCell } from "@/lib/ask/engine";
import { validateAskSpec, missingRefs, REQUEST_KINDS, type AskSpec, type AskKind, type Sel } from "@/lib/ask/spec";
import { toCsvText } from "@/lib/graph/export-csv";
import { formatDate, type DateFormatKey } from "@/lib/date-format";

export type Saved = { id: string; name: string; spec: unknown; ownerId: string | null; isShared: boolean };

export const KIND_LABELS: Record<AskKind, string> = {
  find: "Find a shift (first, last, next or every)",
  count: "Count shifts",
  whoWorked: "Who worked a holiday or date",
  streak: "Longest streak",
  gap: "Time since the last one",
  fairness: "Fairness side by side",
  requests: "Requests made and approved",
};

type Draft = {
  kind: AskKind;
  which: "first" | "last" | "next" | "every";
  by: "staff" | "month" | "staffMonth";
  mode: "work" | "off" | "shifts";
  onType: "holidays" | "dates" | "anyDay";
  reqKinds: Sel;
  reqBy: "staff" | "kind" | "status";
  holidayTypes: Sel;
  dates: string;
  shifts: Sel;
  staff: Sel;
  from: string;
  to: string;
};

function draftFrom(spec: AskSpec, base: Draft): Draft {
  const d: Draft = { ...base, kind: spec.kind };
  if ("which" in spec) d.which = spec.which;
  if (spec.kind === "count") d.by = spec.by;
  if ("mode" in spec) d.mode = spec.mode;
  if (spec.kind === "requests") { d.reqKinds = spec.kinds; d.reqBy = spec.by; }
  if ("shifts" in spec) d.shifts = spec.shifts;
  if ("staff" in spec) d.staff = spec.staff;
  if ("range" in spec) { d.from = spec.range.from; d.to = spec.range.to; }
  if (spec.kind === "whoWorked") {
    if ("holidayTypes" in spec.on) { d.onType = "holidays"; d.holidayTypes = spec.on.holidayTypes; }
    else if ("dates" in spec.on) { d.onType = "dates"; d.dates = spec.on.dates.join(", "); }
    else d.onType = "anyDay";
  }
  return d;
}

/** The draft as a spec, run through the same validator the server uses. */
function specFrom(d: Draft): ReturnType<typeof validateAskSpec> {
  const range = { from: d.from, to: d.to };
  let s: unknown;
  switch (d.kind) {
    case "find": s = { v: 1, kind: "find", which: d.which, shifts: d.shifts, staff: d.staff, range }; break;
    case "count": s = { v: 1, kind: "count", by: d.by, shifts: d.shifts, staff: d.staff, range }; break;
    case "whoWorked": {
      const on = d.onType === "holidays"
        ? { holidayTypes: d.holidayTypes }
        : d.onType === "anyDay"
          ? { anyDay: true }
          : { dates: d.dates.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean) };
      s = { v: 1, kind: "whoWorked", on, shifts: d.shifts, range };
      break;
    }
    case "streak": s = d.mode === "shifts"
      ? { v: 1, kind: "streak", mode: "shifts", shifts: d.shifts, staff: d.staff, range }
      : { v: 1, kind: "streak", mode: d.mode, staff: d.staff, range }; break;
    case "gap": s = { v: 1, kind: "gap", shifts: d.shifts, staff: d.staff, range }; break;
    case "fairness": s = { v: 1, kind: "fairness", staff: d.staff, range }; break;
    case "requests": s = { v: 1, kind: "requests", staff: d.staff, range, kinds: d.reqKinds, by: d.reqBy }; break;
  }
  return validateAskSpec(s);
}

const inputCls = "bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100";
const btnCls = "px-3 py-1 text-sm rounded border border-slate-600 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed";

function Picker({ label, all, items, sel, onChange, missing }: {
  label: string;
  all: string;
  items: Array<{ id: string; label: string; dim?: boolean }>;
  sel: Sel;
  onChange: (s: Sel) => void;
  missing: string[];
}) {
  const ids = "ids" in sel ? new Set(sel.ids) : null;
  const toggle = (id: string) => {
    if (!ids) return;
    const next = new Set(ids);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange({ ids: [...next] });
  };
  return (
    <fieldset className="border border-slate-700 rounded p-2 min-w-0">
      <legend className="px-1 text-xs text-slate-400">{label}</legend>
      <label className="flex items-center gap-2 text-sm text-slate-200 mb-1">
        <input type="checkbox" checked={!ids} onChange={(e) => onChange(e.target.checked ? { all: true } : { ids: [] })} />
        {all}
      </label>
      {ids && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 max-h-40 overflow-auto">
          {items.map((it) => (
            <label key={it.id} className={`flex items-center gap-1 text-sm ${it.dim ? "text-slate-500" : "text-slate-200"}`}>
              <input type="checkbox" checked={ids.has(it.id)} onChange={() => toggle(it.id)} />
              {it.label}
            </label>
          ))}
        </div>
      )}
      {ids && ids.size === 0 && <p className="text-xs text-amber-400 mt-1">Pick at least one.</p>}
      {missing.length > 0 && (
        <p className="text-xs text-amber-400 mt-1">
          {missing.length} picked {missing.length === 1 ? "item no longer exists" : "items no longer exist"}.{" "}
          <button type="button" className="underline" onClick={() => onChange({ ids: [...ids!].filter((x) => !missing.includes(x)) })}>
            Remove {missing.length === 1 ? "it" : "them"}
          </button>
        </p>
      )}
    </fieldset>
  );
}

type SortState = { key: string; dir: 1 | -1 } | null;

function compareCells(a: AskCell, b: AskCell): number {
  if (a === b) return 0;
  if (a === null || a === "") return 1; // blanks last
  if (b === null || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function AskPage({ data, today, dateFormat, canManage, initialSaved }: { data: AskData; today: string; dateFormat: DateFormatKey; canManage: boolean; initialSaved: Saved[] }) {
  const router = useRouter();
  const year = today.slice(0, 4);
  const blank: Draft = useMemo(() => ({
    kind: "find", which: "first", by: "staff", mode: "work", onType: "holidays", reqKinds: { all: true }, reqBy: "staff",
    holidayTypes: { all: true }, dates: "", shifts: { all: true }, staff: { all: true },
    from: `${year}-01-01`, to: `${year}-12-31`,
  }), [year]);
  const [draft, setDraft] = useState<Draft>(blank);
  // The question last asked; the answer is derived from it AND the current data, so Refresh
  // (new data from the server) recomputes the table instead of leaving a stale one.
  const [asked, setAsked] = useState<{ spec: AskSpec } | { error: string } | null>(null);
  const result: AskResult | null = useMemo(
    () => (asked === null ? null : "error" in asked ? asked : answer(asked.spec, data, today)),
    [asked, data, today],
  );
  const [sort, setSort] = useState<SortState>(null);
  const [saved, setSaved] = useState<Saved[]>(initialSaved);
  const [savedErr, setSavedErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<Saved | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveShared, setSaveShared] = useState(true);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const kinds = (Object.keys(KIND_LABELS) as AskKind[]).filter((k) => k !== "requests" || data.requests !== null);
  const v = specFrom(draft);
  const missing = v.ok ? missingRefs(v.spec, data) : { staff: [], shifts: [], holidayTypes: [] };

  const loadSaved = async () => {
    try {
      const res = await fetch("/api/ask/questions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(await res.json());
      setSavedErr(null);
    } catch {
      setSavedErr("Could not load saved questions.");
    }
  };

  const run = (d: Draft) => {
    const s = specFrom(d);
    setSort(null);
    setAsked(s.ok ? { spec: s.spec } : { error: s.error });
  };

  const openSaved = (q: Saved) => {
    setCurrent(q);
    setSaveName(q.name);
    setSaveShared(q.isShared);
    const s = validateAskSpec(q.spec);
    if (!s.ok) { setAsked({ error: `This saved question can't be read: ${s.error}` }); return; }
    const d = draftFrom(s.spec, blank);
    setDraft(d);
    run(d);
  };

  const save = async (asNew: boolean) => {
    if (!v.ok || !saveName.trim()) return;
    setBusy(true);
    try {
      const body = JSON.stringify({ name: saveName.trim(), spec: v.spec, isShared: saveShared });
      const res = asNew || !current
        ? await fetch("/api/ask/questions", { method: "POST", headers: { "Content-Type": "application/json" }, body })
        : await fetch(`/api/ask/questions/${current.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setSavedErr(json?.error ?? `Save failed (HTTP ${res.status})`); return; }
      setCurrent(json);
      await loadSaved();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (q: Saved) => {
    if (!confirm(`Delete the saved question "${q.name}"?`)) return;
    const res = await fetch(`/api/ask/questions/${q.id}`, { method: "DELETE" });
    if (!res.ok) { setSavedErr("Delete failed."); return; }
    if (current?.id === q.id) setCurrent(null);
    await loadSaved();
  };

  const rows = useMemo(() => {
    if (!result || "error" in result) return [];
    if (!sort) return result.rows;
    return [...result.rows].sort((a, b) => sort.dir * compareCells(a[sort.key], b[sort.key]));
  }, [result, sort]);

  const showDate = (iso: string) => formatDate(new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)), dateFormat);
  const openMonth = (iso: string) => {
    // The schedule reopens the month saved for this browser tab (schedule-grid.tsx).
    try { sessionStorage.setItem("yosched:viewMonth", JSON.stringify({ year: +iso.slice(0, 4), month: +iso.slice(5, 7) - 1 })); } catch { /* storage off: opens on today */ }
    router.push("/");
  };

  const downloadCsv = () => {
    if (!result || "error" in result) return;
    const csv = toCsvText([result.columns.map((c) => c.label), ...rows.map((r) => result.columns.map((c) => r[c.key] ?? ""))]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ask-${(current?.name ?? draft.kind).replace(/[^\w-]+/g, "-")}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const staffItems = data.raw.staff.map((p) => ({ id: p.id, label: p.initials, dim: !p.isActive }));
  const shiftItems = data.shiftTypes.map((s) => ({ id: s.id, label: s.code }));
  const usesShifts = ["find", "count", "whoWorked", "gap"].includes(draft.kind) || (draft.kind === "streak" && draft.mode === "shifts");
  const usesStaff = draft.kind !== "whoWorked";


  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <aside className="w-64 shrink-0 border-r border-slate-700 p-3 overflow-auto">
        <h2 className="text-sm font-semibold text-slate-300 mb-2">Saved questions</h2>
        {savedErr && <p className="text-xs text-red-400 mb-2">{savedErr}</p>}
        {saved.length === 0 && !savedErr && <p className="text-xs text-slate-500">None yet.</p>}
        <ul className="space-y-1">
          {saved.map((q) => (
            <li key={q.id} className="flex items-center gap-1">
              <button type="button" onClick={() => openSaved(q)}
                className={`flex-1 text-left text-sm px-2 py-1 rounded truncate ${current?.id === q.id ? "bg-slate-700 text-slate-100" : "text-slate-300 hover:bg-slate-800"}`}>
                {q.name}{!q.isShared && <span className="text-xs text-slate-500"> (private)</span>}
              </button>
              {canManage && <button type="button" aria-label={`Delete ${q.name}`} onClick={() => remove(q)} className="text-xs text-slate-500 hover:text-red-400 px-1">✕</button>}
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex-1 min-w-0 overflow-auto p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold text-slate-100">Ask the schedule</h1>
          <button type="button" className={btnCls} onClick={() => { router.refresh(); }} title="Load the latest schedule">Refresh</button>
          <button type="button" className={btnCls} onClick={() => { setDraft(blank); setCurrent(null); setAsked(null); setSaveName(""); }}>New question</button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-300 flex flex-col gap-1">
            Question
            <select aria-label="Kind of question" className={inputCls} value={draft.kind} onChange={(e) => set("kind", e.target.value as AskKind)}>
              {kinds.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </label>
          {draft.kind === "find" && (
            <label className="text-sm text-slate-300 flex flex-col gap-1">Which
              <select aria-label="Which" className={inputCls} value={draft.which} onChange={(e) => set("which", e.target.value as Draft["which"])}>
                <option value="first">First</option><option value="last">Last</option><option value="next">Next (from today)</option><option value="every">Every one</option>
              </select>
            </label>
          )}
          {draft.kind === "count" && (
            <label className="text-sm text-slate-300 flex flex-col gap-1">Per
              <select aria-label="Count per" className={inputCls} value={draft.by} onChange={(e) => set("by", e.target.value as Draft["by"])}>
                <option value="staff">Person</option><option value="month">Month</option><option value="staffMonth">Person and month</option>
              </select>
            </label>
          )}
          {draft.kind === "streak" && (
            <label className="text-sm text-slate-300 flex flex-col gap-1">Of
              <select aria-label="Streak of" className={inputCls} value={draft.mode} onChange={(e) => set("mode", e.target.value as Draft["mode"])}>
                <option value="work">Worked days</option><option value="off">Days off</option><option value="shifts">Chosen shifts</option>
              </select>
            </label>
          )}
          {(
            <>
              <label className="text-sm text-slate-300 flex flex-col gap-1">From
                <input type="date" aria-label="From" className={inputCls} value={draft.from} onChange={(e) => set("from", e.target.value)} />
              </label>
              <label className="text-sm text-slate-300 flex flex-col gap-1">To
                <input type="date" aria-label="To" className={inputCls} value={draft.to} onChange={(e) => set("to", e.target.value)} />
              </label>
              <div className="flex gap-1 pb-0.5">
                <button type="button" className={btnCls} onClick={() => setDraft((d) => ({ ...d, from: `${year}-01-01`, to: `${year}-12-31` }))}>This year</button>
                <button type="button" className={btnCls} onClick={() => setDraft((d) => ({ ...d, from: `${+year - 1}-01-01`, to: `${+year - 1}-12-31` }))}>Last year</button>
              </div>
            </>
          )}
        </div>

        {draft.kind === "whoWorked" && (
          <div className="flex flex-wrap gap-3 items-start">
            <label className="text-sm text-slate-300 flex flex-col gap-1">On
              <select aria-label="On" className={inputCls} value={draft.onType} onChange={(e) => set("onType", e.target.value as Draft["onType"])}>
                <option value="holidays">Holidays</option><option value="dates">Dates I list</option><option value="anyDay">Any day (who had the shift)</option>
              </select>
            </label>
            {draft.onType === "anyDay" ? null : draft.onType === "holidays" ? (
              <Picker label="Holidays" all="Any holiday" items={data.holidayTypes.map((t) => ({ id: t.id, label: t.name }))}
                sel={draft.holidayTypes} onChange={(s) => set("holidayTypes", s)} missing={missing.holidayTypes} />
            ) : (
              <label className="text-sm text-slate-300 flex flex-col gap-1">Dates (YYYY-MM-DD, separated by commas)
                <input aria-label="Dates" className={`${inputCls} w-96`} value={draft.dates} onChange={(e) => set("dates", e.target.value)} placeholder="2025-12-24, 2025-12-31" />
              </label>
            )}
          </div>
        )}

        {draft.kind === "requests" && (
          <div className="flex flex-wrap gap-3 items-start">
            <label className="text-sm text-slate-300 flex flex-col gap-1">Per
              <select aria-label="Requests per" className={inputCls} value={draft.reqBy} onChange={(e) => set("reqBy", e.target.value as Draft["reqBy"])}>
                <option value="staff">Person</option><option value="kind">Kind of request</option><option value="status">Status</option>
              </select>
            </label>
            <Picker label="Kinds of request" all="Every kind" items={Object.entries(REQUEST_KINDS).map(([id, label]) => ({ id, label }))}
              sel={draft.reqKinds} onChange={(s) => set("reqKinds", s)} missing={[]} />
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {usesShifts && <Picker label="Shifts" all="Any shift" items={shiftItems} sel={draft.shifts} onChange={(s) => set("shifts", s)} missing={missing.shifts} />}
          {usesStaff && <Picker label="Staff" all="Everyone (active staff, plus anyone with an answer)" items={staffItems} sel={draft.staff} onChange={(s) => set("staff", s)} missing={missing.staff} />}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40" disabled={!v.ok} onClick={() => run(draft)}>Ask</button>
          {!v.ok && <span className="text-xs text-amber-400">{v.error}</span>}
          {canManage && (
            <span className="flex items-center gap-2 ml-auto">
              <input aria-label="Question name" className={inputCls} placeholder="Name to save as" maxLength={120} value={saveName} onChange={(e) => setSaveName(e.target.value)} />
              <label className="text-xs text-slate-300 flex items-center gap-1"><input type="checkbox" checked={saveShared} onChange={(e) => setSaveShared(e.target.checked)} />Shared</label>
              {current && <button type="button" className={btnCls} disabled={busy || !v.ok || !saveName.trim()} onClick={() => save(false)}>Update “{current.name}”</button>}
              <button type="button" className={btnCls} disabled={busy || !v.ok || !saveName.trim()} onClick={() => save(true)}>Save as new</button>
            </span>
          )}
        </div>

        {result && "error" in result && (
          <div role="alert" className="rounded border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">
            {result.error} Change the choices above and press Ask again.
          </div>
        )}

        {result && !("error" in result) && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <p className="text-sm text-slate-100 font-medium">{result.summary}</p>
              <button type="button" className={btnCls} disabled={rows.length === 0} onClick={downloadCsv}>Download CSV</button>
            </div>
            {result.note && <p className="text-xs text-slate-400">{result.note}</p>}
            {rows.length > 0 && (
              <table className="text-sm border-collapse">
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c.key} className="text-left px-3 py-1 border-b border-slate-600 text-slate-300 font-medium">
                        <button type="button" className="hover:text-slate-100"
                          onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}>
                          {c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="odd:bg-slate-800/40">
                      {result.columns.map((c) => {
                        const val = r[c.key];
                        const isDate = c.type === "date" && typeof val === "string" && val !== "";
                        return (
                          <td key={c.key} className={`px-3 py-0.5 ${c.type === "number" ? "text-right tabular-nums" : ""} text-slate-200`}>
                            {isDate
                              ? <button type="button" className="underline decoration-slate-600 hover:text-blue-300" title="Open this month on the schedule" onClick={() => openMonth(val)}>{showDate(val)}</button>
                              : val === null ? "—" : String(val)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
