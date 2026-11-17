// Card #323: the printout uses the Settings paper and margin, and a cell's text can never make a
// row taller than the computed height (one line, fixed line height), so every month's rows match.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { aggPrintWidthCh } from "../print-layout";

const grid = readFileSync(path.join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
const css = readFileSync(path.join(__dirname, "../../app/globals.css"), "utf8");
const print = css.slice(css.indexOf("@media print"));

describe("print page from Settings", () => {
  it("the grid renders the print-only page style built by printPageStyle", () => {
    expect(grid).toMatch(/<style media="print">\{printPageStyle\(printLayout\)\}<\/style>/);
  });
  it("cells print on one line at a fixed line height", () => {
    expect(print).toMatch(/thead th, tbody td \{[^}]*white-space: nowrap !important;[^}]*line-height: 1\.2 !important;/);
  });
  it("aggregate cells no longer wrap in print, and their column fits the longest text of the month", () => {
    expect(grid).toMatch(/"--agg-col-w": aggPrintWidthCss\(c\.label, Object\.values\(c\.initialsByDate\)/);
  });
});

describe("aggPrintWidthCh", () => {
  it("the widest of the title and every day's list, at least 3", () => {
    expect(aggPrintWidthCh("FB", [])).toBe(3);
    expect(aggPrintWidthCh("OFF", [["AB", "CD", "EF"]])).toBe("AB, CD, EF".length);
    expect(aggPrintWidthCh("LONG TITLE", [["AB"]])).toBe(10);
  });
});
