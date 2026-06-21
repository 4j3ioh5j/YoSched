import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatDateCompact,
  isValidDateFormat,
  calendarMonthBounds,
  DATE_FORMAT_OPTIONS,
  DEFAULT_DATE_FORMAT,
  type DateFormatKey,
} from "../date-format";

const jan5 = new Date(2026, 0, 5);
const dec25 = new Date(2026, 11, 25);

describe("formatDate", () => {
  it("formats MMMM D, YYYY (default)", () => {
    expect(formatDate(jan5, "MMMM D, YYYY")).toBe("January 5, 2026");
    expect(formatDate(dec25, "MMMM D, YYYY")).toBe("December 25, 2026");
  });

  it("formats MMM D, YYYY", () => {
    expect(formatDate(jan5, "MMM D, YYYY")).toBe("Jan 5, 2026");
    expect(formatDate(dec25, "MMM D, YYYY")).toBe("Dec 25, 2026");
  });

  it("formats MM/DD/YYYY with zero-padding", () => {
    expect(formatDate(jan5, "MM/DD/YYYY")).toBe("01/05/2026");
    expect(formatDate(dec25, "MM/DD/YYYY")).toBe("12/25/2026");
  });

  it("formats DD/MM/YYYY with zero-padding", () => {
    expect(formatDate(jan5, "DD/MM/YYYY")).toBe("05/01/2026");
    expect(formatDate(dec25, "DD/MM/YYYY")).toBe("25/12/2026");
  });

  it("formats YYYY-MM-DD (ISO)", () => {
    expect(formatDate(jan5, "YYYY-MM-DD")).toBe("2026-01-05");
    expect(formatDate(dec25, "YYYY-MM-DD")).toBe("2026-12-25");
  });

  it("formats M/D/YYYY without padding", () => {
    expect(formatDate(jan5, "M/D/YYYY")).toBe("1/5/2026");
    expect(formatDate(dec25, "M/D/YYYY")).toBe("12/25/2026");
  });

  it("formats D/M/YYYY without padding", () => {
    expect(formatDate(jan5, "D/M/YYYY")).toBe("5/1/2026");
    expect(formatDate(dec25, "D/M/YYYY")).toBe("25/12/2026");
  });

  it("formats D MMMM YYYY", () => {
    expect(formatDate(jan5, "D MMMM YYYY")).toBe("5 January 2026");
    expect(formatDate(dec25, "D MMMM YYYY")).toBe("25 December 2026");
  });

  it("formats DD.MM.YYYY", () => {
    expect(formatDate(jan5, "DD.MM.YYYY")).toBe("05.01.2026");
    expect(formatDate(dec25, "DD.MM.YYYY")).toBe("25.12.2026");
  });

  it("falls back to MMMM D, YYYY for unknown format", () => {
    expect(formatDate(jan5, "nope" as DateFormatKey)).toBe("January 5, 2026");
  });
});

describe("formatDateCompact", () => {
  it("uses M/D for US-style formats", () => {
    for (const fmt of ["MMMM D, YYYY", "MMM D, YYYY", "MM/DD/YYYY", "M/D/YYYY"] as DateFormatKey[]) {
      expect(formatDateCompact(jan5, fmt)).toBe("1/5");
    }
  });

  it("uses D/M for day-first formats", () => {
    for (const fmt of ["DD/MM/YYYY", "D/M/YYYY", "D MMMM YYYY"] as DateFormatKey[]) {
      expect(formatDateCompact(jan5, fmt)).toBe("5/1");
    }
  });

  it("uses DD.MM for German format", () => {
    expect(formatDateCompact(jan5, "DD.MM.YYYY")).toBe("05.01");
  });

  it("uses MM-DD for ISO format", () => {
    expect(formatDateCompact(jan5, "YYYY-MM-DD")).toBe("01-05");
  });
});

describe("isValidDateFormat", () => {
  it("accepts all defined format keys", () => {
    for (const opt of DATE_FORMAT_OPTIONS) {
      expect(isValidDateFormat(opt.key)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isValidDateFormat("YYYY/MM/DD")).toBe(false);
    expect(isValidDateFormat("")).toBe(false);
    expect(isValidDateFormat("foo")).toBe(false);
  });
});

describe("DEFAULT_DATE_FORMAT", () => {
  it("is a valid format key", () => {
    expect(isValidDateFormat(DEFAULT_DATE_FORMAT)).toBe(true);
  });

  it("is MMMM D, YYYY", () => {
    expect(DEFAULT_DATE_FORMAT).toBe("MMMM D, YYYY");
  });
});

describe("DATE_FORMAT_OPTIONS", () => {
  it("has unique keys", () => {
    const keys = DATE_FORMAT_OPTIONS.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("labels match actual format output for Jan 5, 2026", () => {
    for (const opt of DATE_FORMAT_OPTIONS) {
      expect(formatDate(jan5, opt.key)).toBe(opt.label);
    }
  });
});

describe("calendarMonthBounds", () => {
  it("returns the first and last day of a 31-day month (August, 0-indexed 7)", () => {
    expect(calendarMonthBounds(2026, 7)).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("returns Feb 28 in a non-leap year and Feb 29 in a leap year", () => {
    expect(calendarMonthBounds(2026, 1)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(calendarMonthBounds(2028, 1)).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });

  it("handles December (month index 11) without rolling the year", () => {
    expect(calendarMonthBounds(2026, 11)).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
});
