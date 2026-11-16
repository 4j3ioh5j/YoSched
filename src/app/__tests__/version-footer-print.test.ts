import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { printStampText, unsavedPrintWarning } from "@/lib/print-stamp";

// History: an earlier Code-Review finding required that a printout never silently
// imply it matches "Version N" while the month has drifted. That used to be a printed
// "includes unsaved edits" notice. Card #173 (David's decision): the notice no longer
// prints; instead EVERY print path asks the scheduler first (OK/Cancel) when the month
// has unsaved edits. These checks keep that guarantee.

const SRC = path.resolve(__dirname, "..");
const grid = readFileSync(path.join(SRC, "schedule-grid.tsx"), "utf8");
const css = readFileSync(path.join(SRC, "globals.css"), "utf8");
const printBlock = css.slice(css.indexOf("@media print"));

describe("unsaved edits: warned before printing, not printed (card #173)", () => {
  it("warns only when the month differs from a saved version", () => {
    expect(unsavedPrintWarning(3, true)).toMatch(/not saved in Version 3/);
    expect(unsavedPrintWarning(3, true)).toMatch(/Print anyway\?/);
    expect(unsavedPrintWarning(3, false)).toBeNull();
    expect(unsavedPrintWarning(null, true)).toBeNull();
    expect(unsavedPrintWarning(null, false)).toBeNull();
  });

  // Card #312: with auto-versioning off (or Live / view-only) the old confirm still guards
  // the print; otherwise runPrintFlow prints only after the version holds the cells.
  it("every window.print() call is inside printMonth: behind the confirm, or behind runPrintFlow", () => {
    const calls = grid.match(/window\.print\(\)/g) ?? [];
    expect(calls.length).toBe(2);
    const start = grid.indexOf("const printMonth = useCallback(() => printGate(async () => {");
    const fn = grid.slice(start, grid.indexOf("}), [", start));
    expect((fn.match(/window\.print\(\)/g) ?? []).length).toBe(2);
    expect(fn).toContain("unsavedPrintWarning(");
    expect(fn).toMatch(/if \(warning && !window\.confirm\(warning\)\) return;\s*window\.print\(\);/);
    expect(fn).toMatch(/await runPrintFlow\(\{[\s\S]*print: \(\) => window\.print\(\),/);
  });

  it("the Print button and Ctrl/Cmd+P both go through printMonth", () => {
    expect(grid).toContain("onClick={() => void printMonth()}");
    expect(grid).toMatch(/\(e\.metaKey \|\| e\.ctrlKey\)[^\n]*e\.key\.toLowerCase\(\) === "p"[\s\S]{0,80}e\.preventDefault\(\);\s*void printMonth\(\);/);
  });

  it("the on-screen notice stays, but is print-hidden", () => {
    const idx = grid.indexOf("data-version-modified");
    expect(idx).toBeGreaterThan(-1);
    expect(grid.slice(idx - 60, idx + 60)).toContain("data-print-hide");
  });

  it("the footer still prints, now as the Settings footer line (card #301)", () => {
    expect(printBlock).toContain("[data-version-footer]");
    expect(printBlock).not.toMatch(/\[data-version-footer\][^{]*\{[^}]*display:\s*none/);
    expect(printBlock).toMatch(/\[data-print-footer\][^{]*\{[^}]*display: block !important/);
    // Card #301: the screen's "Version n" no longer prints; {VERSION} in the footer
    // template carries it. The saved date and comment stay screen-only.
    const v = grid.indexOf(">Version {focalVersion.versionNumber}</span>");
    expect(v).toBeGreaterThan(-1);
    expect(grid.slice(grid.lastIndexOf("<span", v), v)).toContain("data-print-hide");
    expect(grid).toContain("<span data-print-hide>saved {formatDate(");
    expect(grid).toMatch(/<span data-print-hide className="text-slate-500 italic truncate max-w-md" title=\{focalVersion\.comment\}>/);
  });

  it("stamps the print time on beforeprint, 24-hour", () => {
    expect(grid).toMatch(/addEventListener\("beforeprint", stamp\)/);
    expect(printStampText(new Date(2027, 1, 3, 7, 5), "YYYY-MM-DD")).toBe("Printed 2027-02-03 07:05");
    expect(printStampText(new Date(2027, 1, 3, 19, 41), "MMMM D, YYYY")).toBe("Printed February 3, 2027 19:41");
  });
});

describe("print layout (card #173)", () => {
  it("zero page margin (no browser URL/title/date) with the margin moved to the body", () => {
    expect(printBlock).toMatch(/@page \{\s*size: landscape;\s*margin: 0;\s*\}/);
    expect(printBlock).toMatch(/body \{\s*padding: 0\.4in !important;/);
  });

  it("the title is the Settings header, not a fixed YoSched brand (card #301)", () => {
    expect(grid).not.toContain("data-print-brand");
    expect(grid).toContain("data-print-title");
  });

  it("header initials at the Settings font size (card #301), clipped not ellipsised, no outline", () => {
    expect(printBlock).toMatch(/thead th \{[^}]*font-size: var\(--print-font-size\) !important;[^}]*box-shadow: none !important;/);
    expect(printBlock).toMatch(/thead th, tbody td \{[^}]*text-overflow: clip !important;/);
    expect(printBlock).not.toMatch(/text-overflow:\s*ellipsis/);
  });

  it("a selected column's header has no !important colour that beats print black", () => {
    expect(grid).not.toContain("!text-blue-200");
    expect(printBlock).toMatch(/thead th, thead th \*,[\s\S]{0,80}color: #000 !important;/);
  });
});

describe("Approve selected button (card #173)", () => {
  it("runs the same approve action as the + key, with the same gates", () => {
    const i = grid.indexOf("Approve selected");
    expect(i).toBeGreaterThan(-1);
    const btn = grid.slice(grid.lastIndexOf("{canEdit && (", i), i);
    expect(btn).toContain('onClick={() => requestApproveRef.current("approved")}');
    expect(btn).toContain("disabled={liveMode || !!activeDedCol || !(selection.size > 0 || (activeRow && activeCol))}");
  });
});
