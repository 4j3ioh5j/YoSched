import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exportYearPdf, pdfMonthLayout, PAGE } from "../export-pdf";
import { buildPrintedMonth, buildPrintedYear } from "../print-month-model";
import { DEFAULT_PRINT_LAYOUT } from "../print-layout";
import { input, NOW } from "./fixtures/export-input";

// Card #299: the PDF half of the year export. One landscape Letter page per month,
// with the narrow font embedded, and every month must fit on its one page.

const fonts = {
  regular: new Uint8Array(readFileSync(join(__dirname, "../../../public/fonts/ArchivoNarrow-Regular.ttf"))),
  bold: new Uint8Array(readFileSync(join(__dirname, "../../../public/fonts/ArchivoNarrow-Bold.ttf"))),
};

const big = { ...DEFAULT_PRINT_LAYOUT, fontSize: 14, header: { ...DEFAULT_PRINT_LAYOUT.header, size: 32 }, footer: { ...DEFAULT_PRINT_LAYOUT.footer, size: 32 } };

describe("pdfMonthLayout (card #299)", () => {
  it("a 31-day month at the largest fonts fits the page height and width", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, initials: `S${i}`, employmentTypeId: "ft", ftePercentage: 1, isActive: true }));
    const m = buildPrintedMonth(input({ staff: many, printLayout: big }), 2026, 11, NOW); // December: 31 days, future → whole roster
    expect(m.rows).toHaveLength(31);
    const l = pdfMonthLayout(m);
    expect(l.tableTop + l.rowH * 32).toBeLessThanOrEqual(l.footerTop + 0.01);
    expect(l.footerTop + l.footerSize).toBeLessThanOrEqual(PAGE.h - PAGE.margin + 0.01);
    expect(l.tableLeft).toBeGreaterThanOrEqual(PAGE.margin - 0.01);
    expect(l.tableLeft + l.colW.reduce((a, b) => a + b, 0) + l.labelW).toBeLessThanOrEqual(PAGE.w - PAGE.margin + 0.01);
    expect(l.fontSize).toBeLessThanOrEqual(14);
    expect(l.fontSize).toBeGreaterThan(3);
    expect(l.fontSize * 1.15).toBeLessThanOrEqual(l.rowH + 0.01);
  });

  it("keeps the Settings font size when it fits", () => {
    const l = pdfMonthLayout(buildPrintedMonth(input(), 2026, 0, NOW));
    expect(l.fontSize).toBe(9);
  });
});

describe("exportYearPdf (card #299)", () => {
  it("writes a 12-page PDF with the narrow font embedded", async () => {
    const bytes = await exportYearPdf(buildPrintedYear(input(), 2026, NOW), fonts, { compress: false });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF")).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)?.length).toBe(12);
    expect(text).toMatch(/\/FontName \/ArchivoNarrow/);
    expect(text).toMatch(/\/FontFile2/);
  });
});
