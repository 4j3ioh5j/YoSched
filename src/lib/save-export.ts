// Card #299: save the year export's two files as two downloads, kept as retry links until
// release(). The result always says exactly what was started: never a false "saved both".
// Card #311: no folder picker. Chrome refuses Desktop, Downloads and Documents as folders and
// warns about "edit files" on any other folder; its own "Ask where to save each file" setting
// gives the Mac save dialog for any folder, so downloads are the one way.

export type ExportEnv = {
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

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)) || "unknown error";
const outcome = (o: Partial<ExportOutcome> & Pick<ExportOutcome, "kind" | "message">): ExportOutcome => ({
  saved: [], failed: [], retry: [], release: () => {}, ...o,
});

/** The browser's real environment. */
export function browserExportEnv(): ExportEnv {
  return {
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

/** Build both files from one frozen snapshot (`baseName` is already validated), then
 *  download them. */
export async function runYearExport(
  baseName: string,
  generate: () => Promise<ExportBytes>,
  env: ExportEnv,
): Promise<ExportOutcome> {
  const names = { xlsx: `${baseName}.xlsx`, pdf: `${baseName}.pdf` };
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
