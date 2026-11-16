import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// David 2026-11-16: the date range beside the month name crowded the toolbar (past months add
// "Show all staff", and every button wrapped). It moves into the month name's hover text.
const grid = readFileSync(join(process.cwd(), "src/app/schedule-grid.tsx"), "utf8");

describe("toolbar date range on hover", () => {
  it("no visible date-range span after the month picker", () => {
    expect(grid).not.toMatch(/<span className="ml-2 text-xs text-slate-500">\s*\{formatDate\(parseDate\(dates\[0\]\)/);
  });
  it("the month name's hover shows the range the grid covers", () => {
    expect(grid).toMatch(/const shownRange = `\$\{formatDate\(parseDate\(dates\[0\]\), dateFormat\)\} – \$\{formatDate\(parseDate\(dates\[dates\.length - 1\]\), dateFormat\)\}`;/);
    expect(grid).toContain("title={`Showing ${shownRange}. Click to pick a month and year.`}");
  });
  it("the month name stays on one line", () => {
    const i = grid.indexOf("title={`Showing ${shownRange}");
    expect(grid.slice(i - 300, i)).toContain("whitespace-nowrap");
  });
});
