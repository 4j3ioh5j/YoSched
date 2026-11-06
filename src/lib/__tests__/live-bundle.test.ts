import { describe, it, expect } from "vitest";
import { liveBundleProblem, LIVE_BUNDLE_STALE_MESSAGE } from "../live-bundle";

// Rollback regression (Codex #260): after `git revert` of the id link, a tab still on the
// NEW bundle fetches engine inputs from the OLD server, whose staffing requirements are
// keyed by shiftCode only. The new engine keys by shiftTypeId and would see no rules at
// all (two ORC accepted at Max 1). The Live boundary must refuse that bundle.

const base = {
  dates: ["2027-01-04"],
  staff: [],
  shiftTypes: [{ id: "st-orc", code: "ORC" }],
  existingAssignments: [],
};

describe("liveBundleProblem", () => {
  it("rejects the OLD server's code-only staffing requirements with a reload message", () => {
    const oldServerBundle = {
      ...base,
      staffingRequirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 1, preferredCount: 1, maxCount: 1 }],
    };
    expect(liveBundleProblem(oldServerBundle)).toBe(LIVE_BUNDLE_STALE_MESSAGE);
  });

  it("accepts the NEW server's id-keyed requirements (with or without the compat code)", () => {
    expect(
      liveBundleProblem({
        ...base,
        staffingRequirements: [
          { shiftTypeId: "st-orc", shiftCode: "ORC", dayKey: "1", minCount: 1, preferredCount: 1, maxCount: 1 },
          { shiftTypeId: "st-orc", dayKey: "2", minCount: 0, preferredCount: 0, maxCount: null },
        ],
      }),
    ).toBeNull();
  });

  it("accepts a bundle with no staffing rules at all", () => {
    expect(liveBundleProblem({ ...base, staffingRequirements: [] })).toBeNull();
  });

  it("rejects a mixed bundle where any requirement lacks shiftTypeId", () => {
    expect(
      liveBundleProblem({
        ...base,
        staffingRequirements: [
          { shiftTypeId: "st-orc", dayKey: "1", minCount: 1 },
          { shiftCode: "CARD", dayKey: "1", minCount: 1 },
        ],
      }),
    ).toBe(LIVE_BUNDLE_STALE_MESSAGE);
  });

  it("rejects non-bundles (error body, missing arrays)", () => {
    expect(liveBundleProblem(null)).toBe(LIVE_BUNDLE_STALE_MESSAGE);
    expect(liveBundleProblem({ error: "Forbidden" })).toBe(LIVE_BUNDLE_STALE_MESSAGE);
    expect(liveBundleProblem({ ...base, staffingRequirements: "nope" })).toBe(LIVE_BUNDLE_STALE_MESSAGE);
    expect(liveBundleProblem({ staffingRequirements: [], shiftTypes: [] })).toBe(LIVE_BUNDLE_STALE_MESSAGE);
  });
});
