import { describe, it, expect } from "vitest";
import { DEFAULT_SPEC, encodeSpec, decodeSpec, type GraphSpec } from "../spec";

describe("encodeSpec / decodeSpec", () => {
  it("round-trips the default spec", () => {
    expect(decodeSpec(encodeSpec(DEFAULT_SPEC))).toEqual(DEFAULT_SPEC);
  });

  it("round-trips a fully-populated spec", () => {
    const spec: GraphSpec = {
      version: 1,
      dateRange: { kind: "payPeriods", payPeriodIds: ["pp1", "pp2"] },
      staff: { all: false, names: ["a", "b"], employmentType: "Fee Basis", minFtePct: 0.5 },
      metric: "hours",
      groupByShiftCode: false,
      chart: "heatmap",
      normalize: "fte",
      weighting: "opportunity",
      timeBucket: "month",
    };
    expect(decodeSpec(encodeSpec(spec))).toEqual(spec);
  });

  it("returns null for non-JSON input", () => {
    expect(decodeSpec("not%20json")).toBeNull();
  });

  it("returns null for a JSON array (not an object)", () => {
    expect(decodeSpec(encodeURIComponent("[1,2,3]"))).toBeNull();
  });

  it("coerces unknown enum values back to the defaults", () => {
    const raw = encodeURIComponent(JSON.stringify({
      version: 1,
      metric: "bogus",
      chart: "spiral",
      normalize: "weird",
      weighting: "nope",
    }));
    const decoded = decodeSpec(raw)!;
    expect(decoded.metric).toBe(DEFAULT_SPEC.metric);
    expect(decoded.chart).toBe(DEFAULT_SPEC.chart);
    expect(decoded.normalize).toBe("raw");
    expect(decoded.weighting).toBe("none");
  });

  it("falls back to the default date range when malformed", () => {
    const raw = encodeURIComponent(JSON.stringify({ version: 1, dateRange: { kind: "custom", start: 5 } }));
    expect(decodeSpec(raw)!.dateRange).toEqual(DEFAULT_SPEC.dateRange);
  });

  it("drops non-string entries from names and payPeriodIds", () => {
    const raw = encodeURIComponent(JSON.stringify({
      version: 1,
      dateRange: { kind: "payPeriods", payPeriodIds: ["pp1", 7, null] },
      staff: { names: ["a", 3, "b"] },
    }));
    const decoded = decodeSpec(raw)!;
    expect(decoded.dateRange).toEqual({ kind: "payPeriods", payPeriodIds: ["pp1"] });
    expect(decoded.staff.names).toEqual(["a", "b"]);
  });

  it("defaults groupByShiftCode from DEFAULT_SPEC when the URL omits it", () => {
    const raw = encodeURIComponent(JSON.stringify({ version: 1, metric: "hours" }));
    expect(decodeSpec(raw)!.groupByShiftCode).toBe(DEFAULT_SPEC.groupByShiftCode);
  });

  it("preserves an explicit groupByShiftCode: false", () => {
    const raw = encodeURIComponent(JSON.stringify({ version: 1, groupByShiftCode: false }));
    expect(decodeSpec(raw)!.groupByShiftCode).toBe(false);
  });

  it("preserves employmentType: null and minFtePct: null", () => {
    const raw = encodeURIComponent(JSON.stringify({
      version: 1,
      staff: { employmentType: null, minFtePct: null },
    }));
    const decoded = decodeSpec(raw)!;
    expect(decoded.staff.employmentType).toBeNull();
    expect(decoded.staff.minFtePct).toBeNull();
  });
});
