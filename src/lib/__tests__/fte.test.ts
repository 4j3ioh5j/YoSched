// Card #71: FTE % only for types that use it; fixed hours per pay period; fairness by setting.
// Failure paths first.
import { describe, it, expect } from "vitest";
import {
  effectiveFte, effectiveFixedHours, staffPpTarget, ppDiffCell, isValidFixedHours,
  staffHoursWrite, typeFlagsWrite, type EmploymentTypeFlags,
} from "../fte";
import { checkStaffPPHours } from "../constraints";
import { computeFairness } from "../fairness";

const FTE: EmploymentTypeFlags = { usesFtePercentage: true, allowsFixedHours: false, includedInFairness: true, defaultFtePercentage: 1 };
const FEE: EmploymentTypeFlags = { usesFtePercentage: false, allowsFixedHours: true, includedInFairness: false, defaultFtePercentage: 0 };
const FEE_NO_FIXED: EmploymentTypeFlags = { ...FEE, allowsFixedHours: false };

describe("effectiveFte / effectiveFixedHours", () => {
  it("a type without an FTE % has none, even with a stored 1.0 (the NH case)", () => {
    expect(effectiveFte({ ftePercentage: 1, fixedHoursPerPp: null }, FEE)).toBeNull();
  });
  it("an FTE type with nothing stored uses the type default", () => {
    expect(effectiveFte({ ftePercentage: null, fixedHoursPerPp: null }, { ...FTE, defaultFtePercentage: 0.8 })).toBe(0.8);
  });
  it("an FTE type uses the stored value", () => {
    expect(effectiveFte({ ftePercentage: 0.4, fixedHoursPerPp: null }, FTE)).toBe(0.4);
  });
  it("fixed hours are ignored on a type that does not allow them", () => {
    expect(effectiveFixedHours({ ftePercentage: 0, fixedHoursPerPp: 40 }, FEE_NO_FIXED)).toBeNull();
  });
  it("fixed hours are ignored on an FTE type (mutually exclusive)", () => {
    expect(effectiveFixedHours({ ftePercentage: 1, fixedHoursPerPp: 40 }, { ...FTE, allowsFixedHours: true })).toBeNull();
  });
  it("unchecked (null), zero, negative and non-finite fixed hours are none", () => {
    for (const h of [null, 0, -8, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(effectiveFixedHours({ ftePercentage: 0, fixedHoursPerPp: h }, FEE)).toBeNull();
    }
  });
  it("checked fixed hours on an allowing type", () => {
    expect(effectiveFixedHours({ ftePercentage: 0, fixedHoursPerPp: 40 }, FEE)).toBe(40);
  });
});

describe("staffPpTarget", () => {
  it("no FTE % and no fixed hours → no target", () => {
    expect(staffPpTarget(null, null, 80)).toBeNull();
  });
  it("fixed hours are absolute, not scaled by a short pay period", () => {
    expect(staffPpTarget(null, 40, 72)).toBe(40);
  });
  it("FTE target = PP hours x FTE", () => {
    expect(staffPpTarget(0.5, null, 80)).toBe(40);
  });
});

describe("ppDiffCell (grid PP +/- row)", () => {
  it("no target → '–', no colour, no target in the tooltip", () => {
    const c = ppDiffCell(24, null);
    expect(c.label).toBe("–");
    expect(c.colorClass).toBe("text-slate-500");
    expect(c.tip).not.toMatch(/target \(/);
  });
  it("fixed 40 with 36 worked → red -4", () => {
    expect(ppDiffCell(36, 40)).toMatchObject({ label: "-4", colorClass: "text-red-400" });
  });
  it("on target → green; over → amber; nothing worked → '–'", () => {
    expect(ppDiffCell(40, 40).colorClass).toBe("text-emerald-400");
    expect(ppDiffCell(48, 40).colorClass).toBe("text-amber-400");
    expect(ppDiffCell(0, 40).label).toBe("–");
  });
});

describe("checkStaffPPHours", () => {
  const pp = { startDate: "2026-01-04", endDate: "2026-01-17", targetHours: 80 };
  const base = { id: "s", initials: "NH", availabilityRules: [] };
  it("no target (type without FTE %, unchecked) → no warning, whatever the hours", () => {
    expect(checkStaffPPHours({ staff: { ...base, ftePercentage: null, fixedHoursPerPp: null }, pp, currentHours: 24 })).toBeNull();
  });
  it("fixed 40 with 36 worked → under-hours", () => {
    const w = checkStaffPPHours({ staff: { ...base, ftePercentage: null, fixedHoursPerPp: 40 }, pp, currentHours: 36 });
    expect(w?.type).toBe("under-hours");
    expect(w?.message).toContain("36/40");
  });
  it("FTE behaviour unchanged", () => {
    expect(checkStaffPPHours({ staff: { ...base, ftePercentage: 1, fixedHoursPerPp: null }, pp, currentHours: 72 })?.type).toBe("under-hours");
  });
});

describe("isValidFixedHours", () => {
  it("rejects 0, negatives, > 999, non-numbers", () => {
    for (const v of [0, -1, 1000, Number.NaN, "40", null, undefined]) expect(isValidFixedHours(v)).toBe(false);
  });
  it("accepts 0.25 .. 999", () => {
    expect(isValidFixedHours(0.25)).toBe(true);
    expect(isValidFixedHours(999)).toBe(true);
  });
});

describe("staffHoursWrite (staff API)", () => {
  it("type without an FTE %: a sent FTE % of 1 is ignored, the stored value left alone (old cached client)", () => {
    expect(staffHoursWrite({ type: FEE, sentFte: 1, hasFixedKey: false, sentFixed: undefined, typeChangedOrNew: false }))
      .toEqual({ ok: true, ftePercentage: undefined, fixedHoursPerPp: undefined });
  });
  it("fixed hours sent for a type that does not allow them are not written (kept, ignored)", () => {
    expect(staffHoursWrite({ type: FEE_NO_FIXED, sentFte: 0, hasFixedKey: true, sentFixed: 40, typeChangedOrNew: false }))
      .toEqual({ ok: true, ftePercentage: undefined, fixedHoursPerPp: undefined });
  });
  it("invalid fixed hours are refused", () => {
    for (const v of [0, -4, 1000, "40", Number.NaN]) {
      expect(staffHoursWrite({ type: FEE, sentFte: 0, hasFixedKey: true, sentFixed: v, typeChangedOrNew: false }).ok).toBe(false);
    }
  });
  it("a type change into a type without an FTE %: FTE % 0, fixed hours reset", () => {
    expect(staffHoursWrite({ type: FEE, sentFte: 1, hasFixedKey: false, sentFixed: undefined, typeChangedOrNew: true }))
      .toEqual({ ok: true, ftePercentage: 0, fixedHoursPerPp: null });
  });
  it("a type change into an FTE type: the type default when no FTE % was sent; fixed hours reset", () => {
    expect(staffHoursWrite({ type: { ...FTE, defaultFtePercentage: 0.9 }, sentFte: undefined, hasFixedKey: true, sentFixed: 40, typeChangedOrNew: true }))
      .toEqual({ ok: true, ftePercentage: 0.9, fixedHoursPerPp: null });
  });
  it("FTE type, same type: nothing sent → nothing written; a sent fixed hours value is ignored", () => {
    expect(staffHoursWrite({ type: FTE, sentFte: undefined, hasFixedKey: true, sentFixed: 40, typeChangedOrNew: false }))
      .toEqual({ ok: true, ftePercentage: undefined, fixedHoursPerPp: undefined });
  });
  it("checked fixed hours are stored; unchecked (null) clears them", () => {
    expect(staffHoursWrite({ type: FEE, sentFte: 0, hasFixedKey: true, sentFixed: 40, typeChangedOrNew: false }))
      .toEqual({ ok: true, ftePercentage: undefined, fixedHoursPerPp: 40 });
    expect(staffHoursWrite({ type: FEE, sentFte: 0, hasFixedKey: true, sentFixed: null, typeChangedOrNew: false }))
      .toEqual({ ok: true, ftePercentage: undefined, fixedHoursPerPp: null });
  });
});

describe("typeFlagsWrite (employment-type API)", () => {
  const ex = { usesFtePercentage: false, allowsFixedHours: true, includedInFairness: false };
  it("refuses an FTE % and fixed hours together", () => {
    expect(typeFlagsWrite({ existing: ex, body: { usesFtePercentage: true } }).ok).toBe(false);
    expect(typeFlagsWrite({ existing: null, body: { usesFtePercentage: true, allowsFixedHours: true } }).ok).toBe(false);
  });
  it("refuses a non-boolean flag", () => {
    expect(typeFlagsWrite({ existing: ex, body: { includedInFairness: "yes" } }).ok).toBe(false);
  });
  it("omitted flags keep the stored values (old cached client)", () => {
    expect(typeFlagsWrite({ existing: ex, body: { name: "Casual" } })).toEqual({ ok: true, flags: ex });
  });
  it("applies a sent flag", () => {
    expect(typeFlagsWrite({ existing: ex, body: { allowsFixedHours: false } }))
      .toEqual({ ok: true, flags: { ...ex, allowsFixedHours: false } });
  });
  it("a new type defaults to FTE %, no fixed hours, in fairness", () => {
    expect(typeFlagsWrite({ existing: null, body: {} }))
      .toEqual({ ok: true, flags: { usesFtePercentage: true, allowsFixedHours: false, includedInFairness: true } });
  });
});

describe("computeFairness honours the type's fairness setting", () => {
  const st = (code: string) => ({ id: `st-${code}`, code, defaultHours: 8, countsTowardFte: true, countsAsHolidayWork: true, isLeave: false });
  const assignments = [
    { staffId: "a", date: "2026-01-05", shiftType: st("CALL") },
    { staffId: "b", date: "2026-01-06", shiftType: st("OR") },
    { staffId: "fee", date: "2026-01-05", shiftType: st("CALL") },
    { staffId: "fee", date: "2026-01-06", shiftType: st("CALL") },
    { staffId: "fee", date: "2026-01-07", shiftType: st("CALL") },
  ];
  const weights = [{ shiftTypeId: "st-CALL", dayOfWeek: 1, weight: -3 }, { shiftTypeId: "st-CALL", dayOfWeek: 2, weight: -3 }, { shiftTypeId: "st-CALL", dayOfWeek: 3, weight: -3 }];
  const person = (id: string, inFairness: boolean) => ({ id, initials: id, ftePercentage: 1, isActive: true, isAutoScheduled: true, inFairness });
  const run = (feeIn: boolean, withFee = true) => computeFairness({
    assignments: withFee ? assignments : assignments.filter((a) => a.staffId !== "fee"),
    staff: [person("a", true), person("b", true), ...(withFee ? [person("fee", feeIn)] : [])],
    desirabilityWeights: weights,
    holidays: [],
  });

  it("an excluded type is absent even when auto-scheduled", () => {
    const f = run(false);
    expect(f.metrics.map((m) => m.staffId).sort()).toEqual(["a", "b"]);
    expect(f.deviations.has("fee")).toBe(false);
  });
  it("an excluded person does not move anyone else's averages or deviations", () => {
    const excluded = run(false);
    const absent = run(false, false);
    expect(excluded.averages).toEqual(absent.averages);
    expect(excluded.deviations.get("a")).toEqual(absent.deviations.get("a"));
  });
  it("included, the same person does count (the test can tell the difference)", () => {
    expect(run(true).metrics.map((m) => m.staffId)).toContain("fee");
  });
});

describe("typeFlagsWrite returns only the three flags", () => {
  it("never echoes other columns of a stored row (a rename must not be overwritten)", () => {
    const row = { id: "t1", name: "Old", sortOrder: 3, usesFtePercentage: false, allowsFixedHours: true, includedInFairness: false };
    const w = typeFlagsWrite({ existing: row, body: { name: "New" } });
    expect(w.ok && Object.keys(w.flags).sort()).toEqual(["allowsFixedHours", "includedInFairness", "usesFtePercentage"]);
  });
});
