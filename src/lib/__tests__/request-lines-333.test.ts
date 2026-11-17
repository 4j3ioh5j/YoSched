// Card #333: a grouped Requests button runs several requests; the page must report all of them.
import { describe, it, expect } from "vitest";
import { mergeStillCells, batchErrorText, outcomeRank } from "../request-lines";

describe("grouped actions report every request", () => {
  it("still-scheduled days from every request are kept, once each, in date order", () => {
    expect(
      mergeStillCells([
        [{ date: "2027-01-12", code: "OR" }],
        [],
        [{ date: "2027-01-11", code: "ORC" }, { date: "2027-01-12", code: "OR" }],
      ]),
    ).toEqual([{ date: "2027-01-11", code: "ORC" }, { date: "2027-01-12", code: "OR" }]);
    expect(mergeStillCells([])).toEqual([]);
  });
  it("a failure is never hidden by a later success", () => {
    expect(batchErrorText([], 3)).toBeNull();
    expect(batchErrorText(["Failed to update request."], 1)).toBe("Failed to update request.");
    expect(batchErrorText(["Failed to update request.", "Not approved — the day is full."], 3)).toBe(
      "2 of 3 requests were not changed: Failed to update request. Not approved — the day is full.",
    );
    expect(batchErrorText(["Failed to update request.", "Failed to update request."], 2)).toBe(
      "2 of 2 requests were not changed: Failed to update request.",
    );
  });
  it("Archive sorts by outcome: not met first, then met, then withdrawn", () => {
    expect(outcomeRank([{ outcome: "met" }, { outcome: "unmet" }])).toBe(0);
    expect(outcomeRank([{ outcome: "met" }])).toBe(1);
    expect(outcomeRank([{ outcome: "withdrawn" }])).toBe(2);
    expect(outcomeRank([{}])).toBe(3);
  });
});
