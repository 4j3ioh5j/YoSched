import { describe, it, expect } from "vitest";
import { DEFAULT_SPEC, encodeSpec, decodeSpec, coerceSpec, hasLegacyEmploymentTypeName, type GraphSpec } from "../spec";

describe("encodeSpec / decodeSpec", () => {
  it("round-trips the default spec", () => {
    expect(decodeSpec(encodeSpec(DEFAULT_SPEC))).toEqual(DEFAULT_SPEC);
  });

  it("round-trips a fully-populated spec", () => {
    const spec: GraphSpec = {
      version: 1,
      dateRange: { kind: "payPeriods", payPeriodIds: ["pp1", "pp2"] },
      staff: { all: false, names: ["a", "b"], employmentTypeId: "et-fee", minFtePct: 0.5 },
      metric: "hours",
      groupByShiftCode: false,
      chart: "heatmap",
      normalize: "fte",
      weighting: "opportunity",
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

  it("round-trips a years date range", () => {
    const spec: GraphSpec = { ...DEFAULT_SPEC, dateRange: { kind: "years", years: [2026, 2025] } };
    expect(decodeSpec(encodeSpec(spec))).toEqual(spec);
  });

  it("drops non-integer entries from a years date range", () => {
    const raw = encodeURIComponent(JSON.stringify({
      version: 1,
      dateRange: { kind: "years", years: [2026, "2025", 2024.5, null] },
    }));
    expect(decodeSpec(raw)!.dateRange).toEqual({ kind: "years", years: [2026] });
  });

  it("defaults groupByShiftCode from DEFAULT_SPEC when the URL omits it", () => {
    const raw = encodeURIComponent(JSON.stringify({ version: 1, metric: "hours" }));
    expect(decodeSpec(raw)!.groupByShiftCode).toBe(DEFAULT_SPEC.groupByShiftCode);
  });

  it("preserves an explicit groupByShiftCode: false", () => {
    const raw = encodeURIComponent(JSON.stringify({ version: 1, groupByShiftCode: false }));
    expect(decodeSpec(raw)!.groupByShiftCode).toBe(false);
  });

  it("preserves employmentTypeId: null and minFtePct: null", () => {
    const raw = encodeURIComponent(JSON.stringify({
      version: 1,
      staff: { employmentTypeId: null, minFtePct: null },
    }));
    const decoded = decodeSpec(raw)!;
    expect(decoded.staff.employmentTypeId).toBeNull();
    expect(decoded.staff.minFtePct).toBeNull();
  });

  // Card #71: a pre-#71 spec filtered by the type's NAME. It is never resolved by name.
  it("drops a legacy employment-type name filter instead of resolving it", () => {
    const raw = encodeURIComponent(JSON.stringify({ version: 1, staff: { employmentType: "Fee Basis", minFtePct: 0.5 } }));
    const decoded = decodeSpec(raw)!;
    expect(decoded.staff.employmentTypeId).toBeUndefined();
    expect((decoded.staff as Record<string, unknown>).employmentType).toBeUndefined();
    expect(decoded.staff.minFtePct).toBe(0.5);
  });

  it("hasLegacyEmploymentTypeName flags only a non-empty legacy name key", () => {
    expect(hasLegacyEmploymentTypeName({ staff: { employmentType: "FTE" } })).toBe(true);
    expect(hasLegacyEmploymentTypeName({ staff: { employmentType: "" } })).toBe(false);
    expect(hasLegacyEmploymentTypeName({ staff: { employmentType: null } })).toBe(false);
    expect(hasLegacyEmploymentTypeName({ staff: { employmentTypeId: "et-1" } })).toBe(false);
    expect(hasLegacyEmploymentTypeName(undefined)).toBe(false);
    expect(hasLegacyEmploymentTypeName({ staff: "x" })).toBe(false);
  });
});

describe("coerceSpec (API trust boundary)", () => {
  it("returns a fresh default spec for non-object input", () => {
    expect(coerceSpec(null)).toEqual(DEFAULT_SPEC);
    expect(coerceSpec(undefined)).toEqual(DEFAULT_SPEC);
    expect(coerceSpec("nope")).toEqual(DEFAULT_SPEC);
    expect(coerceSpec(42)).toEqual(DEFAULT_SPEC);
    expect(coerceSpec([1, 2, 3])).toEqual(DEFAULT_SPEC);
  });

  it("never throws on hostile blobs and still returns a valid spec", () => {
    const blob = { metric: { nested: true }, chart: 99, staff: "x", dateRange: [] };
    const spec = coerceSpec(blob);
    expect(spec.version).toBe(1);
    expect(spec.metric).toBe(DEFAULT_SPEC.metric);
    expect(spec.chart).toBe(DEFAULT_SPEC.chart);
    expect(spec.staff).toEqual(DEFAULT_SPEC.staff);
    expect(spec.dateRange).toEqual(DEFAULT_SPEC.dateRange);
  });

  it("accepts an already-decoded object (round-trips through coerce)", () => {
    const spec: GraphSpec = {
      version: 1,
      dateRange: { kind: "custom", start: "2026-01-01", end: "2026-02-01" },
      staff: { all: true },
      metric: "shift:CALL",
      groupByShiftCode: true,
      chart: "bar",
      normalize: "fte",
      weighting: "opportunity",
    };
    expect(coerceSpec(spec)).toEqual(spec);
  });

  it("drops a stored version other than 1 and pins it to 1", () => {
    expect(coerceSpec({ version: 7, metric: "hours" }).version).toBe(1);
  });
});
