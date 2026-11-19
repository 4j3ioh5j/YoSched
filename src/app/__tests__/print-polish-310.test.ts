import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Card #310 (David, November printout): today's row printed a stray box in the PP# strip
// right of the grid, and the footer line ended past the grid's right edge (at the strip's).

const SRC = path.resolve(__dirname, "..");
const grid = readFileSync(path.join(SRC, "schedule-grid.tsx"), "utf8");
const css = readFileSync(path.join(SRC, "globals.css"), "utf8");
const printBlock = css.slice(css.indexOf("@media print"));
const rule = (sel: string) => {
  const i = printBlock.indexOf(`${sel} {`);
  expect(i, `print rule ${sel}`).toBeGreaterThan(-1);
  return printBlock.slice(i, printBlock.indexOf("}", i));
};

describe("card #310: printout polish", () => {
  it("no row outline prints: the flash ring is a box-shadow on the row; today's lines are screen-only", () => {
    expect(grid).toMatch(/flashDate === date \? "ring-2 ring-inset/); // the cause, still on screen
    expect(rule("tbody tr")).toMatch(/box-shadow: none !important;/);
    // Card #354: today's lines are cell overlays inside @media screen, so they never print.
    const print = css.slice(css.indexOf("@media print"));
    expect(print).not.toMatch(/data-today/);
    expect(css.slice(css.indexOf("@media screen"), css.indexOf("@media print"))).toMatch(/tbody tr\[data-today\] > td::after/);
  });

  it("the footer line's box ends at the grid's right edge, not at the PP# strip's", () => {
    expect(rule("[data-print-footer]")).toMatch(/padding-right: var\(--pp-label-w, 0px\) !important;/);
    expect(rule("[data-print-footer]")).toMatch(/box-sizing: border-box !important;/);
    // The footer gets the same strip width as the strip itself (0 when the labels are off).
    const footer = grid.slice(grid.indexOf("<div data-print-footer"), grid.indexOf("/>", grid.indexOf("<div data-print-footer")));
    expect(footer).toContain('"--pp-label-w": PP_LABEL_W(printLayout.payPeriodLabels)');
    expect(grid).toContain('"--pp-label-w": PP_LABEL_W(printLayout.payPeriodLabels) }');
    expect(grid).toMatch(/const PP_LABEL_W = \(on: boolean\) => \(on \? `\$\{PRINT_COL_IN\.ppLabel\}in` : "0px"\);/); // card #328: from the shared constant (0.34in)
  });
});
