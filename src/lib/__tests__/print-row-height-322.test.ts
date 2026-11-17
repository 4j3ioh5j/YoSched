import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pdfMonthLayout } from "../export-pdf";
import { buildPrintedMonth } from "../print-month-model";
import { DEFAULT_PRINT_LAYOUT, printRowHeightIn, PRINT_PAGE, type PrintLayout } from "../print-layout";
import { input, NOW } from "./fixtures/export-input";

// Card #322: the printed schedule's rows are as tall as a 31-day month allows, and the same
// height every month (a shorter month leaves room at the bottom).

describe("year PDF: one row height for every month (card #322)", () => {
  it("February, April and December get the same row height", () => {
    const h = [1, 3, 11].map((mo) => pdfMonthLayout(buildPrintedMonth(input(), 2026, mo, NOW)).rowH);
    expect(h[0]).toBeCloseTo(h[2], 6);
    expect(h[1]).toBeCloseTo(h[2], 6);
  });

  it("a 31-day month fills the page down to the footer", () => {
    for (const fontSize of [6, 9, 14]) {
      const m = buildPrintedMonth(input({ printLayout: { ...DEFAULT_PRINT_LAYOUT, fontSize } }), 2026, 11, NOW);
      expect(m.rows).toHaveLength(31);
      const l = pdfMonthLayout(m);
      const bottom = l.tableTop + l.rowH * 32;
      expect(bottom).toBeLessThanOrEqual(l.footerTop + 0.01);
      expect(l.footerTop - bottom).toBeLessThan(4); // within the 3pt gap above the footer
    }
  });
});

describe("browser print: row height from the page (card #322)", () => {
  const withBlocks = (header: number, footer: number): PrintLayout => ({
    ...DEFAULT_PRINT_LAYOUT,
    header: { ...DEFAULT_PRINT_LAYOUT.header, size: header },
    footer: { ...DEFAULT_PRINT_LAYOUT.footer, size: footer },
  });

  it("title, 32 rows (header row + 31 days) and footer fit inside the margins of the shorter paper", () => {
    for (const [h, f] of [[16, 8], [6, 6], [32, 32]]) {
      const row = printRowHeightIn(withBlocks(h, f));
      const used = PRINT_PAGE.titleIn(h) + 32 * row + PRINT_PAGE.footerIn(f) + PRINT_PAGE.slackIn;
      expect(used).toBeLessThanOrEqual(PRINT_PAGE.heightIn - 2 * PRINT_PAGE.marginIn + 1e-9);
      expect(used).toBeGreaterThan(PRINT_PAGE.heightIn - 2 * PRINT_PAGE.marginIn - 0.01);
    }
  });

  it("is taller than the old fixed 0.19in at the default layout, and grows when the title shrinks", () => {
    expect(printRowHeightIn(DEFAULT_PRINT_LAYOUT)).toBeGreaterThan(0.2);
    expect(printRowHeightIn(withBlocks(6, 6))).toBeGreaterThan(printRowHeightIn(withBlocks(32, 32)));
  });

  it("the page is the shorter of US Letter and A4 landscape, with the 0.4in margin", () => {
    expect(PRINT_PAGE.heightIn).toBe(Math.min(8.5, 210 / 25.4));
    expect(PRINT_PAGE.marginIn).toBe(0.4);
  });

  it("the grid hands the row height to the print CSS, which uses it for header and day rows", () => {
    const grid = readFileSync(path.join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
    expect(grid).toMatch(/"--print-row-h": `\$\{printRowHeightIn\(printLayout\)\}in`/);
    const css = readFileSync(path.join(__dirname, "../../app/globals.css"), "utf8");
    const print = css.slice(css.indexOf("@media print"));
    expect(print).toMatch(/tbody td \{[^}]*height: var\(--print-row-h, 0\.19in\) !important;/);
    expect(print).toMatch(/thead th \{[^}]*height: var\(--print-row-h, 0\.19in\) !important;/);
    expect(print).toMatch(/body \{[^}]*padding: 0\.4in !important;/);
    expect(print).toMatch(/\[data-print-footer\] \{[^}]*line-height: 1\.2 !important;/);
  });
});
