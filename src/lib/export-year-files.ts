// Card #299: build both year-export files from ONE frozen snapshot and ONE timestamp.
// The fonts load first, so a missing font fails the whole export before anything is built.

import { buildPrintedYear, type ExportScheduleInput } from "./print-month-model";
import { exportYearXlsx } from "./export-xlsx";
import { exportYearPdf } from "./export-pdf";
import type { ExportBytes } from "./save-export";
import { pdfFontById } from "./pdf-fonts";

/** `family` names the font in the PDF (card #477); absent → "ArchivoNarrow", as before. */
export type PdfFonts = { regular: Uint8Array; bold: Uint8Array; family?: string };

export async function buildYearExportFiles(
  input: ExportScheduleInput,
  year: number,
  now: Date,
  loadFonts: () => Promise<PdfFonts>,
  pdfOpts: { compress?: boolean } = {},
): Promise<ExportBytes> {
  const fonts = await loadFonts();
  const months = buildPrintedYear(input, year, now);
  const xlsx = await exportYearXlsx(months);
  const pdf = await exportYearPdf(months, fonts, pdfOpts);
  return { xlsx, pdf };
}

/** The browser's font loader: the Settings PDF font's bundled TTFs (public/fonts; card #477).
 *  An unknown or missing id loads the default font. */
export async function fetchPdfFonts(basePath = "", fontId?: unknown): Promise<PdfFonts> {
  const font = pdfFontById(fontId);
  const get = async (file: string) => {
    const res = await fetch(`${basePath}/fonts/${file}`);
    if (!res.ok) throw new Error(`could not load the PDF font (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const [regular, bold] = await Promise.all([get(font.regular), get(font.bold)]);
  return { regular, bold, family: font.family };
}
