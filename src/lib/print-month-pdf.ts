// Card #476: the Print button prints the selected month as a PDF — the same drawing as the
// year export's page for that month — instead of the browser's own print of the web page.
// The PDF is built from cells frozen at the click, then loaded into a hidden frame and
// printed from there. When the frame cannot print (a browser that blocks it), the PDF opens
// in a new tab so it can still be printed from the viewer.

import { buildPrintedMonth, type ExportScheduleInput } from "./print-month-model";
import { exportYearPdf } from "./export-pdf";
import type { PdfFonts } from "./export-year-files";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** One month (0 = January) → a one-page PDF. A font load failure rejects before anything is built. */
export async function buildMonthPdf(
  input: ExportScheduleInput,
  year: number,
  month: number,
  now: Date,
  loadFonts: () => Promise<PdfFonts>,
  opts: { compress?: boolean } = {},
): Promise<Uint8Array> {
  const fonts = await loadFonts();
  const printed = buildPrintedMonth(input, year, month, now);
  return exportYearPdf([printed], fonts, { ...opts, title: `${MONTH_NAMES[month]} ${year} schedule` });
}

/** The frozen input with the printed month's version set to the one the print flow ensured. */
export function withPrintedVersion(input: ExportScheduleInput, year: number, month: number, versionNumber: number | null): ExportScheduleInput {
  if (versionNumber == null) return input;
  return {
    ...input,
    versions: [...input.versions.filter((v) => !(v.year === year && v.month === month)), { year, month, versionNumber }],
  };
}

export type PdfPrintFrame = { print: () => void; remove: () => void };
export type PdfPrintEnv = {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  /** Load the URL in a hidden frame; resolves once loaded, rejects on error or timeout. */
  loadFrame: (url: string) => Promise<PdfPrintFrame>;
  /** Open the URL in a new tab; false when the browser blocked it. */
  open: (url: string) => boolean;
};

export type PdfPrintOutcome = "printed" | "opened" | "failed";

/**
 * A printer that keeps at most one PDF alive: the last frame (and its URL) stays until the next
 * print or dispose(), because removing it while the print dialog is open would cancel the print.
 */
export function createPdfPrinter(env: PdfPrintEnv) {
  let last: { url: string; frame: PdfPrintFrame | null } | null = null;
  const release = () => {
    if (!last) return;
    const { url, frame } = last;
    last = null;
    frame?.remove();
    env.revokeObjectURL(url);
  };
  return {
    async print(bytes: Uint8Array): Promise<PdfPrintOutcome> {
      release();
      const url = env.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      let frame: PdfPrintFrame | null = null;
      try {
        frame = await env.loadFrame(url);
        frame.print();
        last = { url, frame };
        return "printed";
      } catch {
        frame?.remove();
        if (env.open(url)) {
          last = { url, frame: null };
          return "opened";
        }
        env.revokeObjectURL(url);
        return "failed";
      }
    },
    dispose: release,
  };
}

/** How long a hidden frame may take to load the PDF before Print falls back to a new tab. */
export const FRAME_LOAD_TIMEOUT_MS = 15_000;

type Focusable = { focus: () => void };

/**
 * Print a frame's window, then give the keyboard back to the page: left in the hidden frame,
 * the next Ctrl/Cmd+P would reach the old PDF instead of the app's Print.
 */
export function printThenRefocus(frameWindow: Focusable & { print: () => void }, previous: unknown, page: Focusable = window) {
  frameWindow.focus();
  try {
    frameWindow.print();
  } finally {
    // The page window first (an unfocusable body would not take focus back), then the element
    // that had it, e.g. the Print button.
    page.focus();
    const prev = previous as Partial<Focusable> | null;
    if (prev && typeof prev.focus === "function") prev.focus();
  }
}

/** The browser's real environment. */
export function browserPdfPrintEnv(): PdfPrintEnv {
  return {
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    loadFrame: (url) =>
      new Promise<PdfPrintFrame>((resolve, reject) => {
        const iframe = document.createElement("iframe");
        iframe.setAttribute("aria-hidden", "true");
        iframe.tabIndex = -1;
        // Off screen but rendered: a display:none frame never loads its PDF viewer.
        Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", border: "0", opacity: "0", pointerEvents: "none" });
        const remove = () => iframe.remove();
        const timer = window.setTimeout(() => { remove(); reject(new Error("the PDF did not load")); }, FRAME_LOAD_TIMEOUT_MS);
        iframe.onload = () => {
          window.clearTimeout(timer);
          const w = iframe.contentWindow;
          if (!w) { remove(); reject(new Error("no frame window")); return; }
          resolve({ print: () => printThenRefocus(w, document.activeElement), remove });
        };
        iframe.onerror = () => { window.clearTimeout(timer); remove(); reject(new Error("the PDF did not load")); };
        iframe.src = url;
        document.body.appendChild(iframe);
      }),
    // Not "noopener": with it window.open always returns null, so a blocked popup could not be told apart.
    open: (url) => {
      const w = window.open(url, "_blank");
      if (!w) return false;
      try { w.opener = null; } catch { /* already detached */ }
      return true;
    },
  };
}
