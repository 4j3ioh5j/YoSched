// Card #477: the fonts the PDF (month print and year export) can embed. A PDF must carry its
// font, so each choice is a pair of bundled OFL files in public/fonts; which one prints is the
// Settings value scheduling_preferences.printPdfFont (an id below). Adding a font means adding
// its files and license there and one entry here; a test keeps it no wider than Archivo Narrow,
// because the PDF's layout uses a fixed width estimate.

/** `family`: the name the PDF lists the font under. */
export type PdfFont = { id: string; label: string; family: string; regular: string; bold: string; license: string };

export const PDF_FONTS: readonly PdfFont[] = [
  { id: "archivo-narrow", label: "Archivo Narrow", family: "ArchivoNarrow", regular: "ArchivoNarrow-Regular.ttf", bold: "ArchivoNarrow-Bold.ttf", license: "ArchivoNarrow-OFL.txt" },
  // Medium for the normal text: the owner picked it from a printed test sheet (it printed the
  // thin I in "ICU" as evenly as C and U).
  { id: "barlow-semi-condensed", label: "Barlow Semi Condensed", family: "BarlowSemiCondensed", regular: "BarlowSemiCondensed-Medium.ttf", bold: "BarlowSemiCondensed-Bold.ttf", license: "BarlowSemiCondensed-OFL.txt" },
];

export const DEFAULT_PDF_FONT = "archivo-narrow";

export function isPdfFontId(v: unknown): v is string {
  return typeof v === "string" && PDF_FONTS.some((f) => f.id === v);
}

/** The font with that id; any unknown id (an older or newer build's font) → the default. */
export function pdfFontById(id: unknown): PdfFont {
  return PDF_FONTS.find((f) => f.id === id) ?? PDF_FONTS.find((f) => f.id === DEFAULT_PDF_FONT)!;
}
