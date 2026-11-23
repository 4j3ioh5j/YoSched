// Card #482: the PDF sizes its columns and shrinks a cell's text by the font's real glyph
// widths, not only a fixed per-character estimate, so wide letters (W, M, m, w, bold 4…) stay
// inside their cell in every bundled font and both weights.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exportYearPdf, pdfMonthLayout, pdfCellFontSize, pdfTextMeasure } from "../export-pdf";
import { buildPrintedMonth, buildPrintedYear, type PrintedMonth } from "../print-month-model";
import { DEFAULT_PRINT_LAYOUT, DEFAULT_UD_WIDTH, type UdWidthSettings } from "../print-layout";
import { PDF_FONTS } from "../pdf-fonts";
import { input, NOW } from "./fixtures/export-input";
import { ttfWidth, ttfGlyphEm } from "./fixtures/ttf-widths";

const ROOT = join(__dirname, "../../..");
const CELL_PAD = 4;
const estimate = (s: string, size: number) => s.length * size * 0.52;
/** The upper bound the PDF should size by: the estimate or either weight's real width. */
const realMeasure = (f: (typeof PDF_FONTS)[number]) => {
  const reg = ttfWidth(f.regular), bold = ttfWidth(f.bold);
  return (s: string, size: number) => Math.max(estimate(s, size), reg(s, size), bold(s, size));
};
const WIDE = ["WWWW", "4444", "mmww&", "MW, WT, VX", "WMWM WMWM"];

function wideMonth(ud: Partial<UdWidthSettings> = {}): PrintedMonth {
  const m = buildPrintedMonth(input({ printLayout: { ...DEFAULT_PRINT_LAYOUT, udWidth: { ...DEFAULT_UD_WIDTH, ...ud } } }), 2026, 0, NOW);
  const columns = [...m.columns, { kind: "agg" as const, label: "WIDE", key: "agg:w" }, { kind: "agg" as const, label: "MWMW", key: "agg:m" }];
  const rows = m.rows.map((r, k) => ({
    ...r,
    cells: [
      ...r.cells.map((c, j) => (j === 0 && k < WIDE.length ? { ...c, text: WIDE[k], bold: k % 2 === 0 } : c)),
      { text: WIDE[k % WIDE.length], bg: null, bold: true },
      { text: k % 2 ? "WWW" : "mmm", bg: null, bold: false },
    ],
  }));
  return { ...m, columns, rows } as PrintedMonth;
}

const textsOf = (m: PrintedMonth) => [
  [...(m.splitDateDay ? ["DATE", "DAY"] : ["DATE"]), ...m.columns.map((c) => c.label)],
  ...m.rows.map((r) => [...(m.splitDateDay ? [r.dateText, r.dayText ?? ""] : [r.dateText]), ...r.cells.map((c) => c.text)]),
];

/** Every cell's text, drawn at the size the PDF draws it, fits inside its column in both weights. */
function expectAllFit(m: PrintedMonth, f: (typeof PDF_FONTS)[number]) {
  const measure = realMeasure(f);
  const l = pdfMonthLayout(m, measure);
  const reg = ttfWidth(f.regular), bold = ttfWidth(f.bold);
  for (const row of textsOf(m)) {
    row.forEach((t, i) => {
      if (!t) return;
      const size = pdfCellFontSize(t, l.colW[i], l.fontSize, measure);
      const w = Math.max(reg(t, size), bold(t, size));
      expect(w, `${f.id} "${t}" in column ${i}`).toBeLessThanOrEqual(l.colW[i] - CELL_PAD + 1e-6);
    });
  }
}

describe("cells fit by real glyph widths (card #482)", () => {
  for (const f of PDF_FONTS) {
    it(`${f.label}: best-fit columns hold wide text in both weights`, () => expectAllFit(wideMonth(), f));
    it(`${f.label}: a narrow set width shrinks the wide text to fit`, () => expectAllFit(wideMonth({ mode: "uniform", uniformHundredths: 30 }), f));
    it(`${f.label}: match-largest columns hold wide text`, () => expectAllFit(wideMonth({ mode: "matchLargest" }), f));
  }
  it("the fixed estimate alone lets wide bold text overflow (the case this card fixes)", () => {
    const f = PDF_FONTS.find((x) => x.id === "archivo-narrow")!;
    expect(ttfWidth(f.bold)("WWWW", 10)).toBeGreaterThan(estimate("WWWW", 10));
  });
  it("text the estimate already covers lays out exactly as before", () => {
    for (const f of PDF_FONTS) {
      const narrow = (s: string, size: number) => estimate(s, size); // a measure never above the estimate
      for (const m of buildPrintedYear(input(), 2026, NOW)) {
        expect(pdfMonthLayout(m, narrow)).toEqual(pdfMonthLayout(m));
        // the real measure never makes a column narrower than the estimate does
        const real = pdfMonthLayout(m, realMeasure(f)), est = pdfMonthLayout(m);
        expect(real.fontSize, f.id).toBeLessThanOrEqual(est.fontSize + 1e-9);
      }
    }
  });
});

describe("the jsPDF measure (card #482)", () => {
  for (const f of PDF_FONTS) {
    it(`${f.label}: matches the font file's widths, takes the wider weight, never under the estimate`, async () => {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt" });
      const b64 = (file: string) => readFileSync(join(ROOT, "public/fonts", file)).toString("base64");
      doc.addFileToVFS(`${f.family}-Regular.ttf`, b64(f.regular));
      doc.addFont(`${f.family}-Regular.ttf`, f.family, "normal");
      doc.addFileToVFS(`${f.family}-Bold.ttf`, b64(f.bold));
      doc.addFont(`${f.family}-Bold.ttf`, f.family, "bold");
      doc.setFont(f.family, "normal");
      doc.setFontSize(7);
      const measure = pdfTextMeasure(doc, f.family);
      const want = realMeasure(f);
      for (const s of [...WIDE, "01/31", "ICU", "a", "iiii"]) expect(measure(s, 9), s).toBeCloseTo(want(s, 9), 1);
      // Measuring leaves the document's font as it was.
      expect(doc.getFont().fontStyle).toBe("normal");
      expect(doc.getFontSize()).toBe(7);
    });
  }
  it("the export lays out and shrinks cells with it", () => {
    const src = readFileSync(join(ROOT, "src/lib/export-pdf.ts"), "utf8");
    expect(src).toMatch(/const measure = pdfTextMeasure\(doc, FONT\)/);
    expect(src).toMatch(/pdfMonthLayout\(m, measure\)/);
    expect(src).toMatch(/pdfCellFontSize\(t, colW\[i\], lay\.fontSize, measure\)/);
  });
});

// The PDF itself: every table cell's text, as drawn, sits inside the grid lines around it.
describe("the exported PDF keeps each cell's text inside its column (card #482)", () => {
  const CUSTOM = /^\/F(\d+) [\d.]+ Tf$/;
  async function drawn(m: PrintedMonth, f: (typeof PDF_FONTS)[number]) {
    const file = (n: string) => new Uint8Array(readFileSync(join(ROOT, "public/fonts", n)));
    const pdf = new TextDecoder("latin1").decode(await exportYearPdf([m], { regular: file(f.regular), bold: file(f.bold), family: f.family }, { compress: false }));
    const lines = pdf.split("\n");
    // Grid: vertical lines are "x y1 m" then "x y2 l" with the same x.
    const xs = new Set<number>();
    let top = -Infinity, bottom = Infinity;
    for (let i = 0; i + 1 < lines.length; i++) {
      const a = lines[i].match(/^([\d.]+) ([\d.]+) m$/), b = lines[i + 1].match(/^([\d.]+) ([\d.]+) l$/);
      if (a && b && a[1] === b[1] && a[2] !== b[2]) {
        xs.add(+a[1]);
        top = Math.max(top, +a[2], +b[2]);
        bottom = Math.min(bottom, +a[2], +b[2]);
      }
    }
    const grid = [...xs].sort((p, q) => p - q);
    // Text: "/Fn size Tf" … "x y Td" … "<hex> Tj". The two embedded fonts are the newest
    // resources; the regular weight is added first.
    const used = [...new Set(lines.filter((l) => CUSTOM.test(l)).map((l) => +l.match(CUSTOM)![1]))].sort((p, q) => p - q);
    const fontIds = [...new Set(pdf.match(/\/F(\d+) \d+ 0 R/g)!.map((s) => +s.match(/\d+/)![0]))].sort((p, q) => p - q).slice(-2);
    expect(used.every((n) => fontIds.includes(n))).toBe(true);
    const emOf = new Map([[fontIds[0], ttfGlyphEm(f.regular)], [fontIds[1], ttfGlyphEm(f.bold)]]);
    const cells: { x0: number; x1: number; y: number }[] = [];
    let font = 0, size = 0, x = 0, y = 0;
    for (const l of lines) {
      let r: RegExpMatchArray | null;
      if ((r = l.match(/^\/F(\d+) ([\d.]+) Tf$/))) { font = +r[1]; size = +r[2]; }
      else if ((r = l.match(/^([\d.-]+) ([\d.-]+) Td$/))) { x = +r[1]; y = +r[2]; }
      else if ((r = l.match(/^<([0-9a-f]+)> Tj$/)) && emOf.has(font)) {
        const em = emOf.get(font)!;
        const w = (r[1].match(/.{4}/g) ?? []).reduce((a, h) => a + em(parseInt(h, 16)), 0) * size;
        cells.push({ x0: x, x1: x + w, y });
      }
    }
    return { grid, cells: cells.filter((c) => c.y < top && c.y > bottom && c.x0 >= grid[0] && c.x0 < grid[grid.length - 1]) };
  }
  for (const f of PDF_FONTS) {
    for (const [name, ud] of [["best fit", {}], ["a narrow set width", { mode: "uniform", uniformHundredths: 30 }], ["match largest", { mode: "matchLargest" }]] as const) {
      it(`${f.label}, ${name}`, async () => {
        const m = wideMonth(ud as Partial<UdWidthSettings>);
        const { grid, cells } = await drawn(m, f);
        expect(grid.length).toBe(textsOf(m)[0].length + 1);
        expect(cells.length).toBe(textsOf(m).flat().filter(Boolean).length);
        for (const c of cells) {
          const k = grid.findIndex((g, i) => i + 1 < grid.length && c.x0 >= g && c.x0 < grid[i + 1]);
          expect(c.x0, `cell at y ${c.y}`).toBeGreaterThanOrEqual(grid[k] + CELL_PAD / 2 - 0.01);
          expect(c.x1, `cell at y ${c.y}`).toBeLessThanOrEqual(grid[k + 1] - CELL_PAD / 2 + 0.01);
        }
      });
    }
  }
});
