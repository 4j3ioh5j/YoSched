import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Card #309: source pins for the Include / Exclude rule lines of printed aggregate columns.
const src = (p: string) => readFileSync(join(__dirname, "..", "..", "..", p), "utf8");

describe("card #309 wiring", () => {
  it("both pages pass each column's live rule lines (null = its single rule)", () => {
    for (const f of ["src/app/page.tsx", "src/app/settings/page.tsx"]) {
      expect(src(f), f).toMatch(/criteria: liveCriteria\(c\)/);
    }
  });

  it("the Settings page loads every staff member, inactive too, for the People picker", () => {
    const page = src("src/app/settings/page.tsx");
    expect(page).toMatch(/printPeople = await prisma\.staff\.findMany\(\{ orderBy: \{ name: "asc" \}, select: \{ id: true, name: true, isActive: true \} \}\)/);
    expect(page).toMatch(/printPeople=\{printPeople\.map/);
  });

  it("Settings saves rule lines through the new route and never prunes people", () => {
    const ui = src("src/app/settings/settings-page.tsx");
    expect(ui).toMatch(/criteria: buildCriteriaSave\(c\.lines\)/);
    expect(ui).toMatch(/people=\{printPeople\}/);
    expect(ui).toMatch(/\(removed person\)/);
    expect(ui).toMatch(/\(inactive\)/);
    expect(ui).toMatch(/\+ Include rule/);
    expect(ui).toMatch(/\+ Exclude rule/);
  });

  it("the old save route refuses with the reload answer", () => {
    const old = src("src/app/api/settings/print-aggregate-columns/by-shift-id/route.ts");
    expect(old).toMatch(/NextResponse\.json\(STALE_CLIENT, \{ status: 409 \}\)/);
    expect(old).not.toMatch(/printAggregateColumn/);
  });

  it("the criteria route writes the lines with their legacy snapshot", () => {
    const r = src("src/app/api/settings/print-aggregate-columns/criteria/route.ts");
    expect(r).toMatch(/criteriaBase: legacySnapshot\(\{ isOther: row\.isOther, conditionScope: row\.conditionScope, \.\.\.legacy \}\)/);
    expect(r).toMatch(/parseCriteriaIn\(c\.criteria, shifts/);
  });

  it("the shift delete check scans rule lines too", () => {
    expect(src("src/app/api/settings/shift-types/route.ts")).toMatch(/coerceCriteria\(r\.criteria\) \?\? \[\]/);
  });

  it("migration is additive with a guard on line shift ids; rollback keeps the data", () => {
    const m = src("prisma/migrations/20261201000000_print_aggregate_criteria/migration.sql");
    expect(m).toMatch(/ADD COLUMN "criteria" JSONB;/);
    expect(m).toMatch(/ADD COLUMN "criteriaBase" JSONB;/);
    expect(m).toMatch(/CREATE TRIGGER print_aggregate_columns_3_check_criteria_shift_ids/);
    expect(m).toMatch(/print_conditions_reference\(print_criteria_conditions\(criteria\), OLD\.id\)/);
    expect(m).not.toMatch(/UPDATE "print_aggregate_columns"/); // no row is rewritten
    const rb = src("prisma/rollback/20261201000000_print_aggregate_criteria.sql");
    expect(rb).not.toMatch(/DROP COLUMN/);
    expect(rb).toMatch(/DROP TRIGGER IF EXISTS print_aggregate_columns_3_check_criteria_shift_ids/);
  });
});
