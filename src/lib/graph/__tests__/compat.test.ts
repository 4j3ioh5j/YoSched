import { describe, it, expect } from "vitest";
import { isCompatible, validChartsForMetric, coerceChart } from "../compat";

describe("chart × metric compatibility", () => {
  it("allows the additive counts on bar/pie", () => {
    for (const m of ["shiftCount", "hours", "holidays"] as const) {
      expect(isCompatible(m, "bar")).toBe(true);
      expect(isCompatible(m, "pie")).toBe(true);
    }
  });

  it("permits heatmap only for shiftCount (the per-code metric)", () => {
    expect(isCompatible("shiftCount", "heatmap")).toBe(true);
    expect(isCompatible("hours", "heatmap")).toBe(false);
    expect(isCompatible("holidays", "heatmap")).toBe(false);
    expect(isCompatible("desirability", "heatmap")).toBe(false);
    expect(isCompatible("equityDeviation", "heatmap")).toBe(false);
  });

  it("limits z-score metrics to bar (no pie/heatmap)", () => {
    for (const m of ["desirability", "equityDeviation"] as const) {
      expect(isCompatible(m, "bar")).toBe(true);
      expect(isCompatible(m, "pie")).toBe(false);
      expect(isCompatible(m, "heatmap")).toBe(false);
    }
  });

  it("validChartsForMetric returns the allowed set", () => {
    expect(validChartsForMetric("hours")).toEqual(["bar", "pie"]);
    expect(validChartsForMetric("equityDeviation")).toEqual(["bar"]);
  });

  it("coerceChart keeps a compatible chart and falls back to bar otherwise", () => {
    expect(coerceChart("shiftCount", "heatmap")).toBe("heatmap");
    expect(coerceChart("hours", "heatmap")).toBe("bar"); // heatmap invalid for hours
    expect(coerceChart("desirability", "pie")).toBe("bar");
  });

  it("treats a specific shift code like shiftCount", () => {
    expect(isCompatible("shift:CALL", "heatmap")).toBe(true);
    expect(isCompatible("shift:CALL", "pie")).toBe(true);
    expect(isCompatible("shift:CALL", "bar")).toBe(true);
    expect(validChartsForMetric("shift:ORC")).toEqual(["bar", "pie", "heatmap"]);
  });
});
