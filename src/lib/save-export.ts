// Card #299: save the year export's two files. With a folder picker (Chrome, Edge) the
// picker opens FIRST, inside the click's user activation; only then are the files built.
// Without one (Safari, Firefox) both files are downloaded and kept as retry links until
// release(). The result always says exactly what was saved: never a false "saved both".

type Writable = { write(data: Blob | Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
type FileHandle = { createWritable(): Promise<Writable> };
export type DirHandle = {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
};

export type ExportEnv = {
  showDirectoryPicker: (() => Promise<DirHandle>) | undefined;
  confirm: (message: string) => boolean;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  startDownload: (url: string, name: string) => void;
};

export type ExportBytes = { xlsx: Uint8Array; pdf: Uint8Array };

export type ExportOutcome = {
  kind: "saved" | "partial" | "downloads" | "cancelled" | "failed";
  message: string;
  saved: string[];
  failed: { name: string; error: string }[];
  retry: { name: string; url: string }[];
  /** Frees the retry links' object URLs. Safe to call more than once. */
  release: () => void;
};

const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

const PICKER_CANCELLED =
  "Cancelled. Nothing was saved. This folder picker cannot use Downloads, Desktop or Documents themselves: make a folder inside one, or click Export to download the files instead.";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)) || "unknown error";
const outcome = (o: Partial<ExportOutcome> & Pick<ExportOutcome, "kind" | "message">): ExportOutcome => ({
  saved: [], failed: [], retry: [], release: () => {}, ...o,
});

/** The browser's real environment. */
export function browserExportEnv(): ExportEnv {
  const w = window as unknown as { showDirectoryPicker?: (o: object) => Promise<DirHandle> };
  return {
    showDirectoryPicker: typeof w.showDirectoryPicker === "function"
      ? () => w.showDirectoryPicker!({ id: "yosched-export", mode: "readwrite" })
      : undefined,
    confirm: (m) => window.confirm(m),
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    startDownload: (url, name) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
  };
}

async function exists(dir: DirHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (e) {
    if ((e as { name?: string })?.name === "NotFoundError") return false;
    throw e;
  }
}

async function writeOne(dir: DirHandle, name: string, data: Uint8Array, existed: boolean): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  let w: Writable | null = null;
  try {
    w = await fh.createWritable();
    await w.write(data);
    await w.close();
  } catch (e) {
    // The writable's swap file is dropped, so the old file (if any) is untouched.
    if (w) await w.abort().catch(() => {}); // already failing; the original error is what we report
    // A new file we created is left empty: remove it, never one that was there before.
    if (!existed) await dir.removeEntry(name).catch(() => {}); // best effort; the status already says not saved
    throw e;
  }
}

/**
 * Pick, build, save. `baseName` is already validated; `generate` builds both files from
 * one frozen snapshot. Call it straight from the click handler (no await before it).
 */
export async function runYearExport(
  baseName: string,
  generate: () => Promise<ExportBytes>,
  env: ExportEnv,
  opts: { mode?: "auto" | "download" } = {},
): Promise<ExportOutcome> {
  const names = { xlsx: `${baseName}.xlsx`, pdf: `${baseName}.pdf` };

  // Card #308: download mode (the dialog's Export) skips the folder picker even where the browser has one.
  if (env.showDirectoryPicker && opts.mode !== "download") {
    let dir: DirHandle;
    try {
      dir = await env.showDirectoryPicker();
    } catch (e) {
      // Chrome refuses Downloads, Desktop and Documents themselves ("contains system
      // files"); Cancel on that refusal arrives here as an ordinary cancel.
      if ((e as { name?: string })?.name === "AbortError") return outcome({ kind: "cancelled", message: PICKER_CANCELLED });
      return outcome({ kind: "failed", message: `Could not open the folder: ${errText(e)}` });
    }
    let existed: Record<"xlsx" | "pdf", boolean>;
    try {
      existed = { xlsx: await exists(dir, names.xlsx), pdf: await exists(dir, names.pdf) };
    } catch (e) {
      return outcome({ kind: "failed", message: `Could not read the folder: ${errText(e)}` });
    }
    const clash = (["xlsx", "pdf"] as const).filter((k) => existed[k]).map((k) => names[k]);
    if (clash.length && !env.confirm(`Replace ${clash.join(" and ")} in that folder?`)) {
      return outcome({ kind: "cancelled", message: "Cancelled. Nothing was saved." });
    }
    let files: ExportBytes;
    try {
      files = await generate();
    } catch (e) {
      return outcome({ kind: "failed", message: `Export failed: ${errText(e)}. Nothing was saved.` });
    }
    const saved: string[] = [];
    const failed: { name: string; error: string }[] = [];
    for (const k of ["xlsx", "pdf"] as const) {
      try {
        await writeOne(dir, names[k], files[k], existed[k]);
        saved.push(names[k]);
      } catch (e) {
        failed.push({ name: names[k], error: errText(e) });
      }
    }
    if (!failed.length) return outcome({ kind: "saved", message: `Saved ${saved.join(" and ")}.`, saved });
    const notSaved = failed.map((f) => `${f.name} not saved: ${f.error}`).join("; ");
    return outcome({
      kind: saved.length ? "partial" : "failed",
      message: saved.length ? `Saved ${saved.join(" and ")}; ${notSaved}.` : `Nothing was saved. ${notSaved}.`,
      saved,
      failed,
    });
  }

  let files: ExportBytes;
  try {
    files = await generate();
  } catch (e) {
    return outcome({ kind: "failed", message: `Export failed: ${errText(e)}. Nothing was saved.` });
  }
  const retry = (["xlsx", "pdf"] as const).map((k) => ({
    name: names[k],
    url: env.createObjectURL(new Blob([files[k] as BlobPart], { type: MIME[k] })),
  }));
  for (const r of retry) env.startDownload(r.url, r.name);
  let released = false;
  return outcome({
    kind: "downloads",
    message: "Downloads started. If a file did not arrive, use its link below.",
    retry,
    release: () => {
      if (released) return;
      released = true;
      for (const r of retry) env.revokeObjectURL(r.url);
    },
  });
}
