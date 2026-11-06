// Card #71: what an employment type means comes from its settings, never its name. This guard
// fails if code starts comparing a type's name to "FTE" / "Fee Basis" again (labels are fine).
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { staffMatchesRule } from "../print-column-visibility";

describe("no behaviour keyed on an employment type's name", () => {
  it("src has no comparison against the names", () => {
    let out = "";
    try {
      out = execFileSync("git", ["grep", "-nE",
        String.raw`(===|!==|==|!=)\s*["'](FTE|Fee Basis)["']|["'](FTE|Fee Basis)["']\s*(===|!==|==|!=)|name:\s*["'](FTE|Fee Basis)["']`,
        "--", "src", ":!src/**/__tests__/**", ":!src/generated/**"], { encoding: "utf8" });
    } catch (e) {
      // git grep exits 1 when nothing matches — the passing case. Anything else is a real failure.
      if ((e as { status?: number }).status !== 1) throw e;
    }
    expect(out).toBe("");
  });

  it("an FTE-range print rule never matches a person whose type has no FTE %; a rule without one does", () => {
    const rule = { employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: 0.5, conditions: [] };
    const noFte = { id: "nh", employmentTypeId: "t-fee", ftePercentage: null };
    expect(staffMatchesRule(noFte, rule, new Set(), new Map())).toBe(false);
    expect(staffMatchesRule(noFte, { ...rule, maxFtePercentage: null }, new Set(), new Map())).toBe(true);
  });
});
