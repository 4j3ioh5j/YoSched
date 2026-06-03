"use client";

import React, { useEffect, useState, useCallback } from "react";
import { coerceSpec, DEFAULT_SPEC, type GraphSpec } from "@/lib/graph/spec";

type SavedView = {
  id: string;
  name: string;
  spec: unknown;
  ownerId: string | null;
  isShared: boolean;
  sortOrder: number;
};

type Props = {
  currentSpec: GraphSpec;
  onSelect: (spec: GraphSpec) => void;
  /** Whether the user holds statistics:manage (gates all write actions). */
  canManage: boolean;
};

const btn =
  "px-2.5 py-1.5 text-xs rounded transition-colors bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed";

/** Saved-views control: pick a stored GraphSpec, or (with statistics:manage)
 *  save / overwrite / rename / delete / share the current configuration. */
export function SavedViews({ currentSpec, onSelect, canManage }: Props) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [mode, setMode] = useState<"idle" | "saveAs" | "rename">("idle");
  const [draftName, setDraftName] = useState("");
  const [draftShared, setDraftShared] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = views.find((v) => v.id === selectedId) ?? null;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/statistics/views");
      if (!res.ok) throw new Error("Failed to load saved views");
      setViews(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load saved views");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleSelect(id: string) {
    setSelectedId(id);
    setMode("idle");
    setErr(null);
    const view = views.find((v) => v.id === id);
    if (view) onSelect(coerceSpec(view.spec));
  }

  /** Reset every control back to the default configuration and clear the
   *  currently-selected saved view. */
  function handleReset() {
    setSelectedId("");
    setMode("idle");
    setErr(null);
    onSelect({
      ...DEFAULT_SPEC,
      dateRange: { ...DEFAULT_SPEC.dateRange },
      staff: { ...DEFAULT_SPEC.staff },
    });
  }

  async function mutate(method: string, url: string, body?: object): Promise<SavedView | null> {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return method === "DELETE" ? null : await res.json();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function doSaveAs() {
    const name = draftName.trim();
    if (!name) {
      setErr("Name is required");
      return;
    }
    const created = await mutate("POST", "/api/statistics/views", {
      name,
      spec: currentSpec,
      isShared: draftShared,
    });
    if (created) {
      await load();
      setSelectedId(created.id);
      setMode("idle");
      setDraftName("");
    }
  }

  async function doOverwrite() {
    if (!selected) return;
    const updated = await mutate("PUT", `/api/statistics/views/${selected.id}`, { spec: currentSpec });
    if (updated) await load();
  }

  async function doRename() {
    if (!selected) return;
    const name = draftName.trim();
    if (!name) {
      setErr("Name cannot be empty");
      return;
    }
    const updated = await mutate("PUT", `/api/statistics/views/${selected.id}`, { name });
    if (updated) {
      await load();
      setMode("idle");
    }
  }

  async function doDelete() {
    if (!selected) return;
    if (!confirm(`Delete saved view "${selected.name}"?`)) return;
    const ok = (await mutate("DELETE", `/api/statistics/views/${selected.id}`)) === null && !err;
    if (ok) {
      setSelectedId("");
      await load();
    }
  }

  async function doToggleShare() {
    if (!selected) return;
    const updated = await mutate("PUT", `/api/statistics/views/${selected.id}`, { isShared: !selected.isShared });
    if (updated) await load();
  }

  function startSaveAs() {
    setMode("saveAs");
    setDraftName("");
    setDraftShared(true);
    setErr(null);
  }

  function startRename() {
    if (!selected) return;
    setMode("rename");
    setDraftName(selected.name);
    setErr(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400 w-16 shrink-0">View</span>
        <select
          value={selectedId}
          onChange={(e) => handleSelect(e.target.value)}
          className="bg-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 border border-slate-600 min-w-[12rem]"
        >
          <option value="">— Select a saved view —</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.isShared ? "" : " (private)"}
            </option>
          ))}
        </select>

        {canManage && (
          <>
            <button className={btn} onClick={startSaveAs} disabled={busy}>
              Save as…
            </button>
            <button className={btn} onClick={doOverwrite} disabled={busy || !selected}>
              Save
            </button>
            <button className={btn} onClick={startRename} disabled={busy || !selected}>
              Rename
            </button>
            <button className={btn} onClick={doToggleShare} disabled={busy || !selected}>
              {selected && !selected.isShared ? "Share" : "Make private"}
            </button>
            <button
              className={`${btn} hover:bg-red-600/30 hover:text-red-300`}
              onClick={doDelete}
              disabled={busy || !selected}
            >
              Delete
            </button>
          </>
        )}

        <button
          className="ml-auto px-2.5 py-1.5 text-xs rounded border border-slate-500 text-slate-300 hover:bg-slate-600 hover:text-white hover:border-slate-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={handleReset}
          disabled={busy}
          title="Reset all controls to their default configuration"
        >
          ↺ Reset
        </button>
      </div>

      {canManage && mode === "saveAs" && (
        <div className="flex items-center gap-2 flex-wrap pl-[72px]">
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSaveAs()}
            placeholder="View name"
            className="bg-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 border border-slate-600"
          />
          <label className="text-xs text-slate-400 flex items-center gap-1.5">
            <input type="checkbox" checked={draftShared} onChange={(e) => setDraftShared(e.target.checked)} />
            Shared
          </label>
          <button className={btn} onClick={doSaveAs} disabled={busy}>
            Create
          </button>
          <button className={btn} onClick={() => setMode("idle")} disabled={busy}>
            Cancel
          </button>
        </div>
      )}

      {canManage && mode === "rename" && (
        <div className="flex items-center gap-2 flex-wrap pl-[72px]">
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doRename()}
            placeholder="New name"
            className="bg-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 border border-slate-600"
          />
          <button className={btn} onClick={doRename} disabled={busy}>
            Save name
          </button>
          <button className={btn} onClick={() => setMode("idle")} disabled={busy}>
            Cancel
          </button>
        </div>
      )}

      {err && <p className="text-xs text-red-400 pl-[72px]">{err}</p>}
    </div>
  );
}
