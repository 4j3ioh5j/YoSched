import { describe, it, expect } from "vitest";
import {
  scaleCountToFte,
  scaleDeptTargetToFte,
  effectiveTargetsForStaff,
  type DepartmentShiftTarget,
} from "../department-targets";
import type { ShiftMinTarget } from "../shift-eligibility";

const ORL = "orl-id";
const OR = "or-id";

function deptTarget(over: Partial<DepartmentShiftTarget> = {}): DepartmentShiftTarget {
  return {
    shiftTypeId: ORL,
    minCount: 2,
    maxCount: null,
    window: "pay_period",
    windowDays: null,
    windowCount: 1,
    strength: "preference",
    perFte: true,
    ...over,
  };
}

describe("scaleCountToFte", () => {
  it("rounds to the nearest whole shift", () => {
    expect(scaleCountToFte(2, 1.0)).toBe(2);
    expect(scaleCountToFte(2, 0.8)).toBe(2); // 1.6 → 2
    expect(scaleCountToFte(2, 0.5)).toBe(1); // 1.0 → 1
    expect(scaleCountToFte(3, 0.5)).toBe(2); // 1.5 → 2 (round half up)
  });
  it("never returns negative and tolerates a non-finite fte", () => {
    expect(scaleCountToFte(2, -1)).toBe(0);
    expect(scaleCountToFte(2, NaN)).toBe(2); // falls back to factor 1
  });
});

describe("scaleDeptTargetToFte", () => {
  it("scales min and max by FTE for perFte targets", () => {
    const scaled = scaleDeptTargetToFte(deptTarget({ minCount: 2, maxCount: 4 }), 0.5);
    expect(scaled).toMatchObject({ minCount: 1, maxCount: 2, window: "pay_period" });
  });

  it("passes counts through unchanged when perFte is false", () => {
    const scaled = scaleDeptTargetToFte(deptTarget({ minCount: 2, perFte: false }), 0.5);
    expect(scaled?.minCount).toBe(2);
  });

  it("clamps max >= min after rounding", () => {
    // min 2 @0.8 → 2 ; max 2 @0.8 → 2 ; stays consistent
    const scaled = scaleDeptTargetToFte(deptTarget({ minCount: 2, maxCount: 2 }), 0.8);
    expect(scaled?.maxCount).toBeGreaterThanOrEqual(scaled!.minCount);
  });

  it("returns null when scaling collapses the target to nothing", () => {
    // an at-most-1 cap @0.1 FTE rounds to 0 → no meaningful target
    const scaled = scaleDeptTargetToFte(deptTarget({ minCount: 0, maxCount: 1 }), 0.1);
    expect(scaled).toBeNull();
  });

  it("carries strength through", () => {
    const scaled = scaleDeptTargetToFte(deptTarget({ strength: "rule" }), 1.0);
    expect(scaled?.strength).toBe("rule");
  });
});

describe("effectiveTargetsForStaff", () => {
  const perStaff: ShiftMinTarget[] = [];

  it("adds FTE-scaled department defaults when the staff has none", () => {
    const result = effectiveTargetsForStaff(perStaff, [deptTarget()], 1.0);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ shiftTypeId: ORL, minCount: 2, source: "department", strength: "preference" });
  });

  it("lets a per-staff target override the department default for the same key", () => {
    const staffTarget: ShiftMinTarget = { shiftTypeId: ORL, minCount: 5, maxCount: null, window: "pay_period", windowDays: null, windowCount: 1 };
    const result = effectiveTargetsForStaff([staffTarget], [deptTarget()], 1.0);
    // Only the staff target survives — department default for ORL/pay_period/1 is dropped.
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ shiftTypeId: ORL, minCount: 5, source: "staff", strength: "rule" });
  });

  it("keeps department defaults for OTHER keys while honoring an override on one", () => {
    const staffTarget: ShiftMinTarget = { shiftTypeId: ORL, minCount: 5, maxCount: null, window: "pay_period", windowDays: null, windowCount: 1 };
    const result = effectiveTargetsForStaff(
      [staffTarget],
      [deptTarget({ shiftTypeId: ORL }), deptTarget({ shiftTypeId: OR, minCount: 1 })],
      1.0,
    );
    const orRow = result.find((r) => r.shiftTypeId === OR);
    const orlRow = result.find((r) => r.shiftTypeId === ORL);
    expect(orlRow).toMatchObject({ minCount: 5, source: "staff" });
    expect(orRow).toMatchObject({ minCount: 1, source: "department" });
  });

  it("a different window is a different key — both coexist", () => {
    const staffTarget: ShiftMinTarget = { shiftTypeId: ORL, minCount: 1, maxCount: null, window: "week", windowDays: null, windowCount: 1 };
    const result = effectiveTargetsForStaff([staffTarget], [deptTarget({ window: "pay_period" })], 1.0);
    expect(result).toHaveLength(2);
  });

  it("drops a department default that scales to nothing for a low-FTE staffer", () => {
    const result = effectiveTargetsForStaff(perStaff, [deptTarget({ minCount: 0, maxCount: 1 })], 0.1);
    expect(result).toHaveLength(0);
  });

  it("applies a department default only when its shift is in the allowed set", () => {
    // ORL is allowed (eligible + auto-schedulable) → target applies.
    const yes = effectiveTargetsForStaff(perStaff, [deptTarget({ shiftTypeId: ORL })], 1.0, new Set([ORL]));
    expect(yes).toHaveLength(1);
    // ORL not in the allowed set (not eligible, or ORL not auto-schedulable) → no-op.
    const no = effectiveTargetsForStaff(perStaff, [deptTarget({ shiftTypeId: ORL })], 1.0, new Set([OR]));
    expect(no).toHaveLength(0);
    // Empty allowed set (e.g. ORL isn't auto-schedulable at all) → no dept defaults.
    const none = effectiveTargetsForStaff(perStaff, [deptTarget({ shiftTypeId: ORL })], 1.0, new Set());
    expect(none).toHaveLength(0);
  });

  it("never gates per-staff targets — only the broad department defaults", () => {
    const staffTarget: ShiftMinTarget = { shiftTypeId: ORL, minCount: 3, maxCount: null, window: "pay_period", windowDays: null, windowCount: 1 };
    // Allowed set excludes ORL, yet the explicit per-staff target survives.
    const result = effectiveTargetsForStaff([staffTarget], [deptTarget({ shiftTypeId: ORL })], 1.0, new Set([OR]));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ shiftTypeId: ORL, source: "staff" });
  });
});
