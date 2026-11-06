import { describe, it, expect } from "vitest";
import { appliedDiff, undoList } from "@/lib/eligibility-undo";

// Card #75 (Codex #385): Undo of a list save reverses only that save's own diff.
describe("eligibility Undo", () => {
  it("undoList takes out the save's additions and puts back its removals, keeping everything else", () => {
    expect(undoList(["PRE", "T"], { add: ["T"], remove: ["U"] })).toEqual({ list: ["PRE", "U"], base: ["PRE", "T"] });
    expect(undoList(["PRE", "U"], { add: [], remove: [] })).toEqual({ list: ["PRE", "U"], base: ["PRE", "U"] });
  });
  it("appliedDiff uses the server's report when present", () => {
    expect(appliedDiff({ add: ["T"], remove: [] }, ["PRE", "T"], [], ["PRE", "T"])).toEqual({ add: ["T"], remove: [] });
  });
  it("without a report (older server), the user's diff limited to what the saved list shows", () => {
    // user ticked PRE (already there from elsewhere? it's in `after` either way) and T; unticked U
    expect(appliedDiff(undefined, ["T"], ["U"], ["PRE", "T"])).toEqual({ add: ["T"], remove: ["U"] });
    expect(appliedDiff({ add: "x" }, ["U"], ["U"], ["PRE", "U"])).toEqual({ add: [], remove: [] });
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
describe("the employment-type editor's Undo uses the exact inverse (Codex #385)", () => {
  const src = readFileSync(join(__dirname, "../../app/settings/settings-page.tsx"), "utf8");
  it("sends undoList(saved list, applied), never prev's whole list", () => {
    expect(src).toMatch(/const u = undoList\(saved\.defaultEligibleShiftTypeIds, applied\);/);
    expect(src).toMatch(/putType\(\{ \.\.\.prev, defaultEligibleShiftTypeIds: u\.list \}, u\.base\)/);
    expect(src).not.toMatch(/putType\(prev, /);
  });
});
