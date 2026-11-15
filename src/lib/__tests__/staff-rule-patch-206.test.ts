import { describe, it, expect } from "vitest";
import { rulesPatch, undoRulesPatch, afterRulesSave, RULE_KEYS } from "../staff-rule-patch";
import { ruleListVersion } from "../staff-rule-versions";

// Card #206: the page sends only the rule lists it changed, each with the version of the copy
// it holds; a version is only ever kept next to the contents it was computed from.

const A1 = { type: "unavailable", strength: "rule", whenKind: "every", whenDays: [1] };
const A2 = { type: "unavailable", strength: "rule", whenKind: "every", whenDays: [2] };
const held = {
  id: "s1", name: "Ann",
  availabilityRules: [A1], shiftEligibilityRules: [], shiftMinimumTargets: [], standingCommitments: [], shiftOverrides: [],
  ruleVersions: { availabilityRules: "vA", shiftEligibilityRules: "vE", shiftMinimumTargets: "vM", standingCommitments: "vS", shiftOverrides: "vO" },
};

describe("rulesPatch", () => {
  it("a name-only save sends no rule list", () => {
    const p = rulesPatch({ ...held, name: "Anne" }, held);
    expect(p.sent).toEqual([]);
    expect(p.lists).toEqual({});
    expect(p.ruleBases).toEqual({});
  });
  it("sends only the changed list, with the held version as its base", () => {
    const p = rulesPatch({ ...held, availabilityRules: [A1, A2] }, held);
    expect(p.sent).toEqual(["availabilityRules"]);
    expect(p.lists).toEqual({ availabilityRules: [A1, A2] });
    expect(p.ruleBases).toEqual({ availabilityRules: "vA" });
  });
  it("key order inside a rule is not a change; undefined equals null", () => {
    const p = rulesPatch({ ...held, availabilityRules: [{ whenDays: [1], whenKind: "every", strength: "rule", type: "unavailable", whenPpWeek: undefined }] }, { ...held, availabilityRules: [{ ...A1, whenPpWeek: null }] });
    expect(p.sent).toEqual([]);
  });
  it("a list with no held version is sent without a base (server then requires it to equal what is stored)", () => {
    const p = rulesPatch({ ...held, availabilityRules: [A2] }, { ...held, ruleVersions: {} });
    expect(p.sent).toEqual(["availabilityRules"]);
    expect(p.ruleBases).toEqual({});
  });
});

describe("afterRulesSave", () => {
  it("sent lists take the response version; unsent lists keep both the old contents and the old version", () => {
    const edited = { ...held, name: "Anne", availabilityRules: [A1, A2] };
    const next = afterRulesSave(edited, held, ["availabilityRules"], { availabilityRules: "vA2", shiftEligibilityRules: "NEWER", shiftMinimumTargets: "NEWER", standingCommitments: "NEWER", shiftOverrides: "NEWER" });
    expect(next.name).toBe("Anne");
    expect(next.availabilityRules).toEqual([A1, A2]);
    expect(next.ruleVersions).toEqual({ ...held.ruleVersions, availabilityRules: "vA2" });
  });
  it("a name-only save never adopts a newer server version (another tab added a rule)", () => {
    const next = afterRulesSave({ ...held, name: "Anne" }, held, [], { availabilityRules: "OTHER-TAB", shiftEligibilityRules: "vE", shiftMinimumTargets: "vM", standingCommitments: "vS", shiftOverrides: "vO" });
    expect(next.availabilityRules).toEqual([A1]);
    expect(next.ruleVersions.availabilityRules).toBe("vA");
    // …so the next availability edit still carries the OLD base, which the server refuses.
    expect(rulesPatch({ ...next, availabilityRules: [] }, next).ruleBases).toEqual({ availabilityRules: "vA" });
  });
  it("a missing response version leaves that list without a version (fails closed)", () => {
    const next = afterRulesSave({ ...held, availabilityRules: [A2] }, held, ["availabilityRules"], undefined);
    expect(next.ruleVersions.availabilityRules).toBeUndefined();
  });
});

describe("undoRulesPatch", () => {
  it("sends prev's contents for exactly the lists the save sent, based on the versions that save produced", () => {
    const saved = { ...held, availabilityRules: [A1, A2], ruleVersions: { ...held.ruleVersions, availabilityRules: "vA2" } };
    const p = undoRulesPatch(held, saved, ["availabilityRules"]);
    expect(p.sent).toEqual(["availabilityRules"]);
    expect(p.lists).toEqual({ availabilityRules: [A1] });
    expect(p.ruleBases).toEqual({ availabilityRules: "vA2" });
  });
  it("an empty mask sends no list", () => {
    expect(undoRulesPatch(held, held, [])).toEqual({ sent: [], lists: {}, ruleBases: {} });
  });
});

describe("ruleListVersion", () => {
  it("is order-insensitive and ignores id / staffId", () => {
    const a = { id: "x", staffId: "s1", ...A1, conditionStaffId: null, conditionType: null, whenPpWeek: null, whenOrds: [], whenCycleUnit: null, whenCycleN: null, whenCycleOffset: null };
    const b = { ...a, id: "y", whenDays: [2] };
    expect(ruleListVersion("availabilityRules", [a, b])).toBe(ruleListVersion("availabilityRules", [{ ...b, id: "z", staffId: "s9" }, { ...a, id: "w" }]));
  });
  it("differs when any written column differs, for every list", () => {
    for (const k of RULE_KEYS) expect(ruleListVersion(k, [])).not.toBe(ruleListVersion(k, [{}]));
    const t = { shiftTypeId: "call", minCount: 1, maxCount: null, window: "pp", windowDays: null, windowCount: 1, strength: "rule" };
    expect(ruleListVersion("shiftMinimumTargets", [t])).not.toBe(ruleListVersion("shiftMinimumTargets", [{ ...t, strength: "preference" }]));
    const o = { shiftTypeId: "call", durationHrs: 12, durationHrsWeekday: null, durationHrsWeekend: null, durationHrsHoliday: null };
    expect(ruleListVersion("shiftOverrides", [o])).not.toBe(ruleListVersion("shiftOverrides", [{ ...o, durationHrsHoliday: 8 }]));
  });
  it("undefined and null are the same; a column it does not write is ignored", () => {
    const o = { shiftTypeId: "call", durationHrs: 12, durationHrsWeekday: null, durationHrsWeekend: null, durationHrsHoliday: null };
    expect(ruleListVersion("shiftOverrides", [o])).toBe(ruleListVersion("shiftOverrides", [{ ...o, durationHrsWeekday: undefined, extra: 1 }]));
  });
});

describe("withoutRules", () => {
  it("drops the five lists and the versions, keeps every other field", async () => {
    const { withoutRules } = await import("../staff-rule-patch");
    expect(withoutRules({ ...held, isActive: true })).toEqual({ id: "s1", name: "Ann", isActive: true });
  });
});
