import { describe, it, expect } from "vitest";
import { findUnmappedTargets, type ImportRow } from "../historical-import";

const rows: ImportRow[] = [
  { date: "2022-01-01", initials: "ST", code: "OR" },
  { date: "2022-01-01", initials: "ADh", code: "ICU" },
  { date: "2022-01-02", initials: "JCS", code: "PRE" }, // PRE is a remap target
  { date: "2022-01-02", initials: "ST", code: "CB" }, // CB is created by the seed
];

describe("findUnmappedTargets", () => {
  it("returns nothing when every code/initial exists or will be created", () => {
    const res = findUnmappedTargets(
      rows,
      ["OR", "ICU", "PRE"], // existing codes (incl. the PRE remap target)
      ["ST"], // existing providers
      ["CB"], // CB created by the seed
      ["ADh", "JCS"], // new providers created by the seed
    );
    expect(res).toEqual({ codes: [], initials: [] });
  });

  it("flags a missing remap-target code (e.g. PRE) BEFORE any writes", () => {
    // PRE absent from the target DB and not created by the seed -> must be caught.
    const res = findUnmappedTargets(rows, ["OR", "ICU"], ["ST"], ["CB"], ["ADh", "JCS"]);
    expect(res.codes).toContain("PRE");
    expect(res.initials).toEqual([]);
  });

  it("flags a provider that is neither existing nor scheduled for creation", () => {
    const res = findUnmappedTargets(rows, ["OR", "ICU", "PRE", "CB"], ["ST"], [], []);
    // ADh and JCS are not in existing and not in extras here
    expect(res.initials).toEqual(["ADh", "JCS"]);
    expect(res.codes).toEqual([]);
  });

  it("deduplicates and sorts the missing sets", () => {
    const dupes: ImportRow[] = [
      { date: "d", initials: "ZZ", code: "QQ" },
      { date: "d2", initials: "ZZ", code: "QQ" },
      { date: "d3", initials: "AA", code: "PP" },
    ];
    const res = findUnmappedTargets(dupes, [], []);
    expect(res.codes).toEqual(["PP", "QQ"]);
    expect(res.initials).toEqual(["AA", "ZZ"]);
  });
});
