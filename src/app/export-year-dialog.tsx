"use client";

// Card #299: "Export year" dialog. One click saves the year as BOTH an Excel workbook and a
// PDF (one month per sheet / page), from the SAVED schedule. Export downloads both (card #308);
// the folder button is gone (card #311).

import { useEffect, useRef, useState } from "react";
import { useEscape } from "@/lib/use-escape";
import { BASE_PATH } from "@/lib/base-path";
import { exportFileNameError, exportNameEdit, exportNameSetYear, initExportName } from "@/lib/export-filename";
import { browserExportEnv, runYearExport, type ExportOutcome } from "@/lib/save-export";
import { buildYearExportFiles, fetchPdfFonts } from "@/lib/export-year-files";
import type { ExportScheduleInput } from "@/lib/print-month-model";
import type { ExportPrep } from "@/lib/auto-version-flow";


type Props = {
  yearChoices: number[];
  defaultYear: number;
  /** Settings template ({YEAR}); null = the built-in default. */
  fileNameTemplate: string | null;
  /** Card #312: freezes the saved schedule at the click, then saves versions for the
   *  year's changed months (per the Settings choice) and returns that frozen input. */
  prepare: (year: number) => Promise<ExportPrep<ExportScheduleInput>>;
  onClose: () => void;
};

export function ExportYearDialog({ yearChoices, defaultYear, fileNameTemplate, prepare, onClose }: Props) {
  const [nameState, setNameState] = useState(() => initExportName(fileNameTemplate, defaultYear));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportOutcome | null>(null);
  const mounted = useRef(true);
  const runToken = useRef(0);
  const resultRef = useRef<ExportOutcome | null>(null);

  // Retry links hold object URLs: free them on unmount and when a new result replaces them.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      resultRef.current?.release();
    };
  }, []);
  const showResult = (r: ExportOutcome | null) => {
    resultRef.current?.release();
    resultRef.current = r;
    setResult(r);
  };

  const close = () => { if (!busy) onClose(); };
  useEscape(close);

  const nameError = exportFileNameError(nameState.name);
  const canExport = !busy && !nameError;

  // Card #308/#311: Export downloads both files; Chrome's own Save As (if set to ask) reaches
  // any folder, Desktop and Downloads included. No folder picker (Chrome blocks those folders).
  const onExport = () => {
    if (!canExport) return;
    const token = ++runToken.current;
    const year = nameState.year;
    const name = nameState.name;
    const now = new Date();
    const stale = () => !mounted.current || token !== runToken.current;
    const fail = (message: string) => showResult({ kind: "failed", message, saved: [], failed: [], retry: [], release: () => {} });
    setBusy(true);
    showResult(null);
    // Card #312: prepare() freezes the input synchronously, then may wait for the server
    // to save versions; the files are built from that frozen input only.
    void (async () => {
      try {
        const ensured = await prepare(year);
        if (stale()) return;
        if (!ensured.ok) {
          if (ensured.message) fail(ensured.message);
          return;
        }
        const input = ensured.input;
        const r = await runYearExport(name, () => buildYearExportFiles(input, year, now, () => fetchPdfFonts(BASE_PATH)), browserExportEnv());
        if (stale()) { r.release(); return; }
        showResult(r);
      } catch (e) {
        if (!stale()) fail(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!stale()) setBusy(false);
      }
    })();
  };

  const tone = result?.kind === "saved" || result?.kind === "downloads" ? "text-emerald-400" : result?.kind === "cancelled" ? "text-slate-400" : "text-red-400";

  return (
    <div data-print-hide className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-year-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-[440px] max-w-[calc(100vw-2rem)] p-5 space-y-4"
      >
        <h2 id="export-year-title" className="text-sm font-semibold text-slate-200">Export year</h2>
        <p className="text-xs text-slate-400">Saves the whole year as an Excel workbook and a PDF, one month per sheet and page, from the saved schedule.</p>
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <span className="w-20">Year</span>
          <select
            aria-label="Year"
            value={nameState.year}
            disabled={busy}
            onChange={(e) => setNameState((s) => exportNameSetYear(s, fileNameTemplate, Number(e.target.value)))}
            className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100 disabled:opacity-50"
          >
            {yearChoices.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <span className="w-20">File name</span>
          <input
            type="text"
            aria-label="File name"
            value={nameState.name}
            maxLength={120}
            disabled={busy}
            onChange={(e) => setNameState((s) => exportNameEdit(s, e.target.value))}
            onKeyDown={(e) => { if (e.key === "Enter") onExport(); }}
            className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100 disabled:opacity-50"
          />
        </label>
        <p className="text-xs text-slate-500">{nameError ? <span className="text-red-400">{nameError}</span> : <>Saves {nameState.name}.xlsx and {nameState.name}.pdf</>}</p>
        <p className="text-xs text-slate-500">{"Export downloads both files to the browser's download folder. To choose the folder each time, turn on \"Ask where to save each file\" in the browser's download settings."}</p>
        {busy && <p className="text-xs text-slate-300" role="status">Exporting…</p>}
        {result && (
          <div role="status" className={`text-xs ${tone} space-y-1`}>
            <p>{result.message}</p>
            {result.retry.length > 0 && (
              <p className="flex gap-3">
                {result.retry.map((r) => (
                  <a key={r.name} href={r.url} download={r.name} className="underline text-blue-400 hover:text-blue-300">{r.name}</a>
                ))}
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} disabled={busy} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-slate-300">Close</button>
          <button type="button" onClick={() => onExport()} disabled={!canExport} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-white">Export</button>
        </div>
      </div>
    </div>
  );
}
