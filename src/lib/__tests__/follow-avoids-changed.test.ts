import { describe, it, expect } from "vitest";
import { followAvoidsChanged } from "../follow-avoids";

// Card #177: Settings writes a shift's avoid list only when the ticked set differs from what's saved.
const saved = [
  { id: "1", sourceShiftId: "orl", avoidShiftId: "orc" },
  { id: "2", sourceShiftId: "orl", avoidShiftId: "x" },
  { id: "3", sourceShiftId: "orc", avoidShiftId: "orl" },
];

describe("followAvoidsChanged", () => {
  it("is false for the same set in any order, and ignores other sources' rows", () => {
    expect(followAvoidsChanged(saved, "orl", new Set(["x", "orc"]))).toBe(false);
    expect(followAvoidsChanged(saved, "or", new Set())).toBe(false);
  });
  it("is true when a tick is added, removed or swapped", () => {
    expect(followAvoidsChanged(saved, "orl", new Set(["orc", "x", "or"]))).toBe(true);
    expect(followAvoidsChanged(saved, "orl", new Set(["orc"]))).toBe(true);
    expect(followAvoidsChanged(saved, "orl", new Set(["orc", "or"]))).toBe(true);
    expect(followAvoidsChanged(saved, "or", new Set(["x"]))).toBe(true);
  });
});
