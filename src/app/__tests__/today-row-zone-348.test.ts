import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zonedToday } from "../use-zoned-today";

// Card #348: the today ring on the schedule grid follows the Settings time zone. Before, the
// grid compared rows with the server's UTC date (the page is drawn on the server, and the
// browser keeps the server's ring), so in the evening west of UTC it ringed tomorrow's row.
describe("today row uses the Settings time zone (card #348)", () => {
  it("zonedToday gives the zone's calendar date, and nothing until the zone is loaded", () => {
    const evening = new Date("2026-11-19T03:00:00Z"); // 19:00 on 11-18 in Los Angeles
    expect(zonedToday(evening, "America/Los_Angeles", true)).toBe("2026-11-18");
    expect(zonedToday(evening, "UTC", true)).toBe("2026-11-19");
    expect(zonedToday(evening, "Asia/Tokyo", true)).toBe("2026-11-19");
    expect(zonedToday(new Date("2026-11-18T16:00:00Z"), "Asia/Tokyo", true)).toBe("2026-11-19");
    expect(zonedToday(evening, "America/Los_Angeles", false)).toBeNull();
    expect(zonedToday(evening, "Not/AZone", true)).toBe("2026-11-19"); // invalid → UTC
  });

  it("the grid rings the zone's today, never a server/browser Date", () => {
    const grid = readFileSync(join(__dirname, "../schedule-grid.tsx"), "utf8");
    expect(grid).not.toMatch(/toDateStr\(today\)/);
    expect(grid).toMatch(/const todayStr = useZonedToday\(zone, zoneLoaded\)/);
    expect(grid).toMatch(/const isToday = todayStr !== null && date === todayStr/);
    // The Today button, the past-month test and the export year use the same zoned date.
    const goToday = grid.slice(grid.indexOf("function goToday()"), grid.indexOf("function goToday()") + 300);
    expect(goToday).toMatch(/todayDate\.getFullYear\(\)/);
    expect(grid).toMatch(/isPastMonth\(viewYear, viewMonth, todayDate\)/);
  });

  it("the holiday-rule preview in Settings uses the zone's today, not UTC", () => {
    const s = readFileSync(join(__dirname, "../settings/settings-page.tsx"), "utf8");
    expect(s).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  });
});
