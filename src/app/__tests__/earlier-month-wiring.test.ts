import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Card #174: every engine entry point that serves a month's run carries that
// month, so the engine freezes the earlier month; the grid explains the refusal.
const SRC = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");

describe("earlier-month freeze wiring (card #174)", () => {
  it("POST /api/auto-schedule and GET /api/auto-schedule/inputs pass runMonth", () => {
    for (const f of ["api/auto-schedule/route.ts", "api/auto-schedule/inputs/route.ts"]) {
      const src = read(f);
      expect(src).toMatch(/const runMonth = isValidDateRange\(startDate, endDate\) \? owningMonthKey\(startDate, endDate\) : undefined;/);
      expect(src).toContain("buildAutoScheduleInput(startDate, endDate, { runMonth })");
    }
  });

  it("the grid explains an earlier-month refusal", () => {
    const grid = read("schedule-grid.tsx");
    expect(grid).toContain('if (r.reason === "earlier-month")');
    expect(grid).toContain("is in an earlier month and can't be changed by auto-generate${more}");
  });

  it("Day/PP/Range re-solves (edit and scope change) pass the user's explicit frees (card #180)", () => {
    const grid = read("schedule-grid.tsx");
    expect(grid).toContain("freesForScopeWithExplicit(base, nextPins, nextTouched, liveScope, [...nextFrees].map(pinKeyParts))");
    // Card #266 slice B: the scope change copies the refs first (the re-solve is asynchronous).
    expect(grid).toContain("const pins = livePinsRef.current, frees = liveFreesRef.current, touched = liveTouchedRef.current;");
    expect(grid).toContain("freesForScopeWithExplicit(base, pins, touched, scope, [...frees].map(pinKeyParts))");
    expect(grid).not.toMatch(/applyScenario(Steps)?\([^)]*freesForScope\(/);
  });
});
