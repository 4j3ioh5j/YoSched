import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Regression guard: the printed schedule is exactly ONE calendar month on ONE
// landscape page. Pay-period "+/-" summary rows are a screen-only aid — when they
// were allowed to print (whenever the PP toggle happened to be on), the extra rows
// pushed a 31-day month onto a second sheet. They must stay hidden in print
// regardless of the on-screen toggle, and outside-month padding rows must stay
// hidden too.

const SRC = path.resolve(__dirname, "..");
const grid = readFileSync(path.join(SRC, "schedule-grid.tsx"), "utf8");
const css = readFileSync(path.join(SRC, "globals.css"), "utf8");

function printBlock(): string {
  const start = css.indexOf("@media print");
  expect(start).toBeGreaterThan(-1);
  return css.slice(start);
}

describe("pay-period summary rows never print", () => {
  it("stamps data-print-hide on the PP summary <tr>", () => {
    const idx = grid.indexOf("key={`pp-${pp.startDate}`}");
    expect(idx).toBeGreaterThan(-1);
    // The opening <tr ...> tag that carries the pp- key must also carry the print-hide flag.
    const tagStart = grid.lastIndexOf("<tr", idx);
    const tagEnd = grid.indexOf(">", idx);
    const tag = grid.slice(tagStart, tagEnd);
    expect(tag).toContain("data-print-hide");
  });

  it("print stylesheet collapses data-print-hide with display:none", () => {
    expect(printBlock()).toMatch(/\[data-print-hide\][^{]*\{[^}]*display:\s*none/);
  });

  it("no longer carries print styling that would paint PP rows", () => {
    // The old rule re-styled the PP row for paper; with the row hidden it is dead
    // and its presence would signal someone re-enabled printing them.
    expect(printBlock()).not.toMatch(/tr\[class\*="bg-slate-800\/80"\]/);
  });

  it("still hides outside-month padding rows so only one month prints", () => {
    expect(printBlock()).toMatch(/tr\[data-outside-month\][^{]*\{[^}]*display:\s*none/);
    expect(grid).toContain("data-outside-month={isOutsideMonth || undefined}");
  });
});
