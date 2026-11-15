import { describe, it, expect } from "vitest";
import { columnHoverText } from "../column-hover";

// Card #221: the schedule column-header hover lists the shifts the Equity Factors settings track,
// in their order — never a fixed CALL / ORC / ORL list in code.

const fe = {
  displayDeviation: { overall: 0.5, desirability: -0.25 },
  metrics: { holidayWorkCount: 2, shiftCounts: { NIGHT: 4, DAY: 7, CALL: 9 } as Record<string, number> },
};

describe("columnHoverText", () => {
  it("one line per tracked shift, in Settings order, with the FTE-scaled average", () => {
    const t = columnHoverText({ name: "Ann", empLabel: "50% FTE", fte: 0.5, fe, averages: { holidayWorkCount: 3, perShift: { NIGHT: 6, DAY: 10 } } });
    expect(t.split("\n")).toEqual([
      "Ann (50% FTE)",
      "Equity: +0.50σ",
      "Desirability: +0.25σ",
      "Holiday: 2 (avg 1.5)",
      "NIGHT: 4 (avg 3.0)",
      "DAY: 7 (avg 5.0)",
    ]);
  });
  it("a shift no factor tracks is not shown, even if the person works it", () => {
    const t = columnHoverText({ name: "Ann", empLabel: "x", fte: 1, fe, averages: { holidayWorkCount: 0, perShift: { DAY: 1 } } });
    expect(t).not.toMatch(/CALL|NIGHT/);
  });
  it("a tracked shift the person never worked shows 0", () => {
    const t = columnHoverText({ name: "Ann", empLabel: "x", fte: 1, fe, averages: { holidayWorkCount: 0, perShift: { ICU: 2 } } });
    expect(t).toMatch(/^ICU: 0 \(avg 2\.0\)$/m);
  });
  it("no equity data: just the name and type", () => {
    expect(columnHoverText({ name: "Ann", empLabel: "x", fte: 1, fe: undefined, averages: undefined })).toBe("Ann (x)");
  });
  it("equity data but no averages: no shift lines", () => {
    expect(columnHoverText({ name: "Ann", empLabel: "x", fte: 1, fe, averages: undefined }).split("\n")).toHaveLength(4);
  });
});

describe("columnHoverText order (card #222)", () => {
  it("number-only codes keep the Settings order given in `codes`, not number order", () => {
    const f = { ...fe, metrics: { holidayWorkCount: 0, shiftCounts: { "10": 1, "2": 3 } } };
    const t = columnHoverText({ name: "A", empLabel: "x", fte: 1, fe: f, averages: { holidayWorkCount: 0, perShift: { "10": 1, "2": 2 } }, codes: ["10", "2"] });
    expect(t.split("\n").slice(4)).toEqual(["10: 1 (avg 1.0)", "2: 3 (avg 2.0)"]);
  });
});
