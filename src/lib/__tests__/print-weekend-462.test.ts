// Card #462: a printed month that ends on the weekend's FIRST day also prints the weekend's
// second day, so a paired weekend CALL shows whole. The weekend comes from Settings.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { printExtraDate } from "../print-weekend";
import { printFit, printPage, printPageStyle, printUdWidthsIn, printRowHeightIn, PRINT_BOX, DEFAULT_PRINT_LAYOUT, type PrintLayout } from "../print-layout";
import { buildPrintedMonth } from "../print-month-model";
import { pdfMonthLayout, pdfPage } from "../export-pdf";
import { input, NOW } from "./fixtures/export-input";

describe("printExtraDate", () => {
  it("a month ending on a Saturday with a Saturday + Sunday weekend adds the Sunday", () => {
    expect(printExtraDate("2026-01-31", 6)).toBe("2026-02-01");
    expect(printExtraDate("2026-10-31", 6)).toBe("2026-11-01");
  });
  it("follows the Settings weekend: Friday + Saturday adds the Saturday after a Friday month end", () => {
    expect(printExtraDate("2026-07-31", 5)).toBe("2026-08-01"); // 2026-07-31 is a Friday
    expect(printExtraDate("2026-01-31", 5)).toBeNull(); // Saturday is that weekend's second day
  });
  it("no extra day when the month ends on any other day", () => {
    expect(printExtraDate("2026-11-30", 6)).toBeNull(); // Monday
    expect(printExtraDate("2026-05-31", 6)).toBeNull(); // Sunday: the weekend is already whole
  });
  it("December crosses into the next year", () => {
    expect(printExtraDate("2033-12-31", 6)).toBe("2034-01-01"); // 2033-12-31 is a Saturday
  });
  it("junk input gives no extra day", () => {
    expect(printExtraDate("", 6)).toBeNull();
    expect(printExtraDate("2026-01-31", 9)).toBeNull();
  });
});

const big = (paper: "letter" | "a4", marginHundredths: number): PrintLayout => ({
  ...DEFAULT_PRINT_LAYOUT,
  paper,
  marginHundredths,
  fontSize: 14,
  header: { ...DEFAULT_PRINT_LAYOUT.header, size: 32 },
  footer: { ...DEFAULT_PRINT_LAYOUT.footer, size: 32 },
});

describe("browser print fits 32 printed days on one page", () => {
  it("a month of 31 days or fewer is unchanged", () => {
    const l = DEFAULT_PRINT_LAYOUT;
    expect(printFit(l, 31)).toEqual(printFit(l));
    expect(printFit(l, 28)).toEqual(printFit(l));
    expect(printRowHeightIn(l, 30)).toBe(printRowHeightIn(l));
  });
  for (const paper of ["letter", "a4"] as const) {
    for (const margin of [25, 100]) {
      for (const layout of [{ ...DEFAULT_PRINT_LAYOUT, paper, marginHundredths: margin }, big(paper, margin)]) {
        it(`${paper} ${margin} font ${layout.fontSize}: title + 33 rows + footer fit inside the page`, () => {
          const P = printPage(layout);
          const fit = printFit(layout, 32);
          const used = PRINT_BOX.titleIn(layout.header.size) + 33 * fit.rowIn + PRINT_BOX.footerIn(layout.footer.size) + PRINT_BOX.slackIn;
          expect(used * fit.scale).toBeLessThanOrEqual(P.hIn - 2 * P.marginIn + 1e-6);
          expect(fit.rowIn).toBeLessThanOrEqual(printFit(layout).rowIn);
        });
      }
    }
  }
  it("the page style and the user-defined column widths shrink with the printed day count", () => {
    const l = big("letter", 100);
    const zoom = (css: string) => Number(/zoom:([0-9.]+)/.exec(css)?.[1] ?? 1);
    expect(zoom(printPageStyle(l, undefined, 32))).toBeLessThan(zoom(printPageStyle(l)));
    const cols = [{ key: "k", fitPx: 2000, titlePx: 50, fitCh: 10, titleCh: 3 }];
    const room = { reservedIn: 8, autoCount: 10, autoNeedPx: 20, autoNeedCh: 2 }; // tight: the width is the room left
    expect(printUdWidthsIn(l, cols, room, 32)).not.toEqual(printUdWidthsIn(l, cols, room));
    expect(printUdWidthsIn(l, cols, room, 31)).toEqual(printUdWidthsIn(l, cols, room));
  });
});

describe("year export: January 2026 ends on a Saturday", () => {
  it("prints Sunday February 1 as the last row, with its own weekday, label and weekend shade", () => {
    const m = buildPrintedMonth(input({ assignments: [...input().assignments, { staffId: "a", date: "2026-02-01", shiftTypeId: "call", code: "CALL" }] }), 2026, 0, NOW);
    expect(m.rows).toHaveLength(32);
    const sun = m.rows[31];
    expect(sun.iso).toBe("2026-02-01");
    expect(sun.dow).toBe(0);
    expect(sun.dayText).toBe("SUN");
    expect(sun.dateText).toBe("02-01");
    expect(sun.shade).toBe(m.rows[30].shade); // Saturday and Sunday share the weekend shade
    expect(sun.monthLast).toBe(true); // the heavy bottom line moves to the last printed row
    expect(m.rows[30].monthLast).toBe(false);
    const ci = m.columns.findIndex((c) => c.label === "AA");
    expect(sun.cells[ci].text).toBe("CALL");
  });
  it("the compact date label (one date column) reads the extra day's own date", () => {
    const layout = { ...input().printLayout, splitDateDay: false };
    const m = buildPrintedMonth(input({ printLayout: layout }), 2026, 0, NOW);
    expect(m.rows[31].dateText).toBe("Sun 2/1");
    expect(m.rows[30].dateText).toBe("Sat 1/31");
  });
  it("a staff member who works only the extra day gets a printed column in a past month", () => {
    const d = { id: "d", initials: "DD", employmentTypeId: "ft", ftePercentage: 1, isActive: false };
    const base = input();
    const m = buildPrintedMonth({ ...base, staff: [...base.staff, d], assignments: [...base.assignments, { staffId: "d", date: "2026-02-01", shiftTypeId: "call", code: "CALL" }] }, 2026, 0, NOW);
    expect(m.columns.map((c) => c.label)).toContain("DD");
  });
  it("other months are unchanged, and December 2033 prints January 1, 2034", () => {
    expect(buildPrintedMonth(input(), 2026, 10, NOW).rows).toHaveLength(30); // Nov 30 2026 is a Monday
    expect(buildPrintedMonth(input(), 2026, 1, NOW).rows.at(-1)!.iso).toBe("2026-03-01"); // Feb 28 2026 is a Saturday
    const dec = buildPrintedMonth(input(), 2033, 11, NOW);
    expect(dec.rows).toHaveLength(32);
    expect(dec.rows[31].iso).toBe("2034-01-01");
    expect(dec.rows[31].dayText).toBe("SUN");
  });
  it("the PDF fits the 32-day month inside the page", () => {
    for (const paper of ["letter", "a4"] as const) {
      for (const margin of [25, 100]) {
        const layout = big(paper, margin);
        const P = pdfPage(layout);
        const l = pdfMonthLayout(buildPrintedMonth(input({ printLayout: layout }), 2026, 0, NOW));
        expect(l.tableTop + l.rowH * 33).toBeLessThanOrEqual(l.footerTop + 0.01);
        expect(l.footerTop + l.footerSize).toBeLessThanOrEqual(P.h - P.margin + 0.01);
        expect(l.fontSize * 1.15).toBeLessThanOrEqual(l.rowH + 0.01);
      }
    }
    // A 31-day month keeps today's row height.
    const dec = pdfMonthLayout(buildPrintedMonth(input(), 2026, 11, NOW));
    const mar = pdfMonthLayout(buildPrintedMonth(input(), 2026, 2, NOW));
    expect(dec.rowH).toBe(mar.rowH);
  });
});

describe("grid wiring", () => {
  const grid = readFileSync(join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
  const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
  const print = css.slice(css.indexOf("@media print"));

  it("the scheduling dates are untouched; only the rendered rows add the print-only day", () => {
    expect(grid).toMatch(/monthGridDates\(viewYear, viewMonth, payPeriods\)/);
    expect(grid).toMatch(/const printExtra = useMemo\(\(\) => printExtraDate\(lastOfMonth, weekendStartDow\)/);
    expect(grid).toMatch(/const printLast = printExtra \?\? lastOfMonth;/);
    expect(grid).toMatch(/printOnly: true/);
    expect(grid).toMatch(/data-print-only=\{item\.printOnly \|\| undefined\}/);
    expect(grid).toMatch(/data-print-extra=\{date === printExtra \|\| undefined\}/);
    expect(grid).toMatch(/data-month-last=\{date === printLast \|\| undefined\}/);
  });
  it("print sizing gets the printed day count", () => {
    expect(grid).toMatch(/printRowHeightIn\(printLayout, printedDayCount\)/);
    expect(grid).toMatch(/printPageStyle\(printLayout, udPrint\.needIn, printedDayCount\)/);
    expect(grid).toMatch(/printUdWidthsIn\(printLayout, cols, \{[\s\S]*?\}, printedDayCount\)/);
  });
  it("print CSS shows the extra day and hides other outside-month days; the screen hides print-only rows", () => {
    expect(print).toMatch(/tr\[data-outside-month\]:not\(\[data-print-extra\]\) \{\s*display: none !important;/);
    expect(css).toMatch(/tr\[data-print-only\] \{\s*display: none;/);
    expect(print).toMatch(/tr\[data-print-only\] \{\s*display: table-row !important;/);
  });
  it("print columns, rosters and counts read the printed range", () => {
    expect(grid).toMatch(/computePrintColumns\(\{\s*visibleStaff,\s*dates: renderDates,\s*firstOfMonth,\s*lastOfMonth: printLast,/);
  });
});
