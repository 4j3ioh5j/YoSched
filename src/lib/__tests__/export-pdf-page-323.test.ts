// Card #323: the year PDF uses the Settings paper and margin, like the printout.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exportYearPdf, pdfMonthLayout, pdfPage } from "../export-pdf";
import { buildPrintedMonth } from "../print-month-model";
import { DEFAULT_PRINT_LAYOUT, type PrintLayout } from "../print-layout";
import { input, NOW } from "./fixtures/export-input";

const fonts = {
  regular: new Uint8Array(readFileSync(join(__dirname, "../../../public/fonts/ArchivoNarrow-Regular.ttf"))),
  bold: new Uint8Array(readFileSync(join(__dirname, "../../../public/fonts/ArchivoNarrow-Bold.ttf"))),
};
const big = { fontSize: 14, header: { ...DEFAULT_PRINT_LAYOUT.header, size: 32 }, footer: { ...DEFAULT_PRINT_LAYOUT.footer, size: 32 } };
const many = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, initials: `S${i}`, employmentTypeId: "ft", ftePercentage: 1, isActive: true }));

describe("pdfPage", () => {
  it("landscape Letter / A4 in points, margin from Settings", () => {
    expect(pdfPage(DEFAULT_PRINT_LAYOUT)).toEqual({ w: 792, h: 612, margin: 18, format: "letter" });
    const a4 = pdfPage({ ...DEFAULT_PRINT_LAYOUT, paper: "a4", marginHundredths: 100 });
    expect(a4.w).toBeCloseTo(841.89, 1);
    expect(a4.h).toBeCloseTo(595.28, 1);
    expect(a4.margin).toBe(72);
    expect(a4.format).toBe("a4");
  });
});

describe("every month stays inside the margin, both papers, smallest and largest margin", () => {
  for (const paper of ["letter", "a4"] as const) {
    for (const marginHundredths of [25, 100]) {
      for (const extra of [{}, big]) {
        const layout: PrintLayout = { ...DEFAULT_PRINT_LAYOUT, ...extra, paper, marginHundredths };
        it(`${paper} ${marginHundredths} ${extra === big ? "big" : "default"}`, () => {
          const P = pdfPage(layout);
          for (const month of [1, 11]) { // February (28 days) and December (31)
            const m = buildPrintedMonth(input({ staff: many, printLayout: layout }), 2026, month, NOW);
            const l = pdfMonthLayout(m);
            expect(l.titleTop).toBeGreaterThanOrEqual(P.margin - 0.01);
            expect(l.tableTop + l.rowH * 32).toBeLessThanOrEqual(l.footerTop + 0.01);
            expect(l.footerTop + l.footerSize).toBeLessThanOrEqual(P.h - P.margin + 0.01);
            expect(l.tableLeft).toBeGreaterThanOrEqual(P.margin - 0.01);
            expect(l.tableLeft + l.colW.reduce((a, b) => a + b, 0) + l.labelW).toBeLessThanOrEqual(P.w - P.margin + 0.01);
            expect(l.fontSize * 1.15).toBeLessThanOrEqual(l.rowH + 0.01);
          }
          // The row height is the same for a 28- and a 31-day month.
          const feb = pdfMonthLayout(buildPrintedMonth(input({ printLayout: layout }), 2026, 1, NOW));
          const dec = pdfMonthLayout(buildPrintedMonth(input({ printLayout: layout }), 2026, 11, NOW));
          expect(feb.rowH).toBe(dec.rowH);
        });
      }
    }
  }
});

describe("exportYearPdf page size", () => {
  it("A4 pages when Settings say A4", async () => {
    const layout = { ...DEFAULT_PRINT_LAYOUT, paper: "a4" as const };
    const months = [0, 1].map((mo) => buildPrintedMonth(input({ printLayout: layout }), 2026, mo, NOW));
    const text = new TextDecoder("latin1").decode(await exportYearPdf(months, fonts, { compress: false }));
    const boxes = [...text.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((x) => x[1].trim().split(/\s+/).map(Number));
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    for (const b of boxes) { expect(b[2]).toBeCloseTo(841.89, 0); expect(b[3]).toBeCloseTo(595.28, 0); }
  });
  it("Letter pages by default", async () => {
    const months = [0, 1].map((mo) => buildPrintedMonth(input(), 2026, mo, NOW));
    const text = new TextDecoder("latin1").decode(await exportYearPdf(months, fonts, { compress: false }));
    const boxes = [...text.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((x) => x[1].trim().split(/\s+/).map(Number));
    for (const b of boxes) { expect(b[2]).toBeCloseTo(792, 0); expect(b[3]).toBeCloseTo(612, 0); }
  });
});
