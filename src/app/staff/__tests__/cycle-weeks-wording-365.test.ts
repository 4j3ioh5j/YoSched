import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeWhen } from "@/lib/recurrence";

// Card #365: "every N weeks" counts the weeks of the pay periods (week 1 and week 2 of each,
// numbered on across pay periods), and the wording says so.
const picker = readFileSync(join(__dirname, "../recurrence-picker.tsx"), "utf8");
describe("every N weeks says it follows the pay periods", () => {
  it("the menu choice and the slot label name pay-period weeks", () => {
    expect(picker).toContain('{ value: "cycle_week", label: "Every N pay-period weeks…" }');
    expect(picker).toContain('"pay-period weeks, slot"');
    expect(picker).not.toContain('"Every N weeks…"');
  });
  it("a note explains how the slots are numbered", () => {
    expect(picker).toContain("data-cycle-week-note");
    expect(picker).toMatch(/Weeks follow the pay periods: slot 1 is week 1 of a pay period, slot 2 its week 2, slot 3 the next pay period&apos;s week 1/);
  });
  it("the summary names pay-period weeks and the slot shown in the picker", () => {
    expect(describeWhen({ daysOfWeek: [3], kind: "cycle", cycleUnit: "week", cycleN: 4, cycleOffset: 1 })).toBe("Every 4th pay-period week (slot 2): Wednesday");
    expect(describeWhen({ daysOfWeek: [3], kind: "cycle", cycleUnit: "week", cycleN: 1, cycleOffset: 0 })).toBe("Every pay-period week: Wednesday");
  });
});
