import { describe, it, expect } from "vitest";
import { deptPickerTarget, deptTargetPutBody } from "../dept-target-row";
import { blankTarget, committedTarget } from "../../staff/frequency-picker";

// Card #258: a Pay-period preferences row showed "Hard" in its picker while it was saved Soft,
// and changing that dropdown did nothing. The picker is now the row's one strength control.
const softRow = {
  id: "t1", shiftTypeId: "orl", minCount: 2, maxCount: null, window: "pay_period",
  windowDays: null, windowCount: 1, strength: "preference", perFte: true,
};

describe("Pay-period preferences: the picker shows and saves the row's strength", () => {
  it("a row saved Soft reaches the picker as Prefer", () => {
    expect(deptPickerTarget(softRow).strength).toBe("preference");
    expect(deptPickerTarget({ ...softRow, strength: "rule" }).strength).toBe("rule");
  });

  it("choosing Hard in the picker saves Hard", () => {
    const edited = { ...deptPickerTarget(softRow), strength: "rule" };
    expect(deptTargetPutBody("orl", edited, softRow).strength).toBe("rule");
  });

  it("choosing Prefer in the picker saves Prefer", () => {
    const hardRow = { ...softRow, strength: "rule" };
    const edited = { ...deptPickerTarget(hardRow), strength: "preference" };
    expect(deptTargetPutBody("orl", edited, hardRow).strength).toBe("preference");
  });

  it("a count edit keeps the saved strength", () => {
    const edited = committedTarget(deptPickerTarget(softRow), "orl", 3, null)!;
    const body = deptTargetPutBody("orl", edited, softRow);
    expect(body).toMatchObject({ minCount: 3, strength: "preference", perFte: true, windowCount: 1 });
  });

  it("a new department row starts as Prefer (as before)", () => {
    const fresh = committedTarget(blankTarget("orl", "preference"), "orl", 1, null)!;
    expect(deptTargetPutBody("orl", fresh, undefined).strength).toBe("preference");
  });

  it("a new staff-card target still starts as Hard", () => {
    expect(blankTarget("orl").strength).toBe("rule");
  });
});
