import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATE_CELL_LINES, CELL_LINES } from "@/lib/grid-lines";

// Card #356: the date and day cells had no top or bottom border while every other cell of the
// row has the faint 1px grid line. In a border-collapse table a cell's box starts at the middle
// of its borders, so the date/day cells' boxes (and with them their shading and today's lines)
// sat half a line off from the rest of the row. They now carry the same faint top/bottom line.
describe("date and day cells line up with the row (card #356)", () => {
  const grid = readFileSync(join(__dirname, "../schedule-grid.tsx"), "utf8");

  it("the date-cell lines are the grid's faint line, top and bottom", () => {
    const color = CELL_LINES.match(/border-\[(.*)\]/)![1];
    expect(DATE_CELL_LINES).toBe(`border-y border-y-[${color}]`);
  });

  it("every day-row date and day cell uses them", () => {
    const i = grid.indexOf("const base = `sticky z-[5] py-1");
    expect(i).toBeGreaterThan(-1);
    expect(grid.slice(i, i + 200)).toMatch(/\$\{DATE_CELL_LINES\}/);
  });
});
