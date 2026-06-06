import { describe, it, expect } from "vitest";
import { shapeBarSeries, shapeHeatmap, shapeMetricBar, scalarMetricValue, shapePie, type BarSeriesInput, type HeatmapInput, type MetricRow, type PieInput } from "../series";

const row = (
  initials: string,
  shiftCounts: Record<string, number>,
  holidayWorkCount = 0,
  ftePercentage = 1,
): BarSeriesInput => ({ initials, holidayWorkCount, shiftCounts, ftePercentage });

describe("shapeBarSeries", () => {
  it("returns [] when no codes and holidays are excluded", () => {
    expect(shapeBarSeries([row("AB", { CALL: 3 })], [], false)).toEqual([]);
  });

  it("emits one row per provider, sorted by initials, with selected codes", () => {
    const data = [row("ZZ", { CALL: 2, ORC: 1 }), row("AA", { CALL: 5 })];
    expect(shapeBarSeries(data, ["CALL", "ORC"], false)).toEqual([
      { initials: "AA", CALL: 5, ORC: 0 },
      { initials: "ZZ", CALL: 2, ORC: 1 },
    ]);
  });

  it("defaults missing shift counts to 0", () => {
    expect(shapeBarSeries([row("AB", { CALL: 3 })], ["CALL", "ORL"], false)).toEqual([
      { initials: "AB", CALL: 3, ORL: 0 },
    ]);
  });

  it("includes a Holidays series before the codes when requested", () => {
    expect(shapeBarSeries([row("AB", { CALL: 3 }, 4)], ["CALL"], true)).toEqual([
      { initials: "AB", Holidays: 4, CALL: 3 },
    ]);
  });

  it("can emit just the Holidays series with no codes", () => {
    expect(shapeBarSeries([row("AB", {}, 2)], [], true)).toEqual([
      { initials: "AB", Holidays: 2 },
    ]);
  });

  it("does not mutate the input array order", () => {
    const data = [row("ZZ", {}), row("AA", {})];
    shapeBarSeries(data, [], true);
    expect(data.map((d) => d.initials)).toEqual(["ZZ", "AA"]);
  });

  it("leaves counts unchanged when perFte is omitted (default)", () => {
    expect(shapeBarSeries([row("AB", { CALL: 4 }, 0, 0.5)], ["CALL"], false)).toEqual([
      { initials: "AB", CALL: 4 },
    ]);
  });

  it("divides counts by FTE percentage when perFte is set", () => {
    const data = [row("AB", { CALL: 4 }, 2, 0.5), row("CD", { CALL: 3 }, 1, 1)];
    expect(shapeBarSeries(data, ["CALL"], true, true)).toEqual([
      { initials: "AB", Holidays: 4, CALL: 8 },
      { initials: "CD", Holidays: 1, CALL: 3 },
    ]);
  });

  it("treats an FTE of 0 as 1.0 (no divide-by-zero) under perFte", () => {
    expect(shapeBarSeries([row("AB", { CALL: 4 }, 0, 0)], ["CALL"], false, true)).toEqual([
      { initials: "AB", CALL: 4 },
    ]);
  });
});

const hRow = (
  initials: string,
  shiftCounts: Record<string, number>,
  plain: Record<string, number>,
  opp: Record<string, number>,
): HeatmapInput => ({
  initials,
  shiftCounts,
  displayDeviation: { perShift: plain },
  deviation: { perShift: opp },
});

describe("shapeHeatmap", () => {
  const rows = [
    hRow("ZZ", { CALL: 3, ORC: 1 }, { CALL: 0.5, ORC: -0.2 }, { CALL: 1.1, ORC: -0.9 }),
    hRow("AA", { CALL: 5 }, { CALL: -1.0 }, { CALL: -2.0 }),
  ];

  it("emits one row per provider, sorted by initials, one cell per code", () => {
    const out = shapeHeatmap(rows, ["CALL", "ORC"], false);
    expect(out.map((r) => r.initials)).toEqual(["AA", "ZZ"]);
    expect(out[0].cells.map((c) => c.code)).toEqual(["CALL", "ORC"]);
  });

  it("pairs raw counts with the plain deviation; missing counts/devs default to 0", () => {
    const out = shapeHeatmap(rows, ["CALL", "ORC"], false);
    const aa = out.find((r) => r.initials === "AA")!;
    expect(aa.cells).toEqual([
      { code: "CALL", count: 5, deviation: -1.0 },
      { code: "ORC", count: 0, deviation: 0 },
    ]);
  });

  it("uses opportunity-adjusted deviations when requested (counts unchanged)", () => {
    const zz = shapeHeatmap(rows, ["CALL", "ORC"], true).find((r) => r.initials === "ZZ")!;
    expect(zz.cells).toEqual([
      { code: "CALL", count: 3, deviation: 1.1 },
      { code: "ORC", count: 1, deviation: -0.9 },
    ]);
  });

  it("does not mutate the input array order", () => {
    shapeHeatmap(rows, ["CALL"], false);
    expect(rows.map((r) => r.initials)).toEqual(["ZZ", "AA"]);
  });

  it("appends a Holidays cell (count + holidayWork dev) when includeHolidays is set", () => {
    const hol: HeatmapInput[] = [
      {
        initials: "AB",
        shiftCounts: { CALL: 3 },
        holidayWorkCount: 2,
        displayDeviation: { perShift: { CALL: 0.4 }, holidayWork: 1.3 },
        deviation: { perShift: { CALL: 0.9 }, holidayWork: 2.1 },
      },
    ];
    expect(shapeHeatmap(hol, ["CALL"], false, true)[0].cells).toEqual([
      { code: "CALL", count: 3, deviation: 0.4 },
      { code: "Holidays", count: 2, deviation: 1.3 },
    ]);
    // opportunity-adjusted picks the opp holidayWork dev
    expect(shapeHeatmap(hol, ["CALL"], true, true)[0].cells[1]).toEqual({
      code: "Holidays",
      count: 2,
      deviation: 2.1,
    });
  });

  it("defaults missing holiday count/dev to 0 under includeHolidays", () => {
    const out = shapeHeatmap(rows, ["CALL"], false, true);
    expect(out[0].cells.at(-1)).toEqual({ code: "Holidays", count: 0, deviation: 0 });
  });
});

const mRow = (
  initials: string,
  opts: Partial<MetricRow> = {},
): MetricRow => ({
  initials,
  shiftCounts: {},
  holidayWorkCount: 0,
  totalHours: 0,
  ftePercentage: 1,
  deviation: { desirability: 0 },
  displayDeviation: { desirability: 0 },
  ...opts,
});

describe("scalarMetricValue", () => {
  const r = mRow("AB", {
    shiftCounts: { CALL: 4 },
    holidayWorkCount: 2,
    totalHours: 100,
    ftePercentage: 0.5,
    deviation: { desirability: 0.8 },
    displayDeviation: { desirability: 0.3 },
  });

  it("reads a specific shift code", () => {
    expect(scalarMetricValue(r, "shift:CALL")).toBe(4);
    expect(scalarMetricValue(r, "shift:ORC")).toBe(0);
  });

  it("divides count metrics by FTE under perFte", () => {
    expect(scalarMetricValue(r, "shift:CALL", { perFte: true })).toBe(8);
    expect(scalarMetricValue(r, "hours", { perFte: true })).toBe(200);
  });

  it("negates the desirability z-score and ignores perFte for it", () => {
    expect(scalarMetricValue(r, "desirability")).toBe(-0.3);
    expect(scalarMetricValue(r, "desirability", { perFte: true })).toBe(-0.3);
    expect(scalarMetricValue(r, "desirability", { opportunityAdjusted: true })).toBe(-0.8);
  });
});

describe("shapeMetricBar", () => {
  const rows = [
    mRow("ZZ", { totalHours: 100, holidayWorkCount: 2, shiftCounts: { CALL: 1 }, ftePercentage: 0.5 }),
    mRow("AA", { totalHours: 200, holidayWorkCount: 4, shiftCounts: { CALL: 3 }, ftePercentage: 1 }),
  ];

  it("emits {initials, value} per provider, sorted by initials, for hours", () => {
    expect(shapeMetricBar(rows, "hours")).toEqual([
      { initials: "AA", value: 200 },
      { initials: "ZZ", value: 100 },
    ]);
  });

  it("reads a specific shift code", () => {
    expect(shapeMetricBar(rows, "shift:CALL")).toEqual([
      { initials: "AA", value: 3 },
      { initials: "ZZ", value: 1 },
    ]);
  });

  it("divides by FTE under perFte (0-FTE treated as 1.0)", () => {
    const data = [
      mRow("AB", { totalHours: 100, ftePercentage: 0.5 }),
      mRow("CD", { totalHours: 90, ftePercentage: 0 }),
    ];
    expect(shapeMetricBar(data, "hours", { perFte: true })).toEqual([
      { initials: "AB", value: 200 },
      { initials: "CD", value: 90 },
    ]);
  });
});

const pRow = (
  initials: string,
  shiftCounts: Record<string, number>,
  totalHours = 0,
  holidayWorkCount = 0,
  ftePercentage = 1,
): PieInput => ({ initials, shiftCounts, totalHours, holidayWorkCount, ftePercentage });

describe("shapePie", () => {
  const rows = [
    pRow("AA", { CALL: 2, ORC: 1 }, 100, 1),
    pRow("BB", { CALL: 5 }, 200, 0),
    pRow("CC", {}, 0, 0),
  ];

  it("sums the given codes for shiftCount and sorts largest-first", () => {
    expect(shapePie(rows, "shiftCount", ["CALL", "ORC"])).toEqual([
      { initials: "BB", value: 5 },
      { initials: "AA", value: 3 },
    ]);
  });

  it("only counts the codes passed in", () => {
    expect(shapePie(rows, "shiftCount", ["CALL"])).toEqual([
      { initials: "BB", value: 5 },
      { initials: "AA", value: 2 },
    ]);
  });

  it("uses a single code's count for a shift:CODE metric (ignores `codes`)", () => {
    expect(shapePie(rows, "shift:ORC", [])).toEqual([{ initials: "AA", value: 1 }]);
  });

  it("uses the scalar total for hours and drops zero slices (CC)", () => {
    expect(shapePie(rows, "hours", [])).toEqual([
      { initials: "BB", value: 200 },
      { initials: "AA", value: 100 },
    ]);
  });

  it("drops zero slices for holidays (only AA has any)", () => {
    expect(shapePie(rows, "holidays", [])).toEqual([{ initials: "AA", value: 1 }]);
  });

  it("divides by FTE under perFte and re-sorts by the per-FTE value", () => {
    const data = [pRow("AA", {}, 100, 0, 1), pRow("BB", {}, 80, 0, 0.5)];
    // BB: 80/0.5 = 160 > AA: 100
    expect(shapePie(data, "hours", [], true)).toEqual([
      { initials: "BB", value: 160 },
      { initials: "AA", value: 100 },
    ]);
  });
});
