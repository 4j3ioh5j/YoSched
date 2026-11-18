import { describe, it, expect } from "vitest";
import { CELL_LINES, staffCellLines, extraCellLines } from "../grid-lines";

describe("grid lines (card #345)", () => {
  it("every cell draws the same faint grid on all four sides", () => {
    expect(CELL_LINES).toBe("border border-[color-mix(in_srgb,var(--color-slate-700)_30%,var(--background))]");
    expect(staffCellLines(false, true)).toBe(CELL_LINES);
    expect(extraCellLines().startsWith(CELL_LINES)).toBe(true);
  });

  it("the last staff column carries the divider on its right only when extra columns follow", () => {
    expect(staffCellLines(true, true)).toContain("border-r-slate-700");
    expect(staffCellLines(true, false)).toBe(CELL_LINES);
  });

  it("extra columns draw the divider on both sides, so the left cell's line agrees under border-collapse", () => {
    expect(extraCellLines()).toContain("border-x-slate-700");
  });
});
