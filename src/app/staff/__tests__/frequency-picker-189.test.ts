import { describe, it, expect } from "vitest";
import { committedTarget } from "../frequency-picker";

// Card #189: editing a count target's number, mode or window keeps its Hard/Prefer choice.
describe("committedTarget keeps the Hard/Prefer choice", () => {
  const prefer = { shiftTypeId: "orc", minCount: 1, maxCount: null, window: "pay_period", windowDays: null, windowCount: 2, strength: "preference" };

  it("count edit: still Prefer, window kept", () => {
    expect(committedTarget(prefer, "orc", 2, null)).toEqual({ ...prefer, minCount: 2 });
  });
  it("mode edits (at most / exactly / between): still Prefer", () => {
    expect(committedTarget(prefer, "orc", 0, 3)?.strength).toBe("preference");
    expect(committedTarget(prefer, "orc", 2, 2)?.strength).toBe("preference");
    expect(committedTarget(prefer, "orc", 1, 4)?.strength).toBe("preference");
  });
  it("rolling-days window: still Prefer", () => {
    expect(committedTarget({ ...prefer, window: "days", windowDays: 10 }, "orc", 1, null)).toMatchObject({ window: "days", windowDays: 10, windowCount: 1, strength: "preference" });
  });
  it("a target without a choice commits as Hard, explicitly", () => {
    const { strength: _s, ...bare } = prefer;
    expect(committedTarget(bare, "orc", 1, null)?.strength).toBe("rule");
  });
  it("0 deletes", () => {
    expect(committedTarget(prefer, "orc", 0, null)).toBeUndefined();
  });
});
