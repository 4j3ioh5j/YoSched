// Card #327 (Codex #1552 follow-ups): (1) every body cell prints at the Settings size, so the
// fit estimate (printFit, which sizes rows from that size) is true for small fonts too; (2) the
// aggregate columns together never take more than a bounded share of the table, so staff
// columns keep their room even when a day's list is very long.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { aggPrintWidthCss, AGG_PRINT_SHARE, DEFAULT_PRINT_LAYOUT, printFit, printPage } from "../print-layout";

const grid = readFileSync(path.join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
const css = readFileSync(path.join(__dirname, "../../app/globals.css"), "utf8");
const print = css.slice(css.indexOf("@media print"));

describe("body cells print at the Settings size", () => {
  it("every body cell but the pay-period strip takes --print-font-size, and its contents inherit it", () => {
    expect(print).toMatch(/tbody td:not\(\[data-pp-label-col\]\) \{[^}]*font-size: var\(--print-font-size\) !important;/);
    expect(print).toMatch(/tbody td:not\(\[data-pp-label-col\]\) \* \{[^}]*font-size: inherit !important;/);
  });
});

describe("aggPrintWidthCss", () => {
  const letter025 = { ...DEFAULT_PRINT_LAYOUT, paper: "letter" as const, marginHundredths: 25 };
  const a4big = { ...DEFAULT_PRINT_LAYOUT, paper: "a4" as const, marginHundredths: 100, fontSize: 14, header: { ...DEFAULT_PRINT_LAYOUT.header, size: 32 }, footer: { ...DEFAULT_PRINT_LAYOUT.footer, size: 32 } };
  it("fits the longest text, capped in inches (never a percentage: Chrome ignores a % width in a fixed table's min())", () => {
    expect(AGG_PRINT_SHARE).toBeGreaterThan(0);
    // Trial (letter, 1in, 9pt): a 20% share already cut off staff codes; 15% is the most that kept them whole elsewhere.
    expect(AGG_PRINT_SHARE).toBeLessThanOrEqual(0.15);
    const css = aggPrintWidthCss("OFF", [["AB", "CD"]], 1, letter025);
    expect(css).not.toMatch(/%/);
    // letter landscape, 0.25in margins: 10.5in printable, the share of it for one column, never under the title
    expect(css).toBe(`min(calc(6ch + 12px), max(calc(3ch + 12px), ${+(AGG_PRINT_SHARE * 10.5).toFixed(4)}in))`);
    expect(aggPrintWidthCss("FB", [], 3, letter025)).toBe(`min(calc(3ch + 12px), max(calc(3ch + 12px), ${+((AGG_PRINT_SHARE * 10.5) / 3).toFixed(4)}in))`);
  });
  it("a long title always fits on one line, even past the share", () => {
    expect(aggPrintWidthCss("ORIENTATION LIST", [["AB", "CD", "EF", "GH", "IJ", "KL", "MN"]], 4, letter025)).toMatch(/^min\(calc\(26ch \+ 12px\), max\(calc\(16ch \+ 12px\), /);
  });
  it("the cap follows the paper and margin, and grows by the shrink factor so the shrunk page keeps the same share", () => {
    const { scale } = printFit(a4big);
    expect(scale).toBeLessThan(1);
    const inner = printPage(a4big).wIn - 2;
    expect(aggPrintWidthCss("FB", [], 2, a4big)).toBe(`min(calc(3ch + 12px), max(calc(3ch + 12px), ${+((AGG_PRINT_SHARE * inner) / scale / 2).toFixed(4)}in))`);
  });
  it("a bad count is treated as one column", () => {
    expect(aggPrintWidthCss("FB", [], 0, letter025)).toBe(aggPrintWidthCss("FB", [], 1, letter025));
    expect(aggPrintWidthCss("FB", [], 1.5, letter025)).toBe(aggPrintWidthCss("FB", [], 1, letter025));
  });
  it("the grid header uses it with the number of aggregate columns and the print layout", () => {
    expect(grid).toMatch(/"--agg-col-w": aggPrintWidthCss\(c\.label, Object\.values\(c\.initialsByDate\), printAggColumns\.length, printLayout\)/);
  });
});
