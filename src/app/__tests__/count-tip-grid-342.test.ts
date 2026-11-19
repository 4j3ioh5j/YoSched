import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Card #342: the number in a # (count) column shows the day's alerts on hover, using the
// grid's own tooltip and the same mute keys as the Alerts list (countCellTip, tested in
// alerts.test.ts).
describe("count column hover (card #342)", () => {
  it("the count cell builds its tip from the day's warnings and opens/closes the grid tooltip", () => {
    const grid = readFileSync(join(__dirname, "../schedule-grid.tsx"), "utf8");
    const i = grid.indexOf("key={`cnt-${ci}`}");
    expect(i).toBeGreaterThan(-1);
    const before = grid.slice(grid.lastIndexOf("const counts = columnCounts[sc.col.i]", i), i);
    // Card #363: the tip opens with the day of the week and the date, in the Settings format.
    expect(before).toMatch(/const tip = countCellTip\(date, dw, mutedKeys, formatDateWithWeekday\(parseDate\(date\), dateFormat\)\)/);
    const cell = grid.slice(i, grid.indexOf("</td>", i));
    expect(cell).toMatch(/onMouseEnter=\{tip \? \(e\) => showTip\(setTooltip, tip, e\) : undefined\}/);
    expect(cell).toMatch(/onMouseLeave=\{tip \? \(\) => setTooltip\(null\) : undefined\}/);
  });
});
