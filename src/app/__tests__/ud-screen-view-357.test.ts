import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Card #357: the live schedule's "print columns" view follows the Settings width choice.
const grid = readFileSync(path.join(__dirname, "../schedule-grid.tsx"), "utf8");
const css = readFileSync(path.join(__dirname, "../globals.css"), "utf8");
const screen = css.slice(0, css.indexOf("@media print"));

describe("print columns view widths (card #357)", () => {
  it("the view root carries the choice", () => {
    expect(grid).toContain("data-ud-width-mode={printColumnsOnly ? printLayout.udWidth.mode : undefined}");
  });
  it("best fit: as wide as the text (shift columns too, not their fixed 44px)", () => {
    expect(screen).toMatch(/\[data-print-columns-view\] \[data-ud-col\] \{\s*width: 1%;\s*min-width: 0;\s*white-space: nowrap;/);
  });
  it("other choices: the printout's width per column", () => {
    expect(screen).toMatch(/\[data-print-columns-view\]:not\(\[data-ud-width-mode="bestFit"\]\) \[data-ud-col\] \{\s*width: var\(--ud-col-w, 1%\);\s*min-width: var\(--ud-col-w, 0\);/);
  });
  it("spare table width goes to the staff and count columns, never to a set-width column", () => {
    expect(screen).toMatch(/\[data-print-columns-view\]:not\(\[data-ud-width-mode="bestFit"\]\) thead th:not\(\[data-ud-col\]\):not\(\[data-date-col\]\):not\(\[data-day-col\]\) \{\s*width: auto;/);
  });
  it("long text never widens a custom or equal column: clipped at its width, as in print", () => {
    expect(screen).toMatch(/\[data-print-columns-view\]:not\(\[data-ud-width-mode="bestFit"\]\) \[data-ud-col\] \{[^}]*max-width: var\(--ud-col-w, none\);[^}]*overflow: hidden;/);
  });
});
