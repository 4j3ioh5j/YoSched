import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Card #343: a toolbar button shows, on screen, only the columns the print / PDF / Excel
// output shows. It reuses the one print column model (computePrintColumns → printHiddenIds,
// printAggColumns): rule-hidden staff columns are left out of the grid (so arrows, ranges,
// copy and paste never reach a column you cannot see) and the print-only aggregate columns
// are revealed.
const grid = readFileSync(join(__dirname, "../schedule-grid.tsx"), "utf8");
const css = readFileSync(join(__dirname, "../globals.css"), "utf8");

describe("printed columns only view (card #343)", () => {
  it("keeps the choice per browser, guarded against storage errors", () => {
    expect(grid).toMatch(/localStorage\.getItem\("yosched:printColumnsOnly"\)/);
    expect(grid).toMatch(/try \{ localStorage\.setItem\("yosched:printColumnsOnly", String\(next\)\); \} catch/);
  });

  it("derives the on-screen staff from the print model's hidden set", () => {
    expect(grid).toMatch(/const gridStaff = useMemo\(\s*\(\) => \(printColumnsOnly \? visibleStaff\.filter\(\(p\) => !printHiddenIds\.has\(p\.id\)\) : visibleStaff\)/);
  });

  it("renders, navigates, selects, copies and pastes over the shown staff only", () => {
    expect(grid.match(/\{gridStaff\.map\(\(p\) => \{/g)?.length).toBe(3);
    expect(grid).not.toMatch(/\{visibleStaff\.map\(\(p\) => \{/);
    expect(grid).toMatch(/const nStaff = gridStaff\.length;/);
    expect(grid).toMatch(/const aProvIdx = gridStaff\.findIndex/);
    expect(grid).toMatch(/const tProvIdx = gridStaff\.findIndex/);
    expect(grid.match(/staffOrder: gridStaff\.map\(\(p\) => p\.id\)/g)?.length).toBe(2);
    expect(grid).toMatch(/const staffIndex = gridStaff\.findIndex/);
  });

  it("the print model and alerts still use every visible staff member", () => {
    expect(grid).toMatch(/computePrintColumns\(\{\s*visibleStaff,/);
    expect(grid).toMatch(/const printed = visibleStaff\.filter\(\(p\) => !printHiddenIds\.has\(p\.id\)\)/);
  });

  it("stamps the grid root and has a toolbar toggle that clears column focus", () => {
    expect(grid).toMatch(/data-print-columns-view=\{printColumnsOnly \? "" : undefined\}/);
    const i = grid.indexOf("onClick={togglePrintColumnsOnly}");
    expect(i).toBeGreaterThan(-1);
    const btn = grid.slice(grid.lastIndexOf("<button", i), grid.indexOf("</button>", i));
    expect(btn).toMatch(/aria-pressed=\{printColumnsOnly\}/);
    expect(btn).toMatch(/data-print-hide/);
    const fn = grid.slice(grid.indexOf("const togglePrintColumnsOnly"), grid.indexOf("const togglePrintColumnsOnly") + 600);
    expect(fn).toMatch(/clearColFocus\(\)/);
  });

  it("reveals the print-only aggregate columns on screen in this view", () => {
    const screen = css.slice(css.indexOf("@media screen"));
    expect(css.indexOf("@media screen")).toBeGreaterThan(-1);
    expect(screen).toMatch(/\[data-print-columns-view\] \[data-other-col\] \{\s*display: table-cell !important;/);
  });
});

describe("printed columns only view: hidden focus and hydration (card #343 r1)", () => {
  it("prunes focus, selection, anchor and picker during render whenever the shown staff change", () => {
    expect(grid).toMatch(/if \(prevGridStaff !== gridStaff\) \{/);
    const i = grid.indexOf("if (prevGridStaff !== gridStaff) {");
    const block = grid.slice(i, i + 900);
    expect(block).toMatch(/setPrevGridStaff\(gridStaff\)/);
    expect(block).toMatch(/pruneHiddenFocus\(/);
    expect(block).toMatch(/setActiveCol\(null\)/);
    expect(block).toMatch(/setSelection\(/);
    expect(block).toMatch(/setSelectionAnchor\(null\)/);
    expect(block).toMatch(/setPicker\(null\)/);
  });
  it("starts off on the server and first client render, then restores the saved choice", () => {
    expect(grid).toMatch(/const \[printColumnsOnly, setPrintColumnsOnly\] = useState\(false\);/);
    const i = grid.indexOf('localStorage.getItem("yosched:printColumnsOnly")');
    expect(grid.slice(grid.lastIndexOf("useLayoutEffect(", i), i)).toMatch(/useLayoutEffect\(\(\) => \{/);
  });
});

describe("printed columns only view: summary columns fit their text (card #344)", () => {
  it("the aggregate columns shrink to their contents on screen, so the staff columns take the spare width", () => {
    const screen = css.slice(css.indexOf("@media screen"), css.indexOf("@media print"));
    expect(screen).toMatch(/\[data-print-columns-view\] \[data-other-col\] \{\s*display: table-cell !important;\s*width: 1%;\s*white-space: nowrap;/);
  });
});
