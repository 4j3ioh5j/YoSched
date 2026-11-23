// Card #477: the PDF's font is a Setting. The fonts are bundled files (public/fonts), so the
// list of choices is code; which one prints is Settings data (scheduling_preferences.printPdfFont).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PDF_FONTS, DEFAULT_PDF_FONT, isPdfFontId, pdfFontById } from "../pdf-fonts";
import { printLayoutFrom, DEFAULT_PRINT_LAYOUT } from "../print-layout";
import { fetchPdfFonts } from "../export-year-files";
import { buildMonthPdf } from "../print-month-pdf";
import { input, NOW } from "./fixtures/export-input";
import { ttfAdvanceEm } from "./fixtures/ttf-widths";

const ROOT = join(__dirname, "../../..");
const fontFile = (f: string) => new Uint8Array(readFileSync(join(ROOT, "public/fonts", f)));
const pdfText = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("the bundled PDF fonts (card #477)", () => {
  it("Archivo Narrow stays the default, and Barlow Semi Condensed is a choice", () => {
    expect(DEFAULT_PDF_FONT).toBe("archivo-narrow");
    expect(PDF_FONTS.map((f) => f.id)).toEqual(["archivo-narrow", "barlow-semi-condensed"]);
    expect(pdfFontById("barlow-semi-condensed")).toMatchObject({ label: "Barlow Semi Condensed", regular: "BarlowSemiCondensed-Medium.ttf", bold: "BarlowSemiCondensed-Bold.ttf" });
  });
  it("every font's files and its license ship in public/fonts", () => {
    for (const f of PDF_FONTS) {
      for (const file of [f.regular, f.bold, f.license]) expect(existsSync(join(ROOT, "public/fonts", file)), file).toBe(true);
    }
  });
  it("only the registry's ids are valid; an unknown one falls back to the default", () => {
    expect(isPdfFontId("barlow-semi-condensed")).toBe(true);
    for (const bad of ["Barlow", "", null, 3, "archivo-narrow ", "__proto__", "toString"]) expect(isPdfFontId(bad), String(bad)).toBe(false);
    expect(pdfFontById("gone-font").id).toBe("archivo-narrow");
    expect(pdfFontById("toString").id).toBe("archivo-narrow");
  });
  it("no font is wider than Archivo Narrow on average (capitals and digits)", () => {
    // Average advance of capitals + digits (the schedule's codes and dates) in em, from hmtx.
    const avg = (file: string) => {
      const adv = ttfAdvanceEm(file);
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      return [...chars].reduce((a, ch) => a + adv(ch), 0) / chars.length;
    };
    const base = PDF_FONTS[0];
    for (const f of PDF_FONTS) {
      expect(avg(f.regular), f.regular).toBeLessThanOrEqual(avg(base.regular) + 0.01);
      expect(avg(f.bold), f.bold).toBeLessThanOrEqual(avg(base.bold) + 0.01);
    }
  });
});

describe("the setting in the print layout (card #477)", () => {
  it("defaults to Archivo Narrow, reads a known id, and ignores an unknown one", () => {
    expect(DEFAULT_PRINT_LAYOUT.pdfFont).toBe("archivo-narrow");
    expect(printLayoutFrom(null).pdfFont).toBe("archivo-narrow");
    expect(printLayoutFrom({}).pdfFont).toBe("archivo-narrow");
    expect(printLayoutFrom({ printPdfFont: "barlow-semi-condensed" }).pdfFont).toBe("barlow-semi-condensed");
    for (const bad of ["gone-font", "", null, 7]) expect(printLayoutFrom({ printPdfFont: bad }).pdfFont).toBe("archivo-narrow");
  });
  it("the migration adds the column with the Archivo Narrow default (existing installs print as before)", () => {
    const sql = readFileSync(join(ROOT, "prisma/migrations/20261213000000_print_pdf_font/migration.sql"), "utf8");
    expect(sql).toMatch(/ADD COLUMN "printPdfFont" TEXT NOT NULL DEFAULT 'archivo-narrow'/);
    expect(readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")).toMatch(/printPdfFont\s+String\s+@default\("archivo-narrow"\)/);
  });
});

describe("loading the chosen font (card #477)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stubFetch = () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => { urls.push(u); return new Response(new Uint8Array([1, 2, 3])); });
    return urls;
  };
  it("fetches the chosen font's two files", async () => {
    const urls = stubFetch();
    await fetchPdfFonts("/yosched", "barlow-semi-condensed");
    expect(urls.sort()).toEqual(["/yosched/fonts/BarlowSemiCondensed-Bold.ttf", "/yosched/fonts/BarlowSemiCondensed-Medium.ttf"]);
  });
  it("names the font family for the PDF", async () => {
    stubFetch();
    expect((await fetchPdfFonts("", "barlow-semi-condensed")).family).toBe("BarlowSemiCondensed");
    stubFetch();
    expect((await fetchPdfFonts("", undefined)).family).toBe("ArchivoNarrow");
  });
  it("an unknown or missing id loads Archivo Narrow", async () => {
    for (const id of ["gone-font", undefined]) {
      const urls = stubFetch();
      await fetchPdfFonts("", id);
      expect(urls.sort()).toEqual(["/fonts/ArchivoNarrow-Bold.ttf", "/fonts/ArchivoNarrow-Regular.ttf"]);
    }
  });
  it("a month PDF built with Barlow embeds Barlow, not Archivo", async () => {
    const f = pdfFontById("barlow-semi-condensed");
    const pdf = pdfText(await buildMonthPdf(input(), 2026, 0, NOW, async () => ({ regular: fontFile(f.regular), bold: fontFile(f.bold), family: f.family }), { compress: false }));
    expect(pdf).toMatch(/\/FontName \/BarlowSemiCondensed\b/);
    expect(pdf).not.toMatch(/\/FontName \/[A-Z]*\+?ArchivoNarrow/);
  });
});

describe("callers pass the font frozen with the cells (card #477)", () => {
  const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
  it("the month print loads the frozen input's font", () => {
    expect(src("src/app/schedule-grid.tsx")).toMatch(/fetchPdfFonts\(BASE_PATH, frozen\.printLayout\.pdfFont\)/);
  });
  it("the year export loads the frozen input's font", () => {
    expect(src("src/app/export-year-dialog.tsx")).toMatch(/fetchPdfFonts\(BASE_PATH, input\.printLayout\.pdfFont\)/);
  });
  it("Settings › Table Font saves and resets the PDF font", () => {
    const ui = src("src/app/settings/settings-page.tsx");
    const i = ui.indexOf("function PrintFontSection(");
    const body = ui.slice(i, ui.indexOf("\nfunction ", i + 10));
    expect(body).toMatch(/printPdfFont: draft\.pdfFont/);
    expect(body).toMatch(/printPdfFont: defaults\.pdfFont/);
    expect(body).toMatch(/PDF_FONTS\.map/);
    expect(body).toMatch(/aria-label="PDF font"/);
  });
});
