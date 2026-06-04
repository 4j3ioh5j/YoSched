import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Regression guard for the Code-Review finding: "print footer hides the
// unsaved-edits state." A printed schedule that shows "Version N" while the live
// month has drifted would be misleading, so the unsaved-edits marker MUST remain
// visible in print. These checks fail if someone re-hides it.

const SRC = path.resolve(__dirname, "..");
const grid = readFileSync(path.join(SRC, "schedule-grid.tsx"), "utf8");
const css = readFileSync(path.join(SRC, "globals.css"), "utf8");

describe("version footer print visibility", () => {
  it("renders a dedicated unsaved-edits marker in the footer", () => {
    expect(grid).toContain("data-version-modified");
  });

  it("does not mark the unsaved-edits element as print-hidden", () => {
    const idx = grid.indexOf("data-version-modified");
    // Inspect the element's opening tag (a small window around the attribute).
    const around = grid.slice(idx - 60, idx + 60);
    expect(around).not.toContain("data-print-hide");
  });

  it("keeps the footer visible (not display:none) in the print stylesheet", () => {
    const printStart = css.indexOf("@media print");
    expect(printStart).toBeGreaterThan(-1);
    const printBlock = css.slice(printStart);
    expect(printBlock).toContain("[data-version-footer]");
    // The footer must not be hidden in print.
    expect(printBlock).not.toMatch(/\[data-version-footer\][^{]*\{[^}]*display:\s*none/);
    // And the modified marker must have its own conspicuous print styling.
    expect(printBlock).toContain("[data-version-modified]");
  });
});
