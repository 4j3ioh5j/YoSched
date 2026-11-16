import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Card #299: the printout and the year export share one column model.
const grid = readFileSync(join(__dirname, "../schedule-grid.tsx"), "utf8");
const css = readFileSync(join(__dirname, "../globals.css"), "utf8");

describe("shared print columns (card #299)", () => {
  it("the grid computes its print columns with computePrintColumns", () => {
    expect(grid).toContain('from "@/lib/print-month-model"');
    expect(grid).toMatch(/computePrintColumns\(\{/);
    expect(grid).not.toMatch(/computeAggregateColumns\(/);
    expect(grid).not.toMatch(/printVisibleStaffIds\(/);
  });

  it("print CSS: the bold-cell grey beats the row shade, the shift tint beats both", () => {
    const bold = css.indexOf("tbody tr td[data-bold-cell]");
    const shade = css.indexOf("tbody tr[data-print-shade] td {");
    const tint = css.indexOf("tbody tr[data-print-shade] td[data-print-bg]");
    expect(bold).toBeGreaterThan(shade);
    expect(tint).toBeGreaterThan(bold);
    expect(css).not.toMatch(/tbody td\[data-bold-cell\]/);
  });
});
