// Card #327 (Codex #1552 follow-ups): (1) every body cell prints at the Settings size, so the
// fit estimate (printFit, which sizes rows from that size) is true for small fonts too; (2) the
// aggregate columns together never take more than a bounded share of the table, so staff
// columns keep their room even when a day's list is very long.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.join(__dirname, "../../app/globals.css"), "utf8");
const print = css.slice(css.indexOf("@media print"));

describe("body cells print at the Settings size", () => {
  it("every body cell but the pay-period strip takes --print-font-size, and its contents inherit it", () => {
    expect(print).toMatch(/tbody td:not\(\[data-pp-label-col\]\) \{[^}]*font-size: var\(--print-font-size\) !important;/);
    expect(print).toMatch(/tbody td:not\(\[data-pp-label-col\]\) \* \{[^}]*font-size: inherit !important;/);
  });
});

// The aggregate width tests moved to print-fit-328 (sized from the spare room, not a share).
