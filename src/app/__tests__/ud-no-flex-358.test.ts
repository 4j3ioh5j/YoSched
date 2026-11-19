import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Card #358: in the on-screen print columns view, when no staff column and no count column is
// shown, nothing can take the spare page width, so the table must not stretch to the page:
// the set widths (and best fit) of the additional and shift columns hold.
const grid = readFileSync(path.join(__dirname, "../schedule-grid.tsx"), "utf8");
const css = readFileSync(path.join(__dirname, "../globals.css"), "utf8");
const screen = css.slice(0, css.indexOf("@media print"));
const print = css.slice(css.indexOf("@media print"));

describe("print columns view with no staff or count column (card #358)", () => {
  it("the grid knows whether a column can take the spare width", () => {
    expect(grid).toMatch(/const viewHasFlexCol = gridStaff\.length > 0 \|\| specialColumns\.some\(\(sc\) => sc\.kind === "count"\);/);
  });
  it("the view root says when none can", () => {
    expect(grid).toContain('data-view-no-flex={printColumnsOnly && !viewHasFlexCol ? "" : undefined}');
  });
  it("on screen the table then sizes to its columns instead of the page", () => {
    expect(screen).toMatch(/\[data-print-columns-view\]\[data-view-no-flex\] table \{\s*width: auto;/);
  });
  it("no 1% column is left to stretch the table again (best fit and totals go to auto)", () => {
    expect(screen).toMatch(/\[data-print-columns-view\]\[data-view-no-flex\] \[data-other-col\]:not\(\[data-ud-col\]\),\s*\[data-print-columns-view\]\[data-view-no-flex\] \[data-ud-col\]\[data-ud-size="fit"\] \{\s*width: auto;/);
  });
  it("the printout is untouched", () => {
    expect(print).not.toContain("data-view-no-flex");
  });
});
