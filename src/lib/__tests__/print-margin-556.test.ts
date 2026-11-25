// Card #556: the printed month's left edge was cut off on Windows. Printed landscape, the page's
// left edge lands on the paper's leading or trailing edge, the widest unprintable edge on many
// US printers (up to about 0.5 in). The margin floor and default are now 0.5 in, and a margin
// saved below it under the old 0.25 in floor prints at the floor.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_PRINT_LAYOUT, DEFAULT_PRINT_MARGIN, PRINT_MARGIN_MIN, printLayoutFrom, printPage, validatePrintMargin,
} from "../print-layout";
import { pdfMonthLayout, pdfPage } from "../export-pdf";
import { buildPrintedMonth } from "../print-month-model";
import { input, NOW } from "./fixtures/export-input";

describe("the print margin floor (card #556)", () => {
  it("is 0.5 in, and the default is the floor", () => {
    expect(PRINT_MARGIN_MIN).toBe(50);
    expect(DEFAULT_PRINT_MARGIN).toBe(50);
    expect(DEFAULT_PRINT_LAYOUT.marginHundredths).toBe(50);
  });
  it("a new save must be 0.50 to 1.00 in", () => {
    for (const ok of [50, 75, 100]) expect(validatePrintMargin(ok), String(ok)).toBe(true);
    for (const bad of [25, 49, 101, 50.5, "50", null]) expect(validatePrintMargin(bad), String(bad)).toBe(false);
  });
  it("a margin saved under the old floor prints at the new one; larger ones are kept", () => {
    for (const old of [25, 30, 49]) {
      expect(printLayoutFrom({ printMarginHundredthsIn: old }).marginHundredths, String(old)).toBe(50);
      expect(printPage({ paper: "letter", marginHundredths: old }).marginIn, String(old)).toBe(0.5);
    }
    expect(printLayoutFrom({ printMarginHundredthsIn: 80 }).marginHundredths).toBe(80);
    expect(printPage({ paper: "letter", marginHundredths: 80 }).marginIn).toBe(0.8);
    // Junk still falls back to the default.
    for (const junk of [0, 24, 101, "x", null]) expect(printLayoutFrom({ printMarginHundredthsIn: junk }).marginHundredths, String(junk)).toBe(50);
  });
  it("the PDF keeps the title, table and footer at least 0.5 in inside every edge", () => {
    for (const stored of [25, 50]) {
      const m = buildPrintedMonth(input({ printLayout: { ...DEFAULT_PRINT_LAYOUT, marginHundredths: stored } }), 2026, 0, NOW);
      const page = pdfPage(m.layout);
      expect(page.margin).toBe(36);
      const l = pdfMonthLayout(m);
      const tableW = l.colW.reduce((a, b) => a + b, 0);
      expect(l.tableLeft).toBeGreaterThanOrEqual(36);
      expect(l.tableLeft + tableW + l.labelW).toBeLessThanOrEqual(page.w - 36 + 1e-6);
      expect(l.titleTop).toBeGreaterThanOrEqual(36);
      expect(l.footerTop + l.footerSize).toBeLessThanOrEqual(page.h - 36 + 1e-6);
    }
  });
  it("Settings says 0.50 to 1.00 and no longer claims 0.25 in prints everywhere", () => {
    const ui = readFileSync(join(__dirname, "../../app/settings/settings-page.tsx"), "utf8");
    expect(ui).not.toMatch(/0\.25 in is the smallest edge/);
    expect(ui).toMatch(/0\.50 to 1\.00/);
    const route = readFileSync(join(__dirname, "../../app/api/settings/scheduling-preferences/route.ts"), "utf8");
    expect(route).toMatch(/printMarginHundredthsIn must be a whole number from 50 to 100/);
  });
});
