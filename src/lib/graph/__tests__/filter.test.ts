import { describe, it, expect } from "vitest";
import { filterByMinFte } from "../filter";

const p = (initials: string, ftePercentage: number) => ({ initials, ftePercentage });

describe("filterByMinFte", () => {
  const rows = [p("AA", 1.0), p("BB", 0.5), p("CC", 0.25)];

  it("is a no-op when minFte is 0", () => {
    expect(filterByMinFte(rows, 0)).toBe(rows);
  });

  it("is a no-op for negative minFte", () => {
    expect(filterByMinFte(rows, -1)).toBe(rows);
  });

  it("keeps rows at or above the threshold (inclusive)", () => {
    expect(filterByMinFte(rows, 0.5).map((r) => r.initials)).toEqual(["AA", "BB"]);
  });

  it("excludes everyone when the threshold is above all", () => {
    expect(filterByMinFte(rows, 2)).toEqual([]);
  });

  it("does not mutate the input", () => {
    filterByMinFte(rows, 0.5);
    expect(rows.map((r) => r.initials)).toEqual(["AA", "BB", "CC"]);
  });
});
