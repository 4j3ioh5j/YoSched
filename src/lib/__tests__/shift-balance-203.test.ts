import { describe, it, expect } from "vitest";
import { tallyBalances, sharesOf, spreadPenalty, spreadChange, payPeriodsCovering, holdsSlot, addDays, dayGap, SPREAD_RADIUS } from "../shift-balance";

// Card #203: the counting rule itself (pure, cell-derived).

const cells = (m: Record<string, string>) => (id: string, d: string) => m[`${id}:${d}`];

describe("slots (card #203)", () => {
  it("a weekend pair held by one person is one slot; a lone Sunday is its own", () => {
    // Sat 2025-06-07, Sun 2025-06-08.
    const c = cells({ "a:2025-06-07": "call", "a:2025-06-08": "call", "b:2025-06-15": "call" });
    expect(holdsSlot(c, "a", "call", true, "2025-06-07")).toBe(true);
    expect(holdsSlot(c, "a", "call", true, "2025-06-08")).toBe(false);
    expect(holdsSlot(c, "b", "call", true, "2025-06-15")).toBe(true);
    // Not weekend-paired: each day counts.
    expect(holdsSlot(c, "a", "call", false, "2025-06-08")).toBe(true);
  });

  it("got and expected: each slot is owed to the people able that day by weight", () => {
    const c = cells({ "a:2025-06-02": "call", "a:2025-06-03": "call", "b:2025-06-04": "call" });
    const t = tallyBalances({
      shiftTypeId: "call", weekendPaired: false, staffIds: ["a", "b"],
      dates: ["2025-06-02", "2025-06-03", "2025-06-04"], cellAt: c,
      // b is away on the 3rd: that slot is a's alone.
      shareOn: (d) => (d === "2025-06-03" ? new Map([["a", 1]]) : new Map([["a", 0.5], ["b", 0.5]])),
    });
    expect(t.get("a")).toEqual({ got: 2, expected: 2 });
    expect(t.get("b")).toEqual({ got: 1, expected: 1 });
  });

  it("shares follow FTE weight; an all-zero pool shares equally (never 0/0)", () => {
    expect(sharesOf([{ id: "a", weight: 1 }, { id: "b", weight: 0.5 }])).toEqual(new Map([["a", 2 / 3], ["b", 1 / 3]]));
    expect(sharesOf([{ id: "a", weight: 0 }, { id: "b", weight: 0 }])).toEqual(new Map([["a", 0.5], ["b", 0.5]]));
    expect(sharesOf([])).toEqual(new Map());
  });
});

describe("spread penalty (card #203)", () => {
  const at = (days: string[]) => (d: string) => days.includes(d);
  it("further is always better, up to two weeks either side", () => {
    const d = "2025-06-15";
    const near = spreadPenalty(at([addDays(d, -6)]), d);
    const far = spreadPenalty(at([addDays(d, -10)]), d);
    expect(far).toBeLessThan(near); // 6 days scored like 14 under the old ±3-day rule
    expect(spreadPenalty(at([addDays(d, -SPREAD_RADIUS - 1)]), d)).toBe(0);
    expect(spreadPenalty(at([addDays(d, SPREAD_RADIUS)]), d)).toBe(1);
    expect(spreadPenalty(at([d]), d)).toBe(0); // the day itself never counts
  });
  it("date helpers cross month ends", () => {
    expect(addDays("2025-05-30", 3)).toBe("2025-06-02");
    expect(dayGap("2025-05-30", "2025-06-02")).toBe(3);
  });
});

describe("review r1 regressions (card #203)", () => {
  it("spacing change scores the whole proposed state", () => {
    const only = (days: string[]) => (d: string) => days.includes(d);
    // Moving someone's only marked shift: nothing to bunch, before or after.
    expect(spreadChange(only(["2025-06-10"]), new Map([["2025-06-10", false], ["2025-06-12", true]]))).toBe(0);
    // Moving it next to another one bunches them; moving it away un-bunches them.
    expect(spreadChange(only(["2025-06-01", "2025-06-20"]), new Map([["2025-06-20", false], ["2025-06-03", true]]))).toBeGreaterThan(0);
    expect(spreadChange(only(["2025-06-01", "2025-06-03"]), new Map([["2025-06-03", false], ["2025-06-20", true]]))).toBeLessThan(0);
    expect(spreadChange(only([]), new Map())).toBe(0);
  });

  it("pay periods are extended back to the start date after the stored list rolls forward", () => {
    const stored = [{ startDate: "2027-01-17", endDate: "2027-01-30" }, { startDate: "2027-01-03", endDate: "2027-01-16" }];
    expect(payPeriodsCovering(stored, "2026-12-10", 14)).toEqual([
      { startDate: "2026-12-06", endDate: "2026-12-19" },
      { startDate: "2026-12-20", endDate: "2027-01-02" },
      { startDate: "2027-01-03", endDate: "2027-01-16" },
      { startDate: "2027-01-17", endDate: "2027-01-30" },
    ]);
    expect(payPeriodsCovering(stored, "2027-01-03", 14)).toHaveLength(2);
    expect(payPeriodsCovering([], "2027-01-03", 14)).toEqual([]);
  });
});
