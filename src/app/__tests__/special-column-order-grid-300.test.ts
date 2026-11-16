import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Card #300: the header, the pay-period summary row and the day rows all render the
// special columns from ONE ordered list, so they line up whatever order the admin sets.
// (The ordering itself is unit-tested in src/lib/__tests__/special-columns.test.ts.)

const grid = readFileSync(path.resolve(__dirname, "..", "schedule-grid.tsx"), "utf8");

describe("schedule grid renders special columns from the ordered list", () => {
  it("has exactly three render sites mapping specialColumns (header, PP row, day rows)", () => {
    expect(grid.match(/\{specialColumns\.map\(/g)?.length).toBe(3);
  });

  it("no longer renders any group on its own, or spans a group with colSpan", () => {
    expect(grid).not.toMatch(/\{printAggColumns\.map\(/);
    expect(grid).not.toMatch(/\{countColumns\.map\(/);
    expect(grid).not.toMatch(/\{columnCounts\.map\(/);
    expect(grid).not.toMatch(/\{dedicatedColumns\.map\(/);
    expect(grid).not.toMatch(/colSpan=\{dedicatedColumns\.length\}/);
    expect(grid).not.toMatch(/colSpan=\{countColumns\.length\}/);
  });

  it("dedicated columns (arrow keys, initials) follow the admin-set order", () => {
    expect(grid).toMatch(/const dedicatedColumns = useMemo\(\s*\(\) => orderSpecialColumns\(\{ agg: \[\], ded: shiftTypes\.filter\(\(st\) => st\.dedicatedColumn\), count: \[\] \}, specialColumnOrder\)/);
  });

  it("each special cell picks its data by the column's index in its own group (ids keep it tied)", () => {
    expect(grid).toContain("const c = printAggColumns[sc.col.i]");
    expect(grid).toContain("const st = dedicatedColumns[sc.col.i]");
    expect(grid).toContain("const counts = columnCounts[sc.col.i]");
  });
});
