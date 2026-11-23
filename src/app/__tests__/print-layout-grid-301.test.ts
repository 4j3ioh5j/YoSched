import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Card #301: the printed month matches David's MD Schedule PDF. The template / format
// logic is unit-tested in src/lib/__tests__/print-layout.test.ts; these checks pin how
// the grid and the print stylesheet use it. The real layout (one page for 31 days, both
// date modes) is checked by printing to PDF before review.

const SRC = path.resolve(__dirname, "..");
const grid = readFileSync(path.join(SRC, "schedule-grid.tsx"), "utf8");
const page = readFileSync(path.join(SRC, "page.tsx"), "utf8");
const layout = readFileSync(path.join(SRC, "layout.tsx"), "utf8");
const css = readFileSync(path.join(SRC, "globals.css"), "utf8");
const printBlock = css.slice(css.indexOf("@media print"));

/** The opening tag (up to the first ">" not inside {…}) that contains `marker`. */
function tagAround(src: string, marker: string): string {
  const i = src.indexOf(marker);
  expect(i, marker).toBeGreaterThan(-1);
  const start = src.lastIndexOf("<", i);
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, j + 1);
  }
  return src.slice(start);
}

describe("settings reach the grid", () => {
  it("page.tsx passes the print layout from the saved preferences", () => {
    expect(page).toContain("printLayout={printLayoutFrom(schedPrefs)}");
    expect(grid).toMatch(/printLayout = DEFAULT_PRINT_LAYOUT,/);
  });
});

describe("title and footer are the Settings templates", () => {
  it("the old hard-coded YoSched brand title is gone", () => {
    expect(grid).not.toContain("data-print-brand");
    expect(printBlock).not.toContain("[data-print-brand]");
  });

  it("the title renders the header template with its size, weight and alignment", () => {
    const tag = tagAround(grid, "data-print-title");
    expect(tag).toContain("printBlockStyle(printLayout.header)");
    expect(grid).toMatch(/renderPrintTemplate\(printLayout\.header\.text, printCtx\(now, version\)\)/);
  });

  it("the print stylesheet no longer forces the title's size, weight or alignment", () => {
    const rule = printBlock.match(/\[data-print-title\] \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("display: block !important");
    expect(rule).not.toMatch(/font-size|font-weight|text-align/);
  });

  it("beforeprint writes the footer line (template + ' - YoSched') into a print-only span", () => {
    expect(grid).toMatch(/addEventListener\("beforeprint", stamp\)/);
    expect(grid).toMatch(/footerLine\(printLayout\.footer\.text, printCtx\(now, version\)\)/);
    const tag = tagAround(grid, "data-print-footer");
    expect(tag).toContain("ref={printFooterRef}");
    expect(tag).toContain("printBlockStyle(printLayout.footer)");
    expect(tag).toMatch(/className="hidden"/);
    expect(printBlock).toMatch(/\[data-print-footer\] \{[^}]*display: block !important;/);
  });

  it("the version-footer's screen text no longer prints (the template replaces it)", () => {
    expect(tagAround(grid, ">Version {focalVersion.versionNumber}</span>")).toContain("data-print-hide");
    expect(tagAround(grid, ">No saved version for")).toContain("data-print-hide");
    expect(grid).not.toContain("data-print-stamp");
    expect(printBlock).not.toContain("[data-print-stamp]");
  });

  it("{VERSION} is the month's saved version", () => {
    // Card #312: the version comes from printVersionRef (the focal version, or the one Print just saved).
    expect(grid).toMatch(/printVersionRef\.current = focalVersion \? focalVersion\.versionNumber : null/);
  });
});

describe("font and size come from Settings", () => {
  it("the grid root carries the font stack and size as CSS variables", () => {
    expect(grid).toContain('"--print-font": printFontStack(printLayout.fontFamily)');
    expect(grid).toContain('"--print-font-size": `${printLayout.fontSize}pt`');
  });

  it("print uses them for the table, header cells, codes and date cells", () => {
    expect(printBlock).toMatch(/\[data-print-root\] \{[^}]*font-family: var\(--print-font\) !important;/);
    expect(printBlock).toMatch(/table \{[^}]*font-size: var\(--print-font-size\) !important;/);
    expect(printBlock).toMatch(/thead th \{[^}]*font-size: var\(--print-font-size\) !important;/);
    expect(printBlock).toMatch(/tbody td \[data-shift-code\] \{[^}]*font-size: var\(--print-font-size\) !important;/);
    // No fixed px font sizes are left in the print block.
    expect(printBlock).not.toMatch(/font-size:\s*[\d.]+px/);
  });

  it("bundles a free narrow font as the fallback", () => {
    expect(layout).toMatch(/Archivo_Narrow\(\{[\s\S]*variable: "--font-print-narrow"/);
  });
});

describe("DATE and DAY columns", () => {
  it("split on: a DATE and a DAY header cell, and a date and a day cell per day row", () => {
    expect(grid).toMatch(/printLayout\.splitDateDay \?/);
    expect(grid.match(/data-date-col/g)?.length).toBeGreaterThanOrEqual(2); // th + td
    expect(grid.match(/data-day-col/g)?.length).toBeGreaterThanOrEqual(2);
    expect(grid).toContain("formatDateColumn(date, printLayout.dateColumnFormat)");
    expect(grid).toContain("formatDayColumn(label.dow, printLayout.dayColumnFormat)");
  });

  it("the PP summary row's label spans both date columns when split", () => {
    const i = grid.indexOf("key={`pp-${pp.startDate}`}");
    const td = tagAround(grid.slice(i), "<td");
    expect(td).toContain("colSpan={dateCols}");
    expect(grid).toMatch(/const dateCols = printLayout\.splitDateDay \? 2 : 1;/);
  });

  it("the PP summary row has no stray trailing cell (card #302 follow-up)", () => {
    expect(grid).not.toContain("dedicatedColumns.length === 0 && countColumns.length === 0 && <td");
  });

  it("the date-block's last cell carries data-date-block-end (heavy right border in print)", () => {
    expect(grid.match(/data-date-block-end/g)?.length).toBeGreaterThanOrEqual(2);
    expect(printBlock).toMatch(/\[data-date-block-end\][^{]*\{[^}]*border-right: 2px solid #000 !important;/);
  });

  it("date cells print plain (not bold, not monospace)", () => {
    expect(printBlock).toMatch(/\[data-date-col\], \[data-day-col\][^{]*\{[^}]*font-weight: 400 !important;[^}]*font-family: inherit !important;/);
    expect(printBlock).not.toMatch(/tbody td:first-child \{[^}]*font-weight: 700/);
  });
});

describe("borders and pay-period marks", () => {
  it("thin black inside borders, heavy outside and under the header", () => {
    expect(printBlock).toMatch(/thead th \{[^}]*border: 1px solid #000 !important;/);
    expect(printBlock).toMatch(/tbody td \{[^}]*border: 1px solid #000 !important;/);
    expect(printBlock).not.toContain("#cbd5e1");
    expect(printBlock).toMatch(/thead th \{[^}]*border-top: 2px solid #000 !important;[^}]*border-bottom: 2px solid #000 !important;/);
    expect(printBlock).toMatch(/\[data-date-col\]:first-child, \[data-date-block-end\]:first-child \{[^}]*border-left: 2px solid #000 !important;/);
    expect(printBlock).toMatch(/tr\[data-month-last\] td \{[^}]*border-bottom: 2px solid #000 !important;/);
  });

  it("the first row of each pay period gets a double top border", () => {
    expect(grid).toContain("data-pp-start={isNewPP || undefined}");
    expect(printBlock).toMatch(/tr\[data-pp-start\] td:not\(\[data-pp-label-col\]\) \{[^}]*border-top: 3px double #000 !important;/);
  });

  it("the last in-month row is marked for the bottom border", () => {
    expect(grid).toContain("data-month-last={date === printLast || undefined}");
  });

  it("PP#nn labels sit in a print-only strip right of the table, outside its border", () => {
    // Every row kind carries the strip cell, so the columns stay aligned.
    expect(grid.match(/data-pp-label-col/g)?.length).toBeGreaterThanOrEqual(3);
    expect(grid).toContain("ppLabelText(");
    expect(grid).toMatch(/printLayout\.payPeriodLabels && isNewPP && currentPP/);
    const rule = printBlock.match(/\[data-pp-label-col\] \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("display: table-cell !important");
    expect(rule).toContain("border-top: none !important");
    expect(rule).toContain("border-right: none !important");
    expect(rule).toContain("border-bottom: none !important");
    // Its left edge is the table's heavy right border.
    expect(rule).toContain("border-left: 2px solid #000 !important");
  });

  it("a shift's print colour still wins over the bold-cell shade", () => {
    expect(printBlock.indexOf("tbody td[data-print-bg]")).toBeGreaterThan(printBlock.indexOf("tbody td[data-bold-cell]"));
  });
});
