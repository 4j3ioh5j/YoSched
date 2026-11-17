// Card #328 (Codex #1556 follow-up): aggregate columns are sized from the room the staff (and
// count) columns do not need, not from a fixed share of the page, so a long list can never
// squeeze the staff codes; spare room is split only after every aggregate title is paid for
// (Codex #1562), so a long title on one column cannot take another's staff room either.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  aggPrintWidthCss, autoColNeedCh, autoColNeedPx, printReservedIn, PRINT_COL_IN, AUTO_COL_FALLBACK_CH, AUTO_COL_PAD_PX,
  DEFAULT_PRINT_LAYOUT, printFit, printPage, type PrintLayout,
} from "../print-layout";
import * as lib from "../print-layout";

const grid = readFileSync(path.join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
const css = readFileSync(path.join(__dirname, "../../app/globals.css"), "utf8");
const print = css.slice(css.indexOf("@media print"));

const letter1: PrintLayout = { ...DEFAULT_PRINT_LAYOUT, paper: "letter", marginHundredths: 100, fontSize: 9 };
const a4big: PrintLayout = { ...DEFAULT_PRINT_LAYOUT, paper: "a4", marginHundredths: 100, fontSize: 14, header: { ...DEFAULT_PRINT_LAYOUT.header, size: 32 }, footer: { ...DEFAULT_PRINT_LAYOUT.footer, size: 32 } };

/** The room term the CSS must carry, rebuilt independently. */
function spare(layout: PrintLayout, reservedIn: number, autoCount: number, needPx: number, titles: number[]) {
  const page = printPage(layout);
  const { scale } = printFit(layout);
  const w = +((page.wIn - 2 * page.marginIn) / scale - reservedIn).toFixed(4);
  const sumCh = titles.reduce((s, t) => s + t, 0);
  return `max(0px, calc((${w}in - ${autoCount} * ${needPx + AUTO_COL_PAD_PX}px - ${sumCh}ch - ${titles.length * 12}px) / ${titles.length}))`;
}

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
    expect(print).toMatch(new RegExp(`th\\[data-print-ded\\], td\\[data-print-ded\\] \\{\\s*width: ${PRINT_COL_IN.ded}in !important;`));
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

describe("aggPrintWidthCss from the spare room", () => {
  it("fits its longest text, never past its title plus an equal part of what the staff columns and all titles leave", () => {
    const room = { reservedIn: 0.78, autoCount: 23, autoNeedPx: 28, autoNeedCh: 4, titlesCh: [3] };
    const out = aggPrintWidthCss("OFF", [["AB", "CD"]], room, letter1);
    expect(out).not.toMatch(/%/);
    expect(out).toBe(`min(calc(6ch + 12px), calc(3ch + 12px + ${spare(letter1, 0.78, 23, 28, [3])}))`);
  });
  it("more staff columns, or longer staff text, leave less spare room", () => {
    const few = aggPrintWidthCss("FB", [], { reservedIn: 0.78, autoCount: 5, autoNeedPx: 21, autoNeedCh: 3, titlesCh: [3] }, letter1);
    const many = aggPrintWidthCss("FB", [], { reservedIn: 0.78, autoCount: 30, autoNeedPx: 21, autoNeedCh: 3, titlesCh: [3] }, letter1);
    const wide = aggPrintWidthCss("FB", [], { reservedIn: 0.78, autoCount: 5, autoNeedPx: 42, autoNeedCh: 6, titlesCh: [3] }, letter1);
    expect(few).toContain(`- 5 * ${21 + AUTO_COL_PAD_PX}px`);
    expect(many).toContain(`- 30 * ${21 + AUTO_COL_PAD_PX}px`);
    expect(wide).toContain(`- 5 * ${6 * 7 + AUTO_COL_PAD_PX}px`);
  });
  it("every aggregate title is paid for before the spare is shared (a long title elsewhere shrinks this column's extra, not the staff room)", () => {
    const room = { reservedIn: 0.78, autoCount: 23, autoNeedPx: 28, autoNeedCh: 4, titlesCh: [3, 16] };
    const out = aggPrintWidthCss("FB", [["AB", "CD", "EF"]], room, letter1);
    expect(out).toBe(`min(calc(10ch + 12px), calc(3ch + 12px + ${spare(letter1, 0.78, 23, 28, [3, 16])}))`);
    expect(out).toContain("- 19ch - 24px) / 2)");
  });
  it("no spare room → the title alone (it always fits on one line, card #323)", () => {
    const out = aggPrintWidthCss("ORIENTATION LIST", [["AB", "CD", "EF", "GH", "IJ", "KL", "MN"]], { reservedIn: 0.78, autoCount: 200, autoNeedPx: 56, autoNeedCh: 8, titlesCh: [16] }, letter1);
    expect(out).toMatch(/^min\(calc\(26ch \+ 12px\), calc\(16ch \+ 12px \+ max\(0px, /);
  });
  it("the page width grows by the shrink factor (zoom), the fixed columns do not", () => {
    expect(printFit(a4big).scale).toBeLessThan(1);
    const room = { reservedIn: 1.2, autoCount: 10, autoNeedPx: 21, autoNeedCh: 3, titlesCh: [3, 3] };
    expect(aggPrintWidthCss("FB", [], room, a4big)).toBe(`min(calc(3ch + 12px), calc(3ch + 12px + ${spare(a4big, 1.2, 10, 21, [3, 3])}))`);
  });
  it("before the browser has measured, each character counts as the widest measured letter", () => {
    const out = aggPrintWidthCss("FB", [], { reservedIn: 0.78, autoCount: 20, autoNeedPx: null, autoNeedCh: 4, titlesCh: [3] }, letter1);
    expect(out).toContain(`- 20 * (${4 * AUTO_COL_FALLBACK_CH}ch + ${AUTO_COL_PAD_PX}px)`);
    expect(AUTO_COL_FALLBACK_CH).toBeGreaterThanOrEqual(1.8); // trial: bold "WWW" in the bundled narrow font
  });
  it("bad numbers do not break the CSS", () => {
    const out = aggPrintWidthCss("FB", [], { reservedIn: NaN, autoCount: -1, autoNeedPx: NaN, autoNeedCh: Infinity, titlesCh: [] }, letter1);
    expect(out).not.toMatch(/NaN|Infinity|-1 \*|\/ 0\)/);
  });
  it("the grid passes the room from print-visible columns", () => {
    expect(grid).toMatch(/"--agg-col-w": aggPrintWidthCss\(c\.label, Object\.values\(c\.initialsByDate\), printAggRoom, printLayout\)/);
    expect(grid).toMatch(/printHiddenIds\.has\(p\.id\)/);
    expect(grid).toContain("ref={printRootRef}");
    expect(grid).toContain("{ texts: printAutoTexts.texts, measure: width(span) }");
    expect(grid).toContain('fonts?.addEventListener?.("loadingdone", measure)');
    expect(grid).toMatch(/font-size:var\(--print-font-size\);font-weight:700;letter-spacing:normal;";/);
    expect(grid).toContain('probe + "font-family:var(--print-font)"');
  });
});
