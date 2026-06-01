import { describe, it, expect } from "vitest";
import { buildBuckets } from "../buckets";
import type { PayPeriodRef } from "../filter";

const payPeriods: PayPeriodRef[] = [
  { id: "pp1", startDate: "2026-01-01", endDate: "2026-01-14" },
  { id: "pp2", startDate: "2026-01-15", endDate: "2026-01-31" },
  { id: "pp3", startDate: "2026-02-01", endDate: "2026-02-28" },
  { id: "pp4", startDate: "2026-03-01", endDate: "2026-03-14" },
];

describe("buildBuckets — month", () => {
  it("emits one ordered bucket per distinct month present", () => {
    const dates = ["2026-02-10", "2026-01-05", "2026-01-20", "2026-03-01"];
    expect(buildBuckets(dates, "month", payPeriods)).toEqual([
      { key: "2026-01", label: "Jan 2026", start: "2026-01-01", end: "2026-01-31" },
      { key: "2026-02", label: "Feb 2026", start: "2026-02-01", end: "2026-02-31" },
      { key: "2026-03", label: "Mar 2026", start: "2026-03-01", end: "2026-03-31" },
    ]);
  });

  it("returns [] for no dates", () => {
    expect(buildBuckets([], "month", payPeriods)).toEqual([]);
  });
});

describe("buildBuckets — payPeriod", () => {
  it("includes only pay periods overlapping the date span, sorted by start", () => {
    const dates = ["2026-01-20", "2026-02-10"]; // spans pp2..pp3
    expect(buildBuckets(dates, "payPeriod", payPeriods).map((b) => b.key)).toEqual(["pp2", "pp3"]);
  });

  it("carries the pay period's bounds and a compact label", () => {
    const dates = ["2026-01-05"];
    expect(buildBuckets(dates, "payPeriod", payPeriods)).toEqual([
      { key: "pp1", label: "1/1–1/14", start: "2026-01-01", end: "2026-01-14" },
    ]);
  });

  it("returns [] for no dates", () => {
    expect(buildBuckets([], "payPeriod", payPeriods)).toEqual([]);
  });
});
