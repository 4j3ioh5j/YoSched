import { describe, it, expect } from "vitest";
import { buildRankFromConfig, DEFAULT_FACTOR_ORDER, type AutoGenFactorConfig } from "../auto-scheduler";

// Objective factor-order config (#252, Slice 1). buildRankFromConfig must reorder the
// lexicographic rank vector to match an admin-configured order, and fall back to the
// hardcoded DEFAULT_FACTOR_ORDER for any absent/malformed config so default scheduling
// output is never silently altered. (Codex #1752 review checklist.)

// Distinct term values so a reorder is observable in the output vector.
const TERMS = { coverageAndHardLimits: 10, ppHours: 20, requests: 30, fairness: 40 };
const DEFAULT_RANK = [10, 20, 30, 40];

const cfg = (key: string, sortOrder: number, enabled = true): AutoGenFactorConfig => ({ key, sortOrder, enabled });
// All four known factors, enabled, in the given key order.
const fullConfig = (keys: readonly string[]): AutoGenFactorConfig[] =>
  keys.map((k, i) => cfg(k, i));

describe("buildRankFromConfig", () => {
  it("DEFAULT_FACTOR_ORDER is the four current aggregate tiers in order", () => {
    expect(DEFAULT_FACTOR_ORDER).toEqual(["coverageAndHardLimits", "ppHours", "requests", "fairness"]);
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
    const scrambled = [cfg("fairness", 3), cfg("coverageAndHardLimits", 0), cfg("requests", 2), cfg("ppHours", 1)];
    expect(buildRankFromConfig(TERMS, scrambled)).toEqual(DEFAULT_RANK);
  });

  it("reordered config → reordered rank vector", () => {
    // fairness first, then ppHours, requests, coverage.
    const reordered = fullConfig(["fairness", "ppHours", "requests", "coverageAndHardLimits"]);
    expect(buildRankFromConfig(TERMS, reordered)).toEqual([40, 20, 30, 10]);
  });

  it("a single swap of two adjacent factors → that swap reflected", () => {
    const swapped = fullConfig(["coverageAndHardLimits", "requests", "ppHours", "fairness"]);
    expect(buildRankFromConfig(TERMS, swapped)).toEqual([10, 30, 20, 40]);
  });

  it("missing a known factor → fallback to canonical", () => {
    const missing = fullConfig(["coverageAndHardLimits", "ppHours", "requests"]); // no fairness
    expect(buildRankFromConfig(TERMS, missing)).toEqual(DEFAULT_RANK);
  });

  it("a disabled known factor → fallback to canonical (coverage never silently demoted)", () => {
    const disabled = [cfg("coverageAndHardLimits", 0, false), cfg("ppHours", 1), cfg("requests", 2), cfg("fairness", 3)];
    expect(buildRankFromConfig(TERMS, disabled)).toEqual(DEFAULT_RANK);
  });

  it("an unknown key (even alongside all known) → fallback", () => {
    const extra = [...fullConfig(DEFAULT_FACTOR_ORDER), cfg("bogus", 4)];
    expect(buildRankFromConfig(TERMS, extra)).toEqual(DEFAULT_RANK);
  });

  it("duplicate key → fallback (defensive; DB unique constraint prevents this)", () => {
    const dup = [cfg("coverageAndHardLimits", 0), cfg("coverageAndHardLimits", 1), cfg("ppHours", 2), cfg("requests", 3)];
    expect(buildRankFromConfig(TERMS, dup)).toHaveLength(DEFAULT_FACTOR_ORDER.length);
    expect(buildRankFromConfig(TERMS, dup)).toEqual(DEFAULT_RANK);
  });
});
