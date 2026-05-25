import { describe, it, expect } from "vitest";
import {
  buildFollowRuleMap,
  isShiftAllowedAfter,
  isRecoveryOnly,
  type FollowRuleRow,
} from "../follow-rules";

describe("buildFollowRuleMap", () => {
  it("returns empty map for empty input", () => {
    expect(buildFollowRuleMap([])).toEqual(new Map());
  });

  it("creates entry for a single allow rule", () => {
    const rules: FollowRuleRow[] = [
      { sourceShiftId: "s1", allowedShiftId: "s2", allowOffShifts: false, mode: "allow" },
    ];
    const map = buildFollowRuleMap(rules);
    expect(map.size).toBe(1);
    const entry = map.get("s1")!;
    expect(entry.mode).toBe("allow");
    expect(entry.shiftIds.has("s2")).toBe(true);
    expect(entry.allowOffShifts).toBe(false);
  });

  it("aggregates multiple allowed shifts for same source", () => {
    const rules: FollowRuleRow[] = [
      { sourceShiftId: "s1", allowedShiftId: "s2", allowOffShifts: false, mode: "allow" },
      { sourceShiftId: "s1", allowedShiftId: "s3", allowOffShifts: false, mode: "allow" },
      { sourceShiftId: "s1", allowedShiftId: "s4", allowOffShifts: true, mode: "allow" },
    ];
    const map = buildFollowRuleMap(rules);
    const entry = map.get("s1")!;
    expect(entry.shiftIds.size).toBe(3);
    expect(entry.allowOffShifts).toBe(true);
  });

  it("handles null allowedShiftId (off-shifts only rule)", () => {
    const rules: FollowRuleRow[] = [
      { sourceShiftId: "s1", allowedShiftId: null, allowOffShifts: true, mode: "allow" },
    ];
    const map = buildFollowRuleMap(rules);
    const entry = map.get("s1")!;
    expect(entry.shiftIds.size).toBe(0);
    expect(entry.allowOffShifts).toBe(true);
  });

  it("keeps separate entries for different source shifts", () => {
    const rules: FollowRuleRow[] = [
      { sourceShiftId: "s1", allowedShiftId: "s2", allowOffShifts: false, mode: "allow" },
      { sourceShiftId: "s3", allowedShiftId: "s4", allowOffShifts: false, mode: "block" },
    ];
    const map = buildFollowRuleMap(rules);
    expect(map.size).toBe(2);
    expect(map.get("s1")!.mode).toBe("allow");
    expect(map.get("s3")!.mode).toBe("block");
  });
});

describe("isShiftAllowedAfter", () => {
  describe("allow mode", () => {
    it("allows any shift when no rule exists for the source", () => {
      const map = buildFollowRuleMap([]);
      expect(isShiftAllowedAfter(map, "s1", "s2", false)).toBe(true);
      expect(isShiftAllowedAfter(map, "s1", "s2", true)).toBe(true);
    });

    it("allows listed shifts", () => {
      const map = buildFollowRuleMap([
        { sourceShiftId: "s1", allowedShiftId: "s2", allowOffShifts: false, mode: "allow" },
      ]);
      expect(isShiftAllowedAfter(map, "s1", "s2", false)).toBe(true);
    });

    it("blocks unlisted shifts", () => {
      const map = buildFollowRuleMap([
        { sourceShiftId: "s1", allowedShiftId: "s2", allowOffShifts: false, mode: "allow" },
      ]);
      expect(isShiftAllowedAfter(map, "s1", "s3", false)).toBe(false);
    });

    it("allows off-shifts when allowOffShifts is true", () => {
      const map = buildFollowRuleMap([
        { sourceShiftId: "s1", allowedShiftId: "s2", allowOffShifts: true, mode: "allow" },
      ]);
      expect(isShiftAllowedAfter(map, "s1", "any", true)).toBe(true);
    });

    it("blocks off-shifts when allowOffShifts is false", () => {
      const map = buildFollowRuleMap([
        { sourceShiftId: "s1", allowedShiftId: "s2", allowOffShifts: false, mode: "allow" },
      ]);
      expect(isShiftAllowedAfter(map, "s1", "any", true)).toBe(false);
    });
  });

  describe("block mode", () => {
    it("blocks listed shifts", () => {
      const map = buildFollowRuleMap([
        { sourceShiftId: "s1", allowedShiftId: "s2", allowOffShifts: false, mode: "block" },
      ]);
      expect(isShiftAllowedAfter(map, "s1", "s2", false)).toBe(false);
    });

    it("allows unlisted shifts", () => {
      const map = buildFollowRuleMap([
        { sourceShiftId: "s1", allowedShiftId: "s2", allowOffShifts: false, mode: "block" },
      ]);
      expect(isShiftAllowedAfter(map, "s1", "s3", false)).toBe(true);
    });

    it("blocks off-shifts when allowOffShifts is true (inverted in block mode)", () => {
      const map = buildFollowRuleMap([
        { sourceShiftId: "s1", allowedShiftId: "s2", allowOffShifts: true, mode: "block" },
      ]);
      expect(isShiftAllowedAfter(map, "s1", "any", true)).toBe(false);
    });
  });
});

describe("isRecoveryOnly", () => {
  it("returns false when no rule exists for source", () => {
    const map = buildFollowRuleMap([]);
    expect(isRecoveryOnly(map, "s1")).toBe(false);
  });

  it("returns true when allow mode with off-shifts and no specific shifts", () => {
    const map = buildFollowRuleMap([
      { sourceShiftId: "s1", allowedShiftId: null, allowOffShifts: true, mode: "allow" },
    ]);
    expect(isRecoveryOnly(map, "s1")).toBe(true);
  });

  it("returns false when allow mode has specific allowed shifts", () => {
    const map = buildFollowRuleMap([
      { sourceShiftId: "s1", allowedShiftId: "s2", allowOffShifts: true, mode: "allow" },
    ]);
    expect(isRecoveryOnly(map, "s1")).toBe(false);
  });

  it("returns false for block mode even with allowOffShifts", () => {
    const map = buildFollowRuleMap([
      { sourceShiftId: "s1", allowedShiftId: null, allowOffShifts: true, mode: "block" },
    ]);
    expect(isRecoveryOnly(map, "s1")).toBe(false);
  });

  it("returns false when allowOffShifts is false", () => {
    const map = buildFollowRuleMap([
      { sourceShiftId: "s1", allowedShiftId: null, allowOffShifts: false, mode: "allow" },
    ]);
    expect(isRecoveryOnly(map, "s1")).toBe(false);
  });
});
