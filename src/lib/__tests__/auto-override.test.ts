import { describe, it, expect } from "vitest";
import { resolveAutoOverride } from "../assignment-attribution";

const row = (source: string, shiftTypeId: string, autoShiftTypeId: string | null = null) => ({
  source,
  shiftTypeId,
  autoShiftTypeId,
});

describe("resolveAutoOverride", () => {
  it("captures the auto value the first time a manual edit overwrites an auto cell", () => {
    // auto placed ORC; user picks ORL → remember ORC.
    expect(resolveAutoOverride(row("auto", "ORC"), "ORL")).toBe("ORC");
  });

  it("records nothing on a no-op edit of an auto cell (same value)", () => {
    // source flips to manual but the value is unchanged → not a real override.
    expect(resolveAutoOverride(row("auto", "ORC"), "ORC")).toBeNull();
  });

  it("carries the original auto value forward across a second manual edit", () => {
    // already captured ORC (now manual=ORL); user edits ORL → QA. Keep ORC.
    // Explicit (not undefined) so it survives a delete+create swap too.
    expect(resolveAutoOverride(row("manual", "ORL", "ORC"), "QA")).toBe("ORC");
  });

  it("clears the capture when edited back to the original auto value", () => {
    // captured ORC (now manual=ORL); user edits back to ORC → no longer an override.
    expect(resolveAutoOverride(row("manual", "ORL", "ORC"), "ORC")).toBeNull();
  });

  it("never captures for a plain manual cell that was never auto", () => {
    expect(resolveAutoOverride(row("manual", "ORC"), "ORL")).toBeNull();
  });

  it("never captures for imported or request-placed cells", () => {
    expect(resolveAutoOverride(row("imported", "ORC"), "ORL")).toBeNull();
    expect(resolveAutoOverride(row("request", "AL"), "ORL")).toBeNull();
  });

  it("records nothing when there is no existing row (create / empty destination)", () => {
    // Also the drag/move-into-empty-cell case: no prior occupant → no baseline.
    expect(resolveAutoOverride(null, "ORC")).toBeNull();
  });

  it("captures the displaced auto value when swapping onto an auto cell", () => {
    // Swap drops ORL onto a cell the auto run had set to ORC → that cell shows "was ORC".
    expect(resolveAutoOverride(row("auto", "ORC"), "ORL")).toBe("ORC");
  });
});
