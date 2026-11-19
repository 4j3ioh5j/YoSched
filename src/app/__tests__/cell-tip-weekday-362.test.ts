import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatDateWithWeekday, DATE_FORMAT_OPTIONS } from "@/lib/date-format";

// Card #362: the cell hover tooltip names the day of the week before the date.
describe("cell tooltip day of week (card #362)", () => {
  it("puts the full weekday before the date in every date format", () => {
    const d = new Date(2026, 10, 19); // Thursday
    expect(formatDateWithWeekday(d, "MMMM D, YYYY")).toBe("Thursday, November 19, 2026");
    expect(formatDateWithWeekday(d, "YYYY-MM-DD")).toBe("Thursday, 2026-11-19");
    expect(formatDateWithWeekday(d, "D MMMM YYYY")).toBe("Thursday, 19 November 2026");
    for (const { key } of DATE_FORMAT_OPTIONS) {
      expect(formatDateWithWeekday(new Date(2026, 10, 22), key)).toMatch(/^Sunday, /);
    }
  });

  it("the grid's cell tooltip uses it for its first line", () => {
    const grid = readFileSync(join(__dirname, "../schedule-grid.tsx"), "utf8");
    const i = grid.indexOf("const cellTooltip = useCallback(");
    expect(i).toBeGreaterThan(-1);
    const body = grid.slice(i, grid.indexOf("[dateFormat, sourceLine, requestLine]", i));
    expect(body).toContain("`${initials} · ${formatDateWithWeekday(parseDate(date), dateFormat)}`");
  });
});
