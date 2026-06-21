import { describe, it, expect } from "vitest";
import { owningMonthKey, isValidDateRange } from "../auto-clear";

describe("isValidDateRange", () => {
  it("accepts a well-formed, ordered range (and an equal-endpoints range)", () => {
    expect(isValidDateRange("2026-01-01", "2026-01-31")).toBe(true);
    expect(isValidDateRange("2026-01-10", "2026-01-10")).toBe(true);
  });

  it("rejects a reversed range (the critical case)", () => {
    expect(isValidDateRange("2026-01-01", "2025-12-31")).toBe(false);
  });

  it("rejects malformed and rolled-over dates", () => {
    expect(isValidDateRange("2026-13-40", "2026-12-31")).toBe(false);
    expect(isValidDateRange("2026-02-30", "2026-03-31")).toBe(false); // Feb 30 rolls over
    expect(isValidDateRange("not-a-date", "2026-01-31")).toBe(false);
    expect(isValidDateRange("2026-1-1", "2026-01-31")).toBe(false); // not zero-padded
    expect(isValidDateRange("", "")).toBe(false);
  });
});

describe("owningMonthKey", () => {
  it("returns the month for a plain calendar-month range", () => {
    expect(owningMonthKey("2026-01-01", "2026-01-31")).toBe("2026-01");
  });

  it("picks the dominant month when the range spills into adjacent months", () => {
    // Jan view extended to pay-period edges: 3 Dec days + 31 Jan + 2 Feb.
    expect(owningMonthKey("2025-12-29", "2026-02-02")).toBe("2026-01");
  });

  it("resolves an exact day-count tie to the earliest month", () => {
    // Jan 17..31 = 15 days, Feb 1..15 = 15 days → tie → Jan.
    expect(owningMonthKey("2026-01-17", "2026-02-15")).toBe("2026-01");
  });

  it("handles a single-day range", () => {
    expect(owningMonthKey("2026-03-10", "2026-03-10")).toBe("2026-03");
  });

  it("handles a range crossing a year boundary", () => {
    // Dec 1..31 = 31 days, Jan 1..5 = 5 days → Dec.
    expect(owningMonthKey("2025-12-01", "2026-01-05")).toBe("2025-12");
  });
});
