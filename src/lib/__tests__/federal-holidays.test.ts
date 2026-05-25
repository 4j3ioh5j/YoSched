import { describe, it, expect } from "vitest";
import { getFederalHolidays } from "../federal-holidays";

describe("getFederalHolidays", () => {
  it("returns 11 federal holidays for any year", () => {
    for (const year of [2024, 2025, 2026, 2030]) {
      expect(getFederalHolidays(year)).toHaveLength(11);
    }
  });

  it("returns correct holiday names", () => {
    const names = getFederalHolidays(2026).map((h) => h.name.replace(" (observed)", ""));
    expect(names).toContain("New Year's Day");
    expect(names).toContain("Martin Luther King Jr. Day");
    expect(names).toContain("Presidents' Day");
    expect(names).toContain("Memorial Day");
    expect(names).toContain("Juneteenth");
    expect(names).toContain("Independence Day");
    expect(names).toContain("Labor Day");
    expect(names).toContain("Columbus Day");
    expect(names).toContain("Veterans Day");
    expect(names).toContain("Thanksgiving Day");
    expect(names).toContain("Christmas Day");
  });

  it("returns dates in YYYY-MM-DD format", () => {
    for (const h of getFederalHolidays(2025)) {
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  describe("2025 known dates", () => {
    const holidays = getFederalHolidays(2025);
    const byName = (name: string) =>
      holidays.find((h) => h.name.startsWith(name))!;

    it("New Year's Day = Jan 1", () => {
      expect(byName("New Year").date).toBe("2025-01-01");
    });

    it("MLK Day = 3rd Monday of January = Jan 20", () => {
      expect(byName("Martin Luther King").date).toBe("2025-01-20");
    });

    it("Presidents' Day = 3rd Monday of February = Feb 17", () => {
      expect(byName("Presidents").date).toBe("2025-02-17");
    });

    it("Memorial Day = last Monday of May = May 26", () => {
      expect(byName("Memorial").date).toBe("2025-05-26");
    });

    it("Juneteenth = June 19", () => {
      expect(byName("Juneteenth").date).toBe("2025-06-19");
    });

    it("Independence Day = July 4", () => {
      expect(byName("Independence").date).toBe("2025-07-04");
    });

    it("Labor Day = 1st Monday of September = Sep 1", () => {
      expect(byName("Labor").date).toBe("2025-09-01");
    });

    it("Columbus Day = 2nd Monday of October = Oct 13", () => {
      expect(byName("Columbus").date).toBe("2025-10-13");
    });

    it("Veterans Day = Nov 11", () => {
      expect(byName("Veterans").date).toBe("2025-11-11");
    });

    it("Thanksgiving = 4th Thursday of November = Nov 27", () => {
      expect(byName("Thanksgiving").date).toBe("2025-11-27");
    });

    it("Christmas = Dec 25", () => {
      expect(byName("Christmas").date).toBe("2025-12-25");
    });
  });

  describe("observed date adjustments", () => {
    it("shifts Saturday holidays to Friday", () => {
      // July 4, 2026 is a Saturday → observed Friday July 3
      const holidays = getFederalHolidays(2026);
      const july4 = holidays.find((h) => h.name.startsWith("Independence"))!;
      expect(july4.date).toBe("2026-07-03");
      expect(july4.name).toContain("(observed)");
    });

    it("shifts Sunday holidays to Monday", () => {
      // Jan 1, 2023 is a Sunday → observed Monday Jan 2
      const holidays = getFederalHolidays(2023);
      const newYear = holidays.find((h) => h.name.startsWith("New Year"))!;
      expect(newYear.date).toBe("2023-01-02");
      expect(newYear.name).toContain("(observed)");
    });

    it("does not mark weekday holidays as observed", () => {
      // 2025: all fixed holidays fall on weekdays or are already weekday-computed
      const holidays = getFederalHolidays(2025);
      const newYear = holidays.find((h) => h.name.startsWith("New Year"))!;
      expect(newYear.name).not.toContain("(observed)");
    });
  });

  describe("cross-year consistency", () => {
    it("all dates fall within the requested year", () => {
      for (const year of [2020, 2025, 2030]) {
        for (const h of getFederalHolidays(year)) {
          expect(h.date.startsWith(String(year))).toBe(true);
        }
      }
    });

    it("floating holidays land on the correct day of week", () => {
      for (const year of [2024, 2025, 2026, 2027]) {
        const holidays = getFederalHolidays(year);
        const mlk = holidays.find((h) => h.name.startsWith("Martin"))!;
        const memorial = holidays.find((h) => h.name.startsWith("Memorial"))!;
        const labor = holidays.find((h) => h.name.startsWith("Labor"))!;
        const columbus = holidays.find((h) => h.name.startsWith("Columbus"))!;
        const thanksgiving = holidays.find((h) => h.name.startsWith("Thanksgiving"))!;

        // MLK, Presidents, Memorial, Labor, Columbus = Monday (day 1)
        expect(new Date(mlk.date + "T12:00:00").getDay()).toBe(1);
        expect(new Date(memorial.date + "T12:00:00").getDay()).toBe(1);
        expect(new Date(labor.date + "T12:00:00").getDay()).toBe(1);
        expect(new Date(columbus.date + "T12:00:00").getDay()).toBe(1);
        // Thanksgiving = Thursday (day 4)
        expect(new Date(thanksgiving.date + "T12:00:00").getDay()).toBe(4);
      }
    });
  });
});
