import { describe, it, expect } from "vitest";
import { computeFairness, fairnessColor, fairnessLabel, heatmapTempColor, type EquityFactor } from "../fairness";

function makeProvider(id: string, initials: string, fte = 1) {
  return { id, initials, ftePercentage: fte, isActive: true, isAutoScheduled: true };
}

function makeAssignment(
  providerId: string,
  date: string,
  shiftCode: string,
  shiftId: string,
  hours = 8,
  opts: { countsTowardFte?: boolean; isLeave?: boolean; isOffShift?: boolean } = {},
) {
  return {
    providerId,
    date,
    shiftType: {
      id: shiftId,
      code: shiftCode,
      defaultHours: hours,
      countsTowardFte: opts.countsTowardFte ?? true,
      isLeave: opts.isLeave ?? false,
      isOffShift: opts.isOffShift ?? false,
    },
  };
}

describe("computeFairness", () => {
  it("returns empty metrics for no providers", () => {
    const result = computeFairness({
      assignments: [],
      providers: [],
      desirabilityWeights: [],
      holidays: [],
    });
    expect(result.metrics).toEqual([]);
  });

  it("skips inactive providers", () => {
    const result = computeFairness({
      assignments: [],
      providers: [{ ...makeProvider("p1", "AB"), isActive: false }],
      desirabilityWeights: [],
      holidays: [],
    });
    expect(result.metrics).toHaveLength(0);
  });

  it("skips non-auto-scheduled providers", () => {
    const result = computeFairness({
      assignments: [],
      providers: [{ ...makeProvider("p1", "AB"), isAutoScheduled: false }],
      desirabilityWeights: [],
      holidays: [],
    });
    expect(result.metrics).toHaveLength(0);
  });

  it("counts work days for FTE-counting shifts", () => {
    const result = computeFairness({
      assignments: [
        makeAssignment("p1", "2025-05-12", "OR", "st1"),
        makeAssignment("p1", "2025-05-13", "OR", "st1"),
        makeAssignment("p1", "2025-05-14", "ADM", "st2", 8, { countsTowardFte: false }),
      ],
      providers: [makeProvider("p1", "AB")],
      desirabilityWeights: [],
      holidays: [],
    });
    expect(result.metrics[0].totalWorkDays).toBe(2);
  });

  it("counts leave days separately", () => {
    const result = computeFairness({
      assignments: [
        makeAssignment("p1", "2025-05-12", "OR", "st1"),
        makeAssignment("p1", "2025-05-13", "PTO", "st2", 8, { isLeave: true }),
      ],
      providers: [makeProvider("p1", "AB")],
      desirabilityWeights: [],
      holidays: [],
    });
    expect(result.metrics[0].totalWorkDays).toBe(1);
    expect(result.metrics[0].totalLeaveDays).toBe(1);
  });

  it("skips off-shift assignments entirely", () => {
    const result = computeFairness({
      assignments: [
        makeAssignment("p1", "2025-05-12", "OFF", "st1", 0, { isOffShift: true }),
      ],
      providers: [makeProvider("p1", "AB")],
      desirabilityWeights: [],
      holidays: [],
    });
    expect(result.metrics[0].totalWorkDays).toBe(0);
    expect(result.metrics[0].totalLeaveDays).toBe(0);
    expect(Object.keys(result.metrics[0].shiftCounts)).toHaveLength(0);
  });

  it("counts holiday work for FTE-counting shifts on holidays", () => {
    const result = computeFairness({
      assignments: [
        makeAssignment("p1", "2025-05-26", "OR", "st1"), // Memorial Day 2025
        makeAssignment("p1", "2025-05-27", "OR", "st1"),
      ],
      providers: [makeProvider("p1", "AB")],
      desirabilityWeights: [],
      holidays: [{ date: "2025-05-26" }],
    });
    expect(result.metrics[0].holidayWorkCount).toBe(1);
  });

  it("tracks shift counts by code", () => {
    const result = computeFairness({
      assignments: [
        makeAssignment("p1", "2025-05-12", "OR", "st1"),
        makeAssignment("p1", "2025-05-13", "OR", "st1"),
        makeAssignment("p1", "2025-05-14", "ORC", "st2"),
      ],
      providers: [makeProvider("p1", "AB")],
      desirabilityWeights: [],
      holidays: [],
    });
    expect(result.metrics[0].shiftCounts).toEqual({ OR: 2, ORC: 1 });
  });

  it("computes desirability score from weights", () => {
    const result = computeFairness({
      assignments: [
        makeAssignment("p1", "2025-05-12", "OR", "st1"), // Monday = DOW 1
        makeAssignment("p1", "2025-05-17", "OR", "st1"), // Saturday = DOW 6
      ],
      providers: [makeProvider("p1", "AB")],
      desirabilityWeights: [
        { shiftTypeId: "st1", dayOfWeek: 1, weight: 2 },
        { shiftTypeId: "st1", dayOfWeek: 6, weight: -3 },
      ],
      holidays: [],
    });
    expect(result.metrics[0].desirabilityScore).toBe(-1); // 2 + (-3)
    expect(result.metrics[0].desirableShiftCount).toBe(1);
    expect(result.metrics[0].undesirableShiftCount).toBe(1);
  });

  it("handles Date objects in assignments and holidays", () => {
    const result = computeFairness({
      assignments: [
        { ...makeAssignment("p1", "2025-05-12", "OR", "st1"), date: new Date(2025, 4, 12) },
      ],
      providers: [makeProvider("p1", "AB")],
      desirabilityWeights: [],
      holidays: [{ date: new Date(2025, 4, 12) }],
    });
    expect(result.metrics[0].holidayWorkCount).toBe(1);
  });

  it("populates trackedShiftCodes from desirability weights", () => {
    const result = computeFairness({
      assignments: [
        makeAssignment("p1", "2025-05-12", "OR", "st1"),
        makeAssignment("p1", "2025-05-13", "ORC", "st2"),
      ],
      providers: [makeProvider("p1", "AB")],
      desirabilityWeights: [
        { shiftTypeId: "st1", dayOfWeek: 1, weight: 1 },
        { shiftTypeId: "st2", dayOfWeek: 2, weight: -1 },
      ],
      holidays: [],
    });
    expect(result.trackedShiftCodes).toContain("OR");
    expect(result.trackedShiftCodes).toContain("ORC");
  });

  describe("equity factors", () => {
    it("produces equityShiftCodes from enabled shift factors", () => {
      const factors: EquityFactor[] = [
        { factorType: "shift", shiftCode: "OR", weight: 1, enabled: true },
        { factorType: "shift", shiftCode: "ORC", weight: 1, enabled: false },
        { factorType: "desirability", shiftCode: null, weight: 1, enabled: true },
      ];
      const result = computeFairness({
        assignments: [makeAssignment("p1", "2025-05-12", "OR", "st1")],
        providers: [makeProvider("p1", "AB")],
        desirabilityWeights: [],
        holidays: [],
        equityFactors: factors,
      });
      expect(result.equityShiftCodes).toEqual(["OR"]);
    });
  });

  describe("FTE normalization", () => {
    it("deviations account for part-time FTE", () => {
      const factors: EquityFactor[] = [
        { factorType: "holiday", shiftCode: null, weight: 1, enabled: true },
      ];
      const result = computeFairness({
        assignments: [
          makeAssignment("p1", "2025-05-26", "OR", "st1"),
          makeAssignment("p2", "2025-05-26", "OR", "st1"),
        ],
        providers: [
          makeProvider("p1", "AB", 1),
          makeProvider("p2", "CD", 0.5),
        ],
        desirabilityWeights: [],
        holidays: [{ date: "2025-05-26" }],
        equityFactors: factors,
      });
      // p2 at 0.5 FTE doing same holiday work should have higher burden
      const d1 = result.deviations.get("p1")!;
      const d2 = result.deviations.get("p2")!;
      expect(d2.holidayWork).toBeGreaterThan(d1.holidayWork);
    });
  });

  describe("multi-provider averages", () => {
    it("computes correct averages across providers", () => {
      const result = computeFairness({
        assignments: [
          makeAssignment("p1", "2025-05-12", "OR", "st1"),
          makeAssignment("p1", "2025-05-13", "OR", "st1"),
          makeAssignment("p2", "2025-05-12", "OR", "st1"),
        ],
        providers: [
          makeProvider("p1", "AB"),
          makeProvider("p2", "CD"),
        ],
        desirabilityWeights: [
          { shiftTypeId: "st1", dayOfWeek: 1, weight: 2 },
          { shiftTypeId: "st1", dayOfWeek: 2, weight: 1 },
        ],
        holidays: [],
      });
      // p1 desirability: 2 + 1 = 3, p2 desirability: 2
      // avg = (3 + 2) / 2 = 2.5
      expect(result.averages.desirabilityScore).toBe(2.5);
    });
  });
});

describe("fairnessColor", () => {
  it("returns red for high overwork", () => {
    expect(fairnessColor(2.0)).toBe("#ef4444");
  });

  it("returns orange for medium overwork", () => {
    expect(fairnessColor(1.0)).toBe("#f97316");
  });

  it("returns yellow for slight overwork", () => {
    expect(fairnessColor(0.5)).toBe("#eab308");
  });

  it("returns gray for balanced", () => {
    expect(fairnessColor(0.1)).toBe("#6b7280");
  });

  it("returns green for very light", () => {
    expect(fairnessColor(-2.0)).toBe("#22c55e");
  });

  it("returns blue for moderately light", () => {
    expect(fairnessColor(-1.0)).toBe("#3b82f6");
  });

  it("returns indigo for slightly light", () => {
    expect(fairnessColor(-0.5)).toBe("#6366f1");
  });
});

describe("heatmapTempColor", () => {
  it("ramps yellow (hue 60) → red (hue 0) at full saturation as burden rises", () => {
    // default thresholds: high = 1.5, so the ramp saturates at ±1.5
    expect(heatmapTempColor(-1.5)).toBe("hsl(60 100% 50%)"); // cold end — yellow
    expect(heatmapTempColor(0.0)).toBe("hsl(30 100% 50%)"); // midpoint — orange
    expect(heatmapTempColor(1.5)).toBe("hsl(0 100% 50%)"); // hot end — red
  });

  it("clamps beyond ±high to the endpoints", () => {
    expect(heatmapTempColor(-5.0)).toBe("hsl(60 100% 50%)");
    expect(heatmapTempColor(5.0)).toBe("hsl(0 100% 50%)");
  });

  it("stays full-saturation/50%-lightness with hue in [0, 60] across the range", () => {
    for (const d of [-1.5, -0.5, 0, 0.5, 1.5]) {
      const c = heatmapTempColor(d);
      const hue = Number(/^hsl\((\d+) 100% 50%\)$/.exec(c)?.[1]);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThanOrEqual(60);
    }
  });
});

describe("fairnessLabel", () => {
  it("returns 'Overworked' for high burden", () => {
    expect(fairnessLabel(2.0)).toBe("Overworked");
  });

  it("returns 'Heavy' for medium burden", () => {
    expect(fairnessLabel(1.0)).toBe("Heavy");
  });

  it("returns 'Slightly Heavy' for low burden", () => {
    expect(fairnessLabel(0.5)).toBe("Slightly Heavy");
  });

  it("returns 'Balanced' for near-zero", () => {
    expect(fairnessLabel(0.1)).toBe("Balanced");
  });

  it("returns 'Light' for very negative", () => {
    expect(fairnessLabel(-2.0)).toBe("Light");
  });

  it("returns 'Below avg' for moderately negative", () => {
    expect(fairnessLabel(-1.0)).toBe("Below avg");
  });

  it("returns 'Slightly Light' for slightly negative", () => {
    expect(fairnessLabel(-0.5)).toBe("Slightly Light");
  });
});
