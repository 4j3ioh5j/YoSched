"use client";

import { useRef, useState } from "react";

// Card #317: choosing a key file. The bare <input type="file"> did not open for David, so the
// picker is a plain button that opens a hidden file input, AND a drop zone: dragging the file
// from Finder onto it works even where a page can't open a file chooser.
// No `accept` filter: a custom extension can grey out the very file on macOS. The server checks
// that the file really is a key file.

export const MAX_KEY_PICK_BYTES = 16 * 1024;

/** The file to use from a pick or a drop, or why none can be used. */
export function chooseKeyFile(files: ArrayLike<File> | null | undefined): { file: File } | { error: string } | null {
  if (!files || files.length === 0) return null;
  if (files.length > 1) return { error: "Choose one key file" };
  const f = files[0];
  if (f.size > MAX_KEY_PICK_BYTES) return { error: `"${f.name}" is too big to be a YoSched key file` };
  return { file: f };
}

export function KeyFilePicker({ file, onChange, disabled, label = "Choose key file…" }: {
  file: File | null; onChange: (f: File | null) => void; disabled?: boolean; label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const take = (files: ArrayLike<File> | null | undefined) => {
    const r = chooseKeyFile(files);
    if (!r) return;
    if ("error" in r) { setError(r.error); onChange(null); return; }
    setError(null); onChange(r.file);
  };
  return (
    <div
      data-key-drop
      className={`flex flex-wrap items-center gap-2 rounded border border-dashed px-2 py-1.5 text-xs ${over ? "border-blue-400 bg-blue-950/40" : "border-slate-600"}`}
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files); }}
    >
      <button type="button" className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-white" disabled={disabled} onClick={() => input.current?.click()}>
        {label}
      </button>
      <span className={file ? "text-slate-200" : "text-slate-500"}>{file ? file.name : "or drag the key file here"}</span>
      {file && !disabled && <button type="button" className="text-slate-400 underline" onClick={() => { onChange(null); if (input.current) input.current.value = ""; }}>clear</button>}
      {error && <span className="text-amber-400">{error}</span>}
      <input ref={input} type="file" className="hidden" tabIndex={-1} aria-hidden onChange={(e) => take(e.target.files)} disabled={disabled} />
    </div>
  );
}
