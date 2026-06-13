import { describe, it, expect } from "vitest";
import { resolveInitials, type EntryStaff } from "../dedicated-column-entry";

describe("resolveInitials", () => {
  const staff: EntryStaff[] = [
    { id: "a", initials: "AA" },
    { id: "b", initials: "BB" },
    { id: "c", initials: "CdC" },
  ];

  it("resolves comma-separated initials in input order", () => {
    const res = resolveInitials("BB, AA", staff);
    expect(res.resolved.map((s) => s.id)).toEqual(["b", "a"]);
    expect(res.unknown).toEqual([]);
  });

  it("splits on whitespace and commas interchangeably", () => {
    const res = resolveInitials("AA BB , CdC", staff);
    expect(res.resolved.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("matches case-insensitively", () => {
    const res = resolveInitials("aa, cdc", staff);
    expect(res.resolved.map((s) => s.id)).toEqual(["a", "c"]);
    expect(res.unknown).toEqual([]);
  });

  it("reports unknown tokens (no fuzzy/partial match)", () => {
    const res = resolveInitials("AA, ZZ, A", staff);
    expect(res.resolved.map((s) => s.id)).toEqual(["a"]);
    expect(res.unknown).toEqual(["ZZ", "A"]);
  });

  it("de-duplicates repeated resolved and unknown tokens", () => {
    const res = resolveInitials("AA, aa, ZZ, zz", staff);
    expect(res.resolved.map((s) => s.id)).toEqual(["a"]);
    expect(res.unknown).toEqual(["ZZ"]);
  });

  it("treats blank/whitespace input as empty (clear)", () => {
    expect(resolveInitials("", staff)).toEqual({ resolved: [], unknown: [] });
    expect(resolveInitials("   ,  ", staff)).toEqual({ resolved: [], unknown: [] });
  });
});
