import { describe, it, expect } from "vitest";
import { validateFactorOrder } from "../autogen-factor-order";

// PUT /api/settings/autogen-factors reorder validation (#252, Slice 1). The submitted
// order must be an exact permutation of the existing factor keys. (Codex #1761 asked
// for coverage of the route's validation logic; it lives in this pure helper.)

const EXISTING = ["hardLimits", "coverage", "overHours", "underHours", "requests", "fairness"];

describe("validateFactorOrder", () => {
  it("accepts an exact permutation and returns the order", () => {
    const perm = ["fairness", "coverage", "requests", "overHours", "underHours", "hardLimits"];
    const r = validateFactorOrder(perm, EXISTING);
    expect(r).toEqual({ ok: true, order: perm });
  });

  it("accepts the identity order", () => {
    const r = validateFactorOrder([...EXISTING], EXISTING);
    expect(r.ok).toBe(true);
  });

  it("rejects a non-array body", () => {
    expect(validateFactorOrder(undefined, EXISTING).ok).toBe(false);
    expect(validateFactorOrder({ order: EXISTING }, EXISTING).ok).toBe(false);
    expect(validateFactorOrder("overHours", EXISTING).ok).toBe(false);
  });

  it("rejects non-string entries", () => {
    expect(validateFactorOrder(["overHours", 3, "coverage", "underHours", "requests", "fairness"], EXISTING).ok).toBe(false);
  });

  it("rejects duplicates", () => {
    const r = validateFactorOrder(["overHours", "overHours", "coverage", "underHours", "requests", "fairness"], EXISTING);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/duplicate/i);
  });

  it("rejects a missing key (wrong length)", () => {
    const r = validateFactorOrder(["hardLimits", "coverage", "overHours", "underHours", "requests"], EXISTING);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/permutation/i);
  });

  it("rejects an unknown/extra key", () => {
    const r = validateFactorOrder(["hardLimits", "coverage", "overHours", "underHours", "requests", "fairness", "bogus"], EXISTING);
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown key that replaces a known one (same length)", () => {
    const r = validateFactorOrder(["bogus", "coverage", "overHours", "underHours", "requests", "fairness"], EXISTING);
    expect(r.ok).toBe(false);
  });
});
