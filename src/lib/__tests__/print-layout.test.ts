import { describe, it, expect } from "vitest";
import {
  DEFAULT_PRINT_HEADER,
  DEFAULT_PRINT_FOOTER,
  YOSCHED_FOOTER_SUFFIX,
  validatePrintBlock,
  resolvePrintBlock,
  renderPrintTemplate,
  footerLine,
  validatePrintFontFamily,
  validatePrintFontSize,
  DATE_COLUMN_FORMATS,
  DAY_COLUMN_FORMATS,
  isDateColumnFormat,
  isDayColumnFormat,
  formatDateColumn,
  formatDayColumn,
  printLayoutFrom,
  DEFAULT_PRINT_LAYOUT,
  ppLabelText,
} from "../print-layout";

// Card #301: the printed month schedule matches David's MD Schedule PDF. Header and
// footer are templates with fill-in words; " - YoSched" is always appended to the footer.

const ctx = {
  year: 2026,
  month: 0, // January
  printedAt: new Date(Date.UTC(2026, 0, 26, 9, 36)),
  zone: "UTC", // card #320
  dateFormat: "MM/DD/YYYY" as const,
  version: 9 as number | null,
};

describe("defaults", () => {
  it("are generic (no department name) and match the PDF's sizes", () => {
    expect(DEFAULT_PRINT_HEADER).toEqual({ text: "{MONTH} {YEAR} SCHEDULE", size: 16, bold: true, align: "left" });
    expect(DEFAULT_PRINT_FOOTER).toEqual({ text: "{DATE} {TIME} VER: {VERSION}", size: 8, bold: false, align: "right" });
    expect(YOSCHED_FOOTER_SUFFIX).toBe(" - YoSched");
  });
});

describe("validatePrintBlock", () => {
  it("accepts a full block and null", () => {
    const b = { text: "{MONTH} {YEAR} MD SCHEDULE", size: 16, bold: true, align: "left" };
    expect(validatePrintBlock(b)).toEqual({ ok: true, value: b });
    expect(validatePrintBlock(null)).toEqual({ ok: true, value: null });
    expect(validatePrintBlock({ text: "", size: 6, bold: false, align: "center" }).ok).toBe(true);
    expect(validatePrintBlock({ text: "x", size: 32, bold: false, align: "right" }).ok).toBe(true);
  });

  it("rejects bad shapes", () => {
    for (const bad of [
      "text",
      [],
      { text: "x", size: 16, bold: true }, // no align
      { text: 5, size: 16, bold: true, align: "left" },
      { text: "x".repeat(201), size: 16, bold: true, align: "left" },
      { text: "x", size: 5, bold: true, align: "left" },
      { text: "x", size: 33, bold: true, align: "left" },
      { text: "x", size: 9.5, bold: true, align: "left" },
      { text: "x", size: 16, bold: "yes", align: "left" },
      { text: "x", size: 16, bold: true, align: "justify" },
      { text: "line\nbreak", size: 16, bold: true, align: "left" },
    ]) {
      expect(validatePrintBlock(bad).ok).toBe(false);
    }
  });

  it("drops extra keys", () => {
    const r = validatePrintBlock({ text: "x", size: 9, bold: false, align: "left", evil: 1 });
    expect(r).toEqual({ ok: true, value: { text: "x", size: 9, bold: false, align: "left" } });
  });
});

describe("resolvePrintBlock (stored value → block)", () => {
  it("null / invalid stored → the default; valid → itself", () => {
    expect(resolvePrintBlock(null, "header")).toEqual(DEFAULT_PRINT_HEADER);
    expect(resolvePrintBlock(undefined, "footer")).toEqual(DEFAULT_PRINT_FOOTER);
    expect(resolvePrintBlock({ junk: true }, "header")).toEqual(DEFAULT_PRINT_HEADER);
    const b = { text: "T", size: 12, bold: false, align: "center" };
    expect(resolvePrintBlock(b, "header")).toEqual(b);
  });
});

describe("renderPrintTemplate", () => {
  it("fills every word", () => {
    expect(renderPrintTemplate("{MONTH} {YEAR} MD SCHEDULE", ctx)).toBe("JANUARY 2026 MD SCHEDULE");
    expect(renderPrintTemplate("{Month} {MON}", ctx)).toBe("January JAN");
    expect(renderPrintTemplate("{DATE} {TIME} VER: {VERSION}", ctx)).toBe("01/26/2026 09:36 UTC VER: 09");
  });

  it("uses the 24-hour clock", () => {
    expect(renderPrintTemplate("{TIME}", { ...ctx, printedAt: new Date(Date.UTC(2026, 0, 26, 21, 5)) })).toBe("21:05 UTC");
  });

  it("follows the date format setting", () => {
    expect(renderPrintTemplate("{DATE}", { ...ctx, dateFormat: "MMMM D, YYYY" })).toBe("January 26, 2026");
  });

  it("pads the version to two digits, keeps bigger numbers, and shows a dash with no saved version", () => {
    expect(renderPrintTemplate("{VERSION}", { ...ctx, version: 123 })).toBe("123");
    expect(renderPrintTemplate("{VERSION}", { ...ctx, version: null })).toBe("—");
  });

  it("leaves unknown words and plain text as typed", () => {
    expect(renderPrintTemplate("{FOO} <b>x</b> {month}", ctx)).toBe("{FOO} <b>x</b> {month}");
  });

  it("December is month 11", () => {
    expect(renderPrintTemplate("{MONTH}", { ...ctx, month: 11 })).toBe("DECEMBER");
  });
});

describe("footerLine", () => {
  it("always ends with ' - YoSched'", () => {
    expect(footerLine("{DATE} {TIME} VER: {VERSION}", ctx)).toBe("01/26/2026 09:36 UTC VER: 09 - YoSched");
    expect(footerLine("", ctx)).toBe("- YoSched");
    expect(footerLine("   ", ctx)).toBe("- YoSched");
  });
});

describe("print font", () => {
  it("family: letters, digits, spaces and hyphens, 1–64 chars", () => {
    expect(validatePrintFontFamily("Aptos Narrow")).toBe(true);
    expect(validatePrintFontFamily("Archivo-Narrow 2")).toBe(true);
    for (const bad of ["", "x".repeat(65), 'Arial"; color:red', "a;b", 5, null]) {
      expect(validatePrintFontFamily(bad)).toBe(false);
    }
  });

  it("size: whole numbers 6–14", () => {
    expect(validatePrintFontSize(9)).toBe(true);
    expect(validatePrintFontSize(6)).toBe(true);
    expect(validatePrintFontSize(14)).toBe(true);
    for (const bad of [5, 15, 9.5, "9", null]) expect(validatePrintFontSize(bad)).toBe(false);
  });
});

describe("date and day columns", () => {
  it("every date format", () => {
    const iso = "2026-01-05";
    const want: Record<string, string> = {
      "MM-DD": "01-05",
      "DD-MM": "05-01",
      "MM/DD": "01/05",
      "DD/MM": "05/01",
      "M/D": "1/5",
      "D/M": "5/1",
      "DD.MM": "05.01",
    };
    expect([...DATE_COLUMN_FORMATS].sort()).toEqual(Object.keys(want).sort());
    for (const f of DATE_COLUMN_FORMATS) expect(formatDateColumn(iso, f)).toBe(want[f]);
  });

  it("leap day and month end", () => {
    expect(formatDateColumn("2028-02-29", "MM-DD")).toBe("02-29");
    expect(formatDateColumn("2026-12-31", "D/M")).toBe("31/12");
  });

  it("every day format (0 = Sunday)", () => {
    expect([...DAY_COLUMN_FORMATS].sort()).toEqual(["DDD", "Ddd", "Dddd"].sort());
    expect(formatDayColumn(4, "DDD")).toBe("THU");
    expect(formatDayColumn(4, "Ddd")).toBe("Thu");
    expect(formatDayColumn(4, "Dddd")).toBe("Thursday");
    expect(formatDayColumn(0, "DDD")).toBe("SUN");
    expect(formatDayColumn(6, "Dddd")).toBe("Saturday");
  });

  it("format validators", () => {
    expect(isDateColumnFormat("MM-DD")).toBe(true);
    expect(isDateColumnFormat("YYYY")).toBe(false);
    expect(isDayColumnFormat("DDD")).toBe(true);
    expect(isDayColumnFormat("ddd")).toBe(false);
  });
});

describe("printLayoutFrom (prefs row → the grid's print layout)", () => {
  it("no row → every default (split on, MM-DD, DDD, Aptos Narrow 9, PP labels on)", () => {
    expect(printLayoutFrom(null)).toEqual(DEFAULT_PRINT_LAYOUT);
    expect(DEFAULT_PRINT_LAYOUT).toEqual({
      header: DEFAULT_PRINT_HEADER,
      footer: DEFAULT_PRINT_FOOTER,
      fontFamily: "Aptos Narrow",
      fontSize: 9,
      splitDateDay: true,
      dateColumnFormat: "MM-DD",
      dayColumnFormat: "DDD",
      payPeriodLabels: true,
    });
  });

  it("takes valid stored values", () => {
    const h = { text: "{MONTH} {YEAR} MD SCHEDULE", size: 16, bold: true, align: "left" };
    expect(
      printLayoutFrom({
        printHeader: h,
        printFooter: null,
        printFontFamily: "Arial Narrow",
        printFontSize: 10,
        splitDateDayColumns: false,
        dateColumnFormat: "D/M",
        dayColumnFormat: "Dddd",
        printPayPeriodLabels: false,
      }),
    ).toEqual({
      header: h,
      footer: DEFAULT_PRINT_FOOTER,
      fontFamily: "Arial Narrow",
      fontSize: 10,
      splitDateDay: false,
      dateColumnFormat: "D/M",
      dayColumnFormat: "Dddd",
      payPeriodLabels: false,
    });
  });

  it("bad stored values fall back to the defaults, field by field", () => {
    expect(
      printLayoutFrom({
        printHeader: { text: 5 },
        printFontFamily: 'x"; color:red',
        printFontSize: 99,
        splitDateDayColumns: "yes",
        dateColumnFormat: "YYYY",
        dayColumnFormat: "ddd",
        printPayPeriodLabels: null,
      }),
    ).toEqual(DEFAULT_PRINT_LAYOUT);
  });
});

describe("ppLabelText", () => {
  it("is PP#nn, two digits", () => {
    expect(ppLabelText(1)).toBe("PP#01");
    expect(ppLabelText(26)).toBe("PP#26");
    expect(ppLabelText(100)).toBe("PP#100");
  });
});
