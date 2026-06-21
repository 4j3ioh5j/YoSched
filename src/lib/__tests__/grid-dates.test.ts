import { describe, it, expect } from "vitest";
import { monthGridDates, type GridPayPeriod } from "../grid-dates";

// Biweekly pay periods around August 2026, straddling both month edges:
// Jul 26–Aug 8 (leads into August), Aug 23–Sep 5 (continues into September),
// Sep 6–19 (the period that should NOT be pulled in).
const PPS: GridPayPeriod[] = [
  { startDate: "2026-07-26", endDate: "2026-08-08" },
  { startDate: "2026-08-09", endDate: "2026-08-22" },
  { startDate: "2026-08-23", endDate: "2026-09-05" },
  { startDate: "2026-09-06", endDate: "2026-09-19" },
];

describe("monthGridDates — pay-period aligned", () => {
  const aug = monthGridDates(2026, 7, PPS); // month index 7 = August

  it("starts at the leading straddling period's first day", () => {
    expect(aug[0]).toBe("2026-07-26");
  });

  it("ends at the trailing straddling period's last day, not the period after", () => {
    expect(aug[aug.length - 1]).toBe("2026-09-05");
    expect(aug).not.toContain("2026-09-06"); // the Sep 6–19 period is excluded
  });

  it("includes every day of the month and both straddling tails contiguously", () => {
    expect(aug).toContain("2026-08-01");
    expect(aug).toContain("2026-08-31");
    expect(aug).toContain("2026-07-31"); // leading tail
    expect(aug).toContain("2026-09-01"); // trailing tail
    // Contiguous, no gaps/dupes: Jul 26 → Sep 5 inclusive = 42 days.
    expect(aug.length).toBe(42);
    expect(new Set(aug).size).toBe(42);
  });

  it("does not pad to week boundaries when a pay period aligns to the month edge", () => {
    // A pay period that starts exactly on the 1st → no leading previous-month days.
    const pps: GridPayPeriod[] = [
      { startDate: "2026-08-01", endDate: "2026-08-14" },
      { startDate: "2026-08-15", endDate: "2026-08-31" },
    ];
    const dates = monthGridDates(2026, 7, pps);
    expect(dates[0]).toBe("2026-08-01");
    expect(dates[dates.length - 1]).toBe("2026-08-31");
  });
});

describe("monthGridDates — fallback when pay periods are missing", () => {
  it("falls back to whole-week padding (Sat–Sun) with no pay periods", () => {
    // August 2026: Aug 1 is Saturday (stays), Aug 31 is Monday → next Sunday Sep 6.
    const dates = monthGridDates(2026, 7, []);
    expect(dates[0]).toBe("2026-08-01");
    expect(dates[dates.length - 1]).toBe("2026-09-06");
  });

  it("pads only the uncovered edge when one edge has a pay period", () => {
    // Pay period covers the start (Jul 26–Aug 8) but nothing covers Aug 31.
    const dates = monthGridDates(2026, 7, [{ startDate: "2026-07-26", endDate: "2026-08-08" }]);
    expect(dates[0]).toBe("2026-07-26"); // start: PP-aligned
    expect(dates[dates.length - 1]).toBe("2026-09-06"); // end: week-padded
  });
});
