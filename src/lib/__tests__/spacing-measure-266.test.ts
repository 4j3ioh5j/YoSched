// Card #266: the spacing measure. Each cell is its own unit, except days of one engine group
// (a weekend pair, a holiday group), which count as one unit spanning its days.
import { describe, it, expect } from "vitest";
import { spacingUnits, spacingPenalty, mostUnits } from "../spacing-measure";

const R = 14; // radius
const cell = (date: string, group: string | null = null) => ({ date, group });
const W = { from: "2027-02-01", to: "2027-02-28" };

describe("spacing measure (card #266)", () => {
  it("two separate cells 1 day apart score the maximum (consolidating is not rewarded)", () => {
    const u = spacingUnits([cell("2027-02-10"), cell("2027-02-11")]);
    expect(u).toEqual([{ start: "2027-02-10", end: "2027-02-10" }, { start: "2027-02-11", end: "2027-02-11" }]);
    expect(spacingPenalty(u, R, W.from, W.to)).toBe(R ** 2);
  });
  it("a weekend pair is one unit: no penalty inside it; the gap runs from its last day", () => {
    const u = spacingUnits([cell("2027-02-13", "wk1"), cell("2027-02-14", "wk1"), cell("2027-02-17")]);
    expect(u).toEqual([{ start: "2027-02-13", end: "2027-02-14" }, { start: "2027-02-17", end: "2027-02-17" }]);
    expect(spacingPenalty(u, R, W.from, W.to)).toBe((R + 1 - 3) ** 2);
    expect(spacingPenalty(spacingUnits([cell("2027-02-13", "wk1"), cell("2027-02-14", "wk1")]), R, W.from, W.to)).toBe(0);
  });
  it("wider is lower; beyond the radius is 0", () => {
    const at = (gap: number) => spacingPenalty(spacingUnits([cell("2027-02-01"), cell(`2027-02-${String(1 + gap).padStart(2, "0")}`)]), R, W.from, W.to);
    for (let g = 1; g < R; g++) expect(at(g)).toBeGreaterThan(at(g + 1));
    expect(at(R)).toBe(1);
    expect(at(R + 1)).toBe(0);
  });
  it("sums every pair within the radius, not only neighbours", () => {
    const u = spacingUnits([cell("2027-02-01"), cell("2027-02-05"), cell("2027-02-09")]);
    expect(spacingPenalty(u, R, W.from, W.to)).toBe((R + 1 - 4) ** 2 * 2 + (R + 1 - 8) ** 2);
  });
  it("context outside the window counts against a unit inside it; pairs wholly outside are excluded", () => {
    const u = spacingUnits([cell("2027-01-20"), cell("2027-01-25"), cell("2027-02-02")]);
    // 01-20↔01-25 both outside: excluded. 01-25↔02-02 (8) and 01-20↔02-02 (13) count.
    expect(spacingPenalty(u, R, W.from, W.to)).toBe((R + 1 - 8) ** 2 + (R + 1 - 13) ** 2);
  });
  it("cells are sorted and the same date given twice is one cell", () => {
    expect(spacingUnits([cell("2027-02-09"), cell("2027-02-01"), cell("2027-02-09")])).toEqual([{ start: "2027-02-01", end: "2027-02-01" }, { start: "2027-02-09", end: "2027-02-09" }]);
  });
  it("mostUnits counts units in [from − radius, to + radius]", () => {
    const byPerson = new Map([
      ["a", spacingUnits([cell("2027-01-29"), cell("2027-02-03")])], // the history cell is within the radius: 2
      ["b", spacingUnits([cell("2027-01-01"), cell("2027-02-03")])], // the history cell is too far back: 1
    ]);
    expect(mostUnits(byPerson, R, W.from, W.to)).toBe(2);
    expect(mostUnits(new Map([["b", byPerson.get("b")!]]), R, W.from, W.to)).toBe(1);
  });
  it("radius 0 or less scores nothing", () => {
    expect(spacingPenalty(spacingUnits([cell("2027-02-01"), cell("2027-02-02")]), 0, W.from, W.to)).toBe(0);
  });
});
