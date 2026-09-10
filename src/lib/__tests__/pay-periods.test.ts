import { describe, it, expect } from "vitest";
import {
  periodContaining,
  periodsCovering,
  payPeriodLabel,
  periodLengthOf,
  isValidDateString,
  isValidPeriodLength,
  toEpochDay,
} from "../pay-periods";

// David's confirmed real-world anchor: 2026 PP 1 = Jan 11 – Jan 24, 2026.
const ANCHOR = "2026-01-11";
const LEN = 14;

describe("periodsCovering", () => {
  it("generates a contiguous ladder of exact-length periods across all of 2026", () => {
    const periods = periodsCovering(ANCHOR, LEN, "2026-01-01", "2026-12-31");
    for (const p of periods) {
      expect(periodLengthOf(p)).toBe(14);
    }
    for (let i = 1; i < periods.length; i++) {
      expect(toEpochDay(periods[i].startDate)).toBe(toEpochDay(periods[i - 1].endDate) + 1);
    }
  });

  it("is immune to DST transitions (regression: 13-day Mar 8 and 15-day Oct 31 periods)", () => {
    // Under the old local-time setDate() math with a DST-observing server TZ, the
    // period starting 2026-03-08 (US spring-forward) ended 2026-03-20 (13 days)
    // and the one starting 2026-10-31 (fall-back) ran 15 days.
    const spring = periodContaining(ANCHOR, LEN, "2026-03-08");
    expect(spring).toEqual({ startDate: "2026-03-08", endDate: "2026-03-21" });
    const fall = periodContaining(ANCHOR, LEN, "2026-11-01");
    expect(fall).toEqual({ startDate: "2026-11-01", endDate: "2026-11-14" });
  });

  it("includes straddling periods at both window edges", () => {
    const periods = periodsCovering(ANCHOR, LEN, "2026-01-01", "2026-12-31");
    // Jan 1–10, 2026 is covered by the tail of 2025's last period.
    expect(periods[0]).toEqual({ startDate: "2025-12-28", endDate: "2026-01-10" });
    // Dec 27 starts the straddler into 2027.
    expect(periods[periods.length - 1]).toEqual({ startDate: "2026-12-27", endDate: "2027-01-09" });
  });

  it("extends backward before the anchor", () => {
    const periods = periodsCovering(ANCHOR, LEN, "2025-01-01", "2025-12-31");
    expect(periods[0].startDate < "2025-01-01").toBe(true);
    expect(periods[periods.length - 1].endDate >= "2025-12-31").toBe(true);
    for (const p of periods) expect(periodLengthOf(p)).toBe(14);
  });
});

describe("periodContaining", () => {
  it("returns the anchor period for the anchor date", () => {
    expect(periodContaining(ANCHOR, LEN, "2026-01-11")).toEqual({ startDate: "2026-01-11", endDate: "2026-01-24" });
    expect(periodContaining(ANCHOR, LEN, "2026-01-24")).toEqual({ startDate: "2026-01-11", endDate: "2026-01-24" });
  });

  it("handles dates before the anchor (negative offsets floor correctly)", () => {
    expect(periodContaining(ANCHOR, LEN, "2026-01-10")).toEqual({ startDate: "2025-12-28", endDate: "2026-01-10" });
    expect(periodContaining(ANCHOR, LEN, "2025-12-28")).toEqual({ startDate: "2025-12-28", endDate: "2026-01-10" });
  });
});

describe("payPeriodLabel", () => {
  it("numbers the first full period of the year as PP 1", () => {
    expect(payPeriodLabel("2026-01-11", LEN)).toEqual({ year: 2026, number: 1 });
    expect(payPeriodLabel("2026-01-25", LEN)).toEqual({ year: 2026, number: 2 });
    expect(payPeriodLabel("2027-01-10", LEN)).toEqual({ year: 2027, number: 1 });
  });

  it("assigns the New Year's straddler to the year it starts in, as its last PP", () => {
    expect(payPeriodLabel("2026-12-27", LEN)).toEqual({ year: 2026, number: 26 });
    expect(payPeriodLabel("2025-12-28", LEN)).toEqual({ year: 2025, number: 26 });
  });

  it("numbers a period starting exactly Jan 1 as PP 1", () => {
    expect(payPeriodLabel("2028-01-01", LEN)).toEqual({ year: 2028, number: 1 });
  });

  it("works for non-biweekly lengths", () => {
    expect(payPeriodLabel("2026-01-05", 7)).toEqual({ year: 2026, number: 1 });
    expect(payPeriodLabel("2026-01-12", 7)).toEqual({ year: 2026, number: 2 });
    expect(payPeriodLabel("2026-12-28", 7)).toEqual({ year: 2026, number: 52 });
  });

  it("matches position-among-periods-starting-that-year across a full generated ladder", () => {
    const periods = periodsCovering(ANCHOR, LEN, "2025-01-01", "2028-12-31");
    const byYear = new Map<number, number>();
    for (const p of periods) {
      const label = payPeriodLabel(p.startDate, LEN);
      // The window's first period starts in 2024 — that year is only partially
      // covered (it's 2024's LAST period), so positional counting applies only
      // to years whose full ladder lies inside the window.
      if (label.year < 2025) continue;
      const next = (byYear.get(label.year) ?? 0) + 1;
      byYear.set(label.year, next);
      expect(label.number).toBe(next);
    }
  });
});

describe("validation", () => {
  it("accepts real dates and rejects malformed or impossible ones", () => {
    expect(isValidDateString("2026-01-11")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("not-a-date")).toBe(false);
    expect(isValidDateString(20260111)).toBe(false);
    expect(isValidDateString("")).toBe(false);
  });

  it("bounds period length to sane payroll cadences", () => {
    expect(isValidPeriodLength(14)).toBe(true);
    expect(isValidPeriodLength(7)).toBe(true);
    expect(isValidPeriodLength(56)).toBe(true);
    expect(isValidPeriodLength(6)).toBe(false);
    expect(isValidPeriodLength(57)).toBe(false);
    expect(isValidPeriodLength(14.5)).toBe(false);
    expect(isValidPeriodLength("14")).toBe(false);
  });
});
