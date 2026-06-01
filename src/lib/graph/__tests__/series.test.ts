import { describe, it, expect } from "vitest";
import { shapeBarSeries, type BarSeriesInput } from "../series";

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
