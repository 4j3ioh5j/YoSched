import { describe, it, expect } from "vitest";
import { SHIFT_SHARE_BASES, DEFAULT_SHIFT_SHARE_BASIS, isShiftShareBasis, parseShiftShareBasis } from "../shift-share";

describe("shift-share", () => {
  it("defaults to FTE-proportional", () => {
    expect(DEFAULT_SHIFT_SHARE_BASIS).toBe("fte");
    expect(SHIFT_SHARE_BASES).toEqual(["fte", "head"]);
  });

  it("isShiftShareBasis is strict", () => {
    for (const b of SHIFT_SHARE_BASES) expect(isShiftShareBasis(b)).toBe(true);
    for (const bad of ["", "FTE", "person", null, undefined, 1, {}]) expect(isShiftShareBasis(bad)).toBe(false);
  });

  it("parseShiftShareBasis is lenient on reads", () => {
    expect(parseShiftShareBasis("head")).toBe("head");
    expect(parseShiftShareBasis("fte")).toBe("fte");
    expect(parseShiftShareBasis(undefined)).toBe("fte");
    expect(parseShiftShareBasis("bogus")).toBe("fte");
  });
});
