import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Card #338 (David, February printout): printed while the RQ overlay was on, the request
// boxes and letters printed on the grid, and every assigned cell's request corner marker
// (absolute, top-left) lost its positioned cell in print (td position: static) and piled
// up in the page's top-left corner as unreadable letters. Requests never print.

const SRC = path.resolve(__dirname, "..");
const grid = readFileSync(path.join(SRC, "schedule-grid.tsx"), "utf8");
const css = readFileSync(path.join(SRC, "globals.css"), "utf8");
const printBlock = css.slice(css.indexOf("@media print"));
const rule = (sel: string) => {
  const i = printBlock.indexOf(`${sel} {`);
  expect(i, `print rule ${sel}`).toBeGreaterThan(-1);
  return printBlock.slice(i, printBlock.indexOf("}", i));
};

describe("card #338: requests never print", () => {
  it("the corner marker on an assigned cell is print-hidden", () => {
    const i = grid.indexOf("{reqSummary && a && (");
    expect(i).toBeGreaterThan(-1);
    const marker = grid.slice(i, grid.indexOf("</span>", i));
    expect(marker).toMatch(/absolute top-0 left-0/); // the cause, still on screen
    expect(marker).toMatch(/<span\s+data-print-hide/);
  });

  it("the request letters in an empty cell are print-hidden", () => {
    const i = grid.indexOf(") : reqSummary ? (");
    expect(i).toBeGreaterThan(-1);
    const label = grid.slice(i, grid.indexOf("</div>", i));
    expect(label).toMatch(/<div\s+data-print-hide/);
  });

  it("no ring (request box, selection, locked code) prints: rings are box-shadows", () => {
    expect(rule("tbody td, tbody td *")).toMatch(/box-shadow: none !important;/);
    expect(rule("tbody td, tbody td *")).toMatch(/outline: none !important;/);
  });

  it("a hover tooltip open when printing does not print", () => {
    const i = grid.indexOf("{tooltip && (");
    expect(i).toBeGreaterThan(-1);
    expect(grid.slice(i, grid.indexOf("ref=", i))).toMatch(/<div\s+data-print-hide/);
  });

  it("the print column widths are not sized for request letters that never print", () => {
    const i = grid.indexOf("const printAutoTexts = useMemo(");
    const block = grid.slice(i, grid.indexOf("}, [", i));
    expect(block).not.toMatch(/requestsByCell|summarizeCellRequests/);
  });
});
