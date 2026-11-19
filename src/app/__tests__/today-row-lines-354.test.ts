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

  // Card #355: print-only total columns (data-other-col) are hidden on screen unless the
  // "Print columns" view is on, and may come last. The right line goes on the last SHOWN cell.
  it("the right line skips hidden total columns, except in the Print columns view", () => {
    const screen = css.slice(css.indexOf("@media screen"), css.indexOf("@media print"));
    const normal = "tbody tr[data-today] > td:nth-last-child(1 of :not([data-pp-label-col]):not([data-other-col]))::after";
    const reset = "[data-print-columns-view] " + normal;
    const view = "[data-print-columns-view] tbody tr[data-today] > td:not([data-pp-label-col]):nth-last-child(1 of :not([data-pp-label-col]))::after";
    const body = (sel: string) => { const i = screen.indexOf(sel + " {"); return i < 0 ? null : screen.slice(i, screen.indexOf("}", i)); };
    expect(body(normal)).toMatch(/border-right: 1px solid/);
    expect(body(reset)).toMatch(/border-right: 0/);
    expect(body(view)).toMatch(/border-right: 1px solid/);
    // The view rule comes after the reset, so it wins when both pick the same cell.
    expect(screen.indexOf(view + " {")).toBeGreaterThan(screen.indexOf(reset + " {"));
    expect(screen).not.toContain("td:nth-last-child(1 of :not([data-pp-label-col]))::after {");
  });
});
