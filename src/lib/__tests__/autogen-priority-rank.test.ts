import { describe, it, expect } from "vitest";
import { buildRankFromConfig, DEFAULT_FACTOR_ORDER, type AutoGenFactorConfig } from "../auto-scheduler";

// Objective factor-order config (#252; split into independent keys in Slice 2a, #376).
// buildRankFromConfig must reorder the lexicographic rank vector to match an admin-
// configured order, and fall back to the hardcoded DEFAULT_FACTOR_ORDER for any absent/
// malformed config so default scheduling output is never silently altered.

// Distinct term values so a reorder is observable in the output vector. Keyed by the
// six Slice-2a factors (was the two aggregates coverageAndHardLimits / ppHours).
const TERMS = { hardLimits: 10, coverage: 20, overHours: 30, underHours: 40, requests: 50, fairness: 60 };
const DEFAULT_RANK = [10, 20, 30, 40, 50, 60];

const cfg = (key: string, sortOrder: number, enabled = true): AutoGenFactorConfig => ({ key, sortOrder, enabled });
// All six known factors, enabled, in the given key order.
const fullConfig = (keys: readonly string[]): AutoGenFactorConfig[] =>
  keys.map((k, i) => cfg(k, i));

describe("buildRankFromConfig", () => {
  it("DEFAULT_FACTOR_ORDER protects hard caps and ranks coverage above both hour terms", () => {
    expect(DEFAULT_FACTOR_ORDER).toEqual([
      "hardLimits",
      "coverage",
      "overHours",
      "underHours",
      "requests",
      "fairness",
    ]);
    // The split is the point: coverage sits above BOTH hour terms (8/4 fix on by
    // default) while hardLimits stays above coverage (hard caps protected by default).
    const order = DEFAULT_FACTOR_ORDER as readonly string[];
    expect(order.indexOf("coverage")).toBeLessThan(order.indexOf("overHours"));
    expect(order.indexOf("coverage")).toBeLessThan(order.indexOf("underHours"));
    expect(order.indexOf("hardLimits")).toBeLessThan(order.indexOf("coverage"));
  });

  it("absent config → canonical order (default-output parity)", () => {
    expect(buildRankFromConfig(TERMS, undefined)).toEqual(DEFAULT_RANK);
  });

  it("empty config → canonical order", () => {
    expect(buildRankFromConfig(TERMS, [])).toEqual(DEFAULT_RANK);
  });

  it("valid config in default order → identical to canonical", () => {
    expect(buildRankFromConfig(TERMS, fullConfig(DEFAULT_FACTOR_ORDER))).toEqual(DEFAULT_RANK);
  });

  it("honors sortOrder regardless of array position", () => {
    // Same factors, scrambled array order but sortOrder still encodes the default → default rank.
    const scrambled = [
      cfg("fairness", 5),
      cfg("hardLimits", 0),
      cfg("requests", 4),
      cfg("overHours", 2),
      cfg("coverage", 1),
      cfg("underHours", 3),
    ];
    expect(buildRankFromConfig(TERMS, scrambled)).toEqual(DEFAULT_RANK);
  });

  it("coverage ranked above hardLimits → coverage leads the vector (the Option-B trade)", () => {
    const coverageFirst = fullConfig(["coverage", "hardLimits", "overHours", "underHours", "requests", "fairness"]);
    expect(buildRankFromConfig(TERMS, coverageFirst)).toEqual([20, 10, 30, 40, 50, 60]);
  });

  it("reordered config → reordered rank vector", () => {
    const reordered = fullConfig(["fairness", "underHours", "overHours", "requests", "coverage", "hardLimits"]);
    expect(buildRankFromConfig(TERMS, reordered)).toEqual([60, 40, 30, 50, 20, 10]);
  });

  it("a single swap of two adjacent factors → that swap reflected", () => {
    const swapped = fullConfig(["coverage", "hardLimits", "overHours", "underHours", "requests", "fairness"]);
    expect(buildRankFromConfig(TERMS, swapped)).toEqual([20, 10, 30, 40, 50, 60]);
  });

  it("missing a known factor → fallback to canonical", () => {
    const missing = fullConfig(["hardLimits", "coverage", "overHours", "underHours", "requests"]); // no fairness
    expect(buildRankFromConfig(TERMS, missing)).toEqual(DEFAULT_RANK);
  });

  it("a disabled known factor → fallback to canonical (no factor silently demoted)", () => {
    const disabled = [
      cfg("hardLimits", 0),
      cfg("coverage", 1, false),
      cfg("overHours", 2),
      cfg("underHours", 3),
      cfg("requests", 4),
      cfg("fairness", 5),
    ];
    expect(buildRankFromConfig(TERMS, disabled)).toEqual(DEFAULT_RANK);
  });

  it("an unknown key (even alongside all known) → fallback", () => {
    const extra = [...fullConfig(DEFAULT_FACTOR_ORDER), cfg("bogus", 6)];
    expect(buildRankFromConfig(TERMS, extra)).toEqual(DEFAULT_RANK);
  });

  it("unknown key alongside a REORDERED known set → fallback, NOT a silent reorder (Codex #1761)", () => {
    // The known factors are reordered (fairness first). A naive filter-then-validate
    // would drop `bogus`, see all six known present, and honor the reorder. The
    // contract requires a full fallback instead.
    const reorderedPlusUnknown = [
      cfg("fairness", 0),
      cfg("coverage", 1),
      cfg("overHours", 2),
      cfg("underHours", 3),
      cfg("requests", 4),
      cfg("hardLimits", 5),
      cfg("bogus", 6),
    ];
    expect(buildRankFromConfig(TERMS, reorderedPlusUnknown)).toEqual(DEFAULT_RANK);
  });

  it("an unknown key REPLACING a known one → fallback", () => {
    const replaced = [
      cfg("bogus", 0),
      cfg("coverage", 1),
      cfg("overHours", 2),
      cfg("underHours", 3),
      cfg("requests", 4),
      cfg("fairness", 5),
    ];
    expect(buildRankFromConfig(TERMS, replaced)).toEqual(DEFAULT_RANK);
  });

  it("duplicate key → fallback (defensive; DB unique constraint prevents this)", () => {
    const dup = [
      cfg("hardLimits", 0),
      cfg("hardLimits", 1),
      cfg("overHours", 2),
      cfg("underHours", 3),
      cfg("requests", 4),
      cfg("fairness", 5),
    ];
    expect(buildRankFromConfig(TERMS, dup)).toHaveLength(DEFAULT_FACTOR_ORDER.length);
    expect(buildRankFromConfig(TERMS, dup)).toEqual(DEFAULT_RANK);
  });
});
