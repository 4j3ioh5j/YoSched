// Card #328 (Codex #1556 follow-up): aggregate columns are sized from the room the staff (and
// count) columns do not need, not from a fixed share of the page, so a long list can never
// squeeze the staff codes; spare room is split only after every aggregate title is paid for
// (Codex #1562), so a long title on one column cannot take another's staff room either.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  autoColNeedCh, autoColNeedPx, printReservedIn, PRINT_COL_IN, AUTO_COL_FALLBACK_CH, AUTO_COL_PAD_PX,
  DEFAULT_PRINT_LAYOUT, printFit, printPage, type PrintLayout,
} from "../print-layout";
import * as lib from "../print-layout";

const grid = readFileSync(path.join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
const css = readFileSync(path.join(__dirname, "../../app/globals.css"), "utf8");
const print = css.slice(css.indexOf("@media print"));

const letter1: PrintLayout = { ...DEFAULT_PRINT_LAYOUT, paper: "letter", marginHundredths: 100, fontSize: 9 };
const a4big: PrintLayout = { ...DEFAULT_PRINT_LAYOUT, paper: "a4", marginHundredths: 100, fontSize: 14, header: { ...DEFAULT_PRINT_LAYOUT.header, size: 32 }, footer: { ...DEFAULT_PRINT_LAYOUT.footer, size: 32 } };

/** The room term the CSS must carry, rebuilt independently. */

describe("no fixed share any more", () => {
  it("AGG_PRINT_SHARE is gone", () => {
    expect((lib as Record<string, unknown>).AGG_PRINT_SHARE).toBeUndefined();
  });
});

describe("printReservedIn: the fixed-width columns, from the same constants the print CSS uses", () => {
  it("split date + short day, no labels, no dedicated", () => {
    expect(printReservedIn({ ...letter1, splitDateDay: true, dayColumnFormat: "DDD", payPeriodLabels: false }, 0)).toBeCloseTo(PRINT_COL_IN.date + PRINT_COL_IN.day, 6);
  });
  it("long day name, pay-period labels and dedicated columns all add their width", () => {
    expect(printReservedIn({ ...letter1, splitDateDay: true, dayColumnFormat: "Dddd", payPeriodLabels: true }, 3))
      .toBeCloseTo(PRINT_COL_IN.date + PRINT_COL_IN.dayLong + PRINT_COL_IN.ppLabel + 3 * PRINT_COL_IN.ded, 6);
  });
  it("one date column", () => {
    expect(printReservedIn({ ...letter1, splitDateDay: false, payPeriodLabels: false }, 0)).toBeCloseTo(PRINT_COL_IN.dateSingle, 6);
  });
  it("a bad dedicated count counts as none", () => {
    const base = printReservedIn({ ...letter1, payPeriodLabels: false }, 0);
    expect(printReservedIn({ ...letter1, payPeriodLabels: false }, -2)).toBe(base);
    expect(printReservedIn({ ...letter1, payPeriodLabels: false }, 1.5)).toBe(base);
  });
  it("globals.css and the grid use the same widths", () => {
    expect(print).toMatch(new RegExp(`\\[data-date-col\\] \\{\\s*width: ${PRINT_COL_IN.date}in !important;`));
    expect(print).toMatch(new RegExp(`\\[data-day-col\\] \\{\\s*width: var\\(--day-col-w, ${PRINT_COL_IN.day}in\\) !important;`));
    expect(print).toMatch(new RegExp(`\\[data-date-col\\]\\[data-date-block-end\\] \\{\\s*width: ${PRINT_COL_IN.dateSingle}in !important;`));
    // card #357: shift columns take the user-defined column width, no fixed 0.48in
    expect(print).not.toMatch(/data-print-ded\][^{]*\{[^}]*width:/);
    expect(print).toMatch(/th\[data-ud-col\], td\[data-ud-col\] \{\s*width: var\(--ud-col-w, auto\) !important;/);
    expect(print).toMatch(new RegExp(`width: var\\(--pp-label-w, ${PRINT_COL_IN.ppLabel}in\\) !important;`));
    expect(grid).toMatch(/"--day-col-w": `\$\{printLayout\.dayColumnFormat === "Dddd" \? PRINT_COL_IN\.dayLong : PRINT_COL_IN\.day\}in`/);
    expect(grid).toMatch(/const PP_LABEL_W = \(on: boolean\) => \(on \? `\$\{PRINT_COL_IN\.ppLabel\}in` : "0px"\);/);
  });
});

describe("autoColNeedCh: the longest text any equal-share column prints", () => {
  it("takes the longest text, at least 1", () => {
    expect(autoColNeedCh(["AB", "CALL", "", "RMc"])).toBe(4);
    expect(autoColNeedCh([])).toBe(1);
    expect(autoColNeedCh(["", ""])).toBe(1);
  });
});

describe("autoColNeedPx: the widest text as the browser measures it", () => {
  it("rounds the widest up; nothing to measure or a bad measurement gives null (fallback)", () => {
    const m = (t: string) => t.length * 6.3;
    expect(autoColNeedPx(["AB", "CALL", "RMc"], m)).toBe(26);
    expect(autoColNeedPx([], m)).toBeNull();
    expect(autoColNeedPx(["", ""], m)).toBeNull();
    expect(autoColNeedPx(["AB"], () => NaN)).toBeNull();
  });
});

describe("the grid measures in the print font (card #328, widths from card #357)", () => {
  it("the grid passes the room from print-visible columns", () => {
    expect(grid).toContain("printUdWidthsIn(printLayout, cols, {");
    expect(grid).toContain("autoNeedPx: printAutoNeedPx,");
    expect(grid).toMatch(/printHiddenIds\.has\(p\.id\)/);
    expect(grid).toContain("ref={printRootRef}");
    expect(grid).toContain("{ texts: printAutoTexts.texts, measure: width(span) }");
    expect(grid).toContain('fonts?.addEventListener?.("loadingdone", measure)');
    expect(grid).toMatch(/font-size:var\(--print-font-size\);font-weight:700;letter-spacing:normal;";/);
    expect(grid).toContain('probe + "font-family:var(--print-font)"');
  });
});
