import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Card #354: the lines that mark today's row showed above and below it on a Mac (Safari) but
// only above it on a PC (Chrome/Edge). The marker was a ring (an inset box-shadow) on the
// <tr>; Chromium paints the next row's cells over the bottom of a row's shadow at every
// display scale (checked by pixel probe at 1x, 1.25x, 1.5x and 2x). The lines are now drawn
// inside each cell of the row, which no neighbor can paint over.
describe("today's row lines are drawn in its cells (card #354)", () => {
  const grid = readFileSync(join(__dirname, "../schedule-grid.tsx"), "utf8");
  const css = readFileSync(join(__dirname, "../globals.css"), "utf8");

  it("the row carries data-today instead of a ring on the <tr>", () => {
    expect(grid).not.toMatch(/isToday \? "ring-1 ring-inset ring-blue-500\/50"/);
    expect(grid).toMatch(/data-today=\{isToday \|\| undefined\}/);
  });

  it("each cell of today's row draws a line at its top and bottom, on screen only", () => {
    const screen = css.slice(css.indexOf("@media screen"), css.indexOf("@media print"));
    const rule = screen.match(/tbody tr\[data-today\] > td::after\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/position:\s*absolute/);
    expect(rule![1]).toMatch(/inset:\s*0/);
    expect(rule![1]).toMatch(/pointer-events:\s*none/);
    expect(rule![1]).toMatch(/border-top:\s*1px solid/);
    expect(rule![1]).toMatch(/border-bottom:\s*1px solid/);
    // The overlay needs a positioned cell, but the sticky date cells must stay sticky.
    expect(screen).toMatch(/tbody tr\[data-today\] > td:not\(\.sticky\)\s*\{\s*position:\s*relative;?\s*\}/);
  });
});
