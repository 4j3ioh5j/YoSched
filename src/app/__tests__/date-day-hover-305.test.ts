import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Card #305: on screen the DATE and DAY cells read as one block. Less space between them,
// and the row-hover outline is ONE box around both (no bar between date and day).
const grid = readFileSync(path.resolve(__dirname, "..", "schedule-grid.tsx"), "utf8");

describe("date block hover is one box", () => {
  it("the date cell draws only its left, top and bottom edges; the day cell its right, top and bottom", () => {
    expect(grid).toContain('const HOVER_OUTLINE_DATE: React.CSSProperties = { boxShadow: "inset 2px 0 0 #60a5fa, inset 0 2px 0 #60a5fa, inset 0 -2px 0 #60a5fa" };');
    expect(grid).toContain('const HOVER_OUTLINE_DAY: React.CSSProperties = { boxShadow: "inset -2px 0 0 #60a5fa, inset 0 2px 0 #60a5fa, inset 0 -2px 0 #60a5fa" };');
    const block = grid.slice(grid.indexOf("if (printLayout.splitDateDay) {\n                      return ("));
    const dateTd = block.slice(block.indexOf("<td data-date-col"), block.indexOf(">", block.indexOf("<td data-date-col")));
    const dayTd = block.slice(block.indexOf("<td data-day-col"), block.indexOf(">", block.indexOf("<td data-day-col")));
    expect(dateTd).toContain("hoverStyle(HOVER_OUTLINE_DATE)");
    expect(dayTd).toContain("hoverStyle(HOVER_OUTLINE_DAY)");
    // The single-column layout keeps the full box.
    expect(grid).toMatch(/<td data-date-col data-date-block-end [^>]*style=\{\{ \.\.\.cellBase, \.\.\.hoverStyle\(HOVER_OUTLINE\) \}\}/);
  });
});

describe("less space between date and day", () => {
  it("the DATE column is narrower and the facing paddings are halved", () => {
    expect(grid).toContain("const DATE_COL_W = 50;");
    const block = grid.slice(grid.indexOf("if (printLayout.splitDateDay) {\n                      return ("));
    const dateTd = block.slice(block.indexOf("<td data-date-col"), block.indexOf(">", block.indexOf("<td data-date-col")));
    const dayTd = block.slice(block.indexOf("<td data-day-col"), block.indexOf(">", block.indexOf("<td data-day-col")));
    expect(dateTd).toContain('"pl-2 pr-1"');
    expect(dayTd).toContain('"pl-1 pr-2"');
  });
});
