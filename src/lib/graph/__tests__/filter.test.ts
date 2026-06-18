import { describe, it, expect } from "vitest";
import { filterByMinFte, filterAssignmentsByDate, filterStaff, type PayPeriodRef } from "../filter";
import type { GraphDateRange, GraphStaffFilter } from "../spec";

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

describe("filterAssignmentsByDate", () => {
  const a = (date: string) => ({ date });
  const rows = [a("2026-01-05"), a("2026-01-20"), a("2026-02-10"), a("2026-03-01")];
  const multiYearRows = [a("2024-06-01"), a("2025-03-15"), a("2026-01-05"), a("2026-12-31")];
  const payPeriods: PayPeriodRef[] = [
    { id: "pp1", startDate: "2026-01-01", endDate: "2026-01-14" },
    { id: "pp2", startDate: "2026-01-15", endDate: "2026-01-31" },
    { id: "pp3", startDate: "2026-02-01", endDate: "2026-02-28" },
  ];

  it("returns all rows (same ref) for the empty custom range", () => {
    const range: GraphDateRange = { kind: "custom", start: "", end: "" };
    expect(filterAssignmentsByDate(rows, range, payPeriods)).toBe(rows);
  });

  it("applies an inclusive custom [start, end]", () => {
    const range: GraphDateRange = { kind: "custom", start: "2026-01-05", end: "2026-02-10" };
    expect(filterAssignmentsByDate(rows, range, payPeriods).map((r) => r.date)).toEqual([
      "2026-01-05", "2026-01-20", "2026-02-10",
    ]);
  });

  it("honors an open-ended custom range (only start)", () => {
    const range: GraphDateRange = { kind: "custom", start: "2026-02-01", end: "" };
    expect(filterAssignmentsByDate(rows, range, payPeriods).map((r) => r.date)).toEqual([
      "2026-02-10", "2026-03-01",
    ]);
  });

  it("keeps rows inside any selected pay period (non-contiguous)", () => {
    const range: GraphDateRange = { kind: "payPeriods", payPeriodIds: ["pp1", "pp3"] };
    expect(filterAssignmentsByDate(rows, range, payPeriods).map((r) => r.date)).toEqual([
      "2026-01-05", "2026-02-10",
    ]);
  });

  it("treats an empty pay-period selection as a no-op (all rows)", () => {
    const range: GraphDateRange = { kind: "payPeriods", payPeriodIds: [] };
    expect(filterAssignmentsByDate(rows, range, payPeriods)).toBe(rows);
  });

  it("treats unknown pay-period ids as a no-op (all rows)", () => {
    const range: GraphDateRange = { kind: "payPeriods", payPeriodIds: ["nope"] };
    expect(filterAssignmentsByDate(rows, range, payPeriods)).toBe(rows);
  });

  it("keeps only rows in a single selected year", () => {
    const range: GraphDateRange = { kind: "years", years: [2026] };
    expect(filterAssignmentsByDate(multiYearRows, range, payPeriods).map((r) => r.date)).toEqual([
      "2026-01-05", "2026-12-31",
    ]);
  });

  it("unions multiple selected years (non-contiguous)", () => {
    const range: GraphDateRange = { kind: "years", years: [2024, 2026] };
    expect(filterAssignmentsByDate(multiYearRows, range, payPeriods).map((r) => r.date)).toEqual([
      "2024-06-01", "2026-01-05", "2026-12-31",
    ]);
  });

  it("treats an empty year selection as a no-op (all rows)", () => {
    const range: GraphDateRange = { kind: "years", years: [] };
    expect(filterAssignmentsByDate(multiYearRows, range, payPeriods)).toBe(multiYearRows);
  });

  it("returns nothing for a year not present in the data", () => {
    const range: GraphDateRange = { kind: "years", years: [2099] };
    expect(filterAssignmentsByDate(multiYearRows, range, payPeriods)).toEqual([]);
  });
});

describe("filterStaff", () => {
  const s = (staffId: string, employmentTypeName: string, ftePercentage: number) =>
    ({ staffId, employmentTypeName, ftePercentage });
  const rows = [
    s("a", "FTE", 1.0),
    s("b", "FTE", 0.5),
    s("c", "Fee Basis", 0.25),
    s("d", "Fee Basis", 1.0),
  ];

  it("is a no-op (same ref) for an empty filter", () => {
    expect(filterStaff(rows, {})).toBe(rows);
    expect(filterStaff(rows, { all: true })).toBe(rows);
  });

  it("filters by explicit staff names", () => {
    expect(filterStaff(rows, { names: ["a", "c"] }).map((r) => r.staffId)).toEqual(["a", "c"]);
  });

  it("ignores an empty names array", () => {
    expect(filterStaff(rows, { names: [] })).toBe(rows);
  });

  it("filters by employment type", () => {
    expect(filterStaff(rows, { employmentType: "Fee Basis" }).map((r) => r.staffId)).toEqual(["c", "d"]);
  });

  it("composes type AND minFte (the plan's example)", () => {
    const f: GraphStaffFilter = { employmentType: "Fee Basis", minFtePct: 0.5 };
    expect(filterStaff(rows, f).map((r) => r.staffId)).toEqual(["d"]);
  });

  it("composes names AND type AND minFte", () => {
    const f: GraphStaffFilter = { names: ["a", "b", "c"], employmentType: "FTE", minFtePct: 0.6 };
    expect(filterStaff(rows, f).map((r) => r.staffId)).toEqual(["a"]);
  });
});
