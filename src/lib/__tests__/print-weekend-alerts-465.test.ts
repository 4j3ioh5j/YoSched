// Card #465: the printed extra day (card #462) widens the columns only. The month's hours and
// request alerts still use the staff who belong to the month itself, so someone who works only
// the extra day gets no alert for the month.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { visibleStaffForMonth } from "../schedule-visibility";

describe("month-only staff for alerts", () => {
  const grid = readFileSync(join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
  const block = (name: string) => {
    const start = grid.indexOf(`const ${name} = useMemo(`);
    expect(start).toBeGreaterThan(-1);
    return grid.slice(start, grid.indexOf("\n  }, [", start) + 200);
  };

  it("a month-only staff list is built with the month's own last day", () => {
    expect(grid).toMatch(/const monthStaff = useMemo\([\s\S]*?printExtra\s*\? visibleStaffForMonth\([\s\S]*?lastOfMonth,[\s\S]*?: visibleStaff/);
  });
  it("hours and request alerts read the month-only list", () => {
    expect(block("ppHoursAlerts")).toMatch(/for \(const p of monthStaff\)/);
    expect(block("ppHoursAlerts")).not.toMatch(/visibleStaff/);
    expect(block("requestAlerts")).toMatch(/monthStaff\.map/);
    expect(block("requestAlerts")).not.toMatch(/visibleStaff/);
  });
  it("in a past month, extra-day-only staff are in the column list but not the month list", () => {
    const staff = [{ id: "d", isActive: false }] as never[];
    const rows = [{ staffId: "d", date: "2026-02-01", shiftTypeId: "call" }] as never[];
    const off = new Set<string>();
    expect(visibleStaffForMonth(staff, rows, "2026-01-01", "2026-02-01", true, false, off).map((p: { id: string }) => p.id)).toEqual(["d"]);
    expect(visibleStaffForMonth(staff, rows, "2026-01-01", "2026-01-31", true, false, off)).toEqual([]);
  });
});
