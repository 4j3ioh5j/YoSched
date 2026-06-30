import { describe, it, expect } from "vitest";
import { validateProfileInput, reconcileOrder, MAX_PROFILE_NAME_LENGTH } from "../autogen-profile";

// Named auto-generation priority profiles (#252). validateProfileInput gates "save as
// profile" (name + a valid full ordering); reconcileOrder makes applying an older profile
// safe against a since-changed factor catalog.

const EXISTING = ["hardLimits", "coverage", "overHours", "underHours", "requests", "fairness"];

describe("validateProfileInput", () => {
  it("accepts a non-empty name with a valid permutation and trims the name", () => {
    const perm = ["fairness", "coverage", "requests", "overHours", "underHours", "hardLimits"];
    const r = validateProfileInput("  Balanced  ", perm, EXISTING);
    expect(r).toEqual({ ok: true, name: "Balanced", order: perm });
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(validateProfileInput("", EXISTING, EXISTING).ok).toBe(false);
    const r = validateProfileInput("   ", EXISTING, EXISTING);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/i);
  });

  it("rejects a non-string name", () => {
    expect(validateProfileInput(42, EXISTING, EXISTING).ok).toBe(false);
    expect(validateProfileInput(null, EXISTING, EXISTING).ok).toBe(false);
  });

  it("accepts a name exactly at the length bound", () => {
    const name = "a".repeat(MAX_PROFILE_NAME_LENGTH);
    expect(validateProfileInput(name, [...EXISTING], EXISTING).ok).toBe(true);
  });

  it("rejects a name longer than the length bound (after trimming)", () => {
    const tooLong = `  ${"a".repeat(MAX_PROFILE_NAME_LENGTH + 1)}  `;
    const r = validateProfileInput(tooLong, [...EXISTING], EXISTING);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/characters or fewer/i);
  });

  it("rejects a name with a non-permutation order", () => {
    const r = validateProfileInput("Bad", ["hardLimits", "coverage"], EXISTING);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/permutation/i);
  });
});

describe("reconcileOrder", () => {
  it("returns an exact permutation for a valid saved order (identity)", () => {
    expect(reconcileOrder([...EXISTING], EXISTING)).toEqual(EXISTING);
  });

  it("preserves the saved relative order", () => {
    const saved = ["fairness", "requests", "underHours", "overHours", "coverage", "hardLimits"];
    expect(reconcileOrder(saved, EXISTING)).toEqual(saved);
  });

  it("drops unknown keys and appends missing current keys (in existingKeys order)", () => {
    // Saved snapshot from an older catalog: has a stale 'ppHours', missing 'underHours'/'fairness'.
    const saved = ["fairness", "ppHours", "coverage", "overHours", "hardLimits", "requests"];
    const result = reconcileOrder(saved, EXISTING);
    // 'ppHours' dropped; 'underHours' (the only missing current key) appended at the end.
    expect(result).toEqual(["fairness", "coverage", "overHours", "hardLimits", "requests", "underHours"]);
    expect([...result].sort()).toEqual([...EXISTING].sort()); // exact permutation
  });

  it("dedupes repeated saved keys", () => {
    const saved = ["coverage", "coverage", "hardLimits"];
    const result = reconcileOrder(saved, EXISTING);
    expect([...result].sort()).toEqual([...EXISTING].sort());
    expect(result.indexOf("coverage")).toBe(0);
  });

  it("falls back to existingKeys order for a non-array / garbage snapshot", () => {
    expect(reconcileOrder(null, EXISTING)).toEqual(EXISTING);
    expect(reconcileOrder("nope", EXISTING)).toEqual(EXISTING);
    expect(reconcileOrder([1, 2, {}], EXISTING)).toEqual(EXISTING);
  });
});
