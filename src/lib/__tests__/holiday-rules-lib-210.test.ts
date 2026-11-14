import { describe, it, expect } from "vitest";
import { buildHolidayGroups, validateHolidayRules, splitGroupWarnings, holidayTypeNameFor, ruleSpan, ruleReach, shiftDate, type HolidayRuleSpec } from "../holiday-rules";
import { holidayRulesVersion } from "../holiday-rules-db";

// Card #210: the group builder, validation and grid warning shared by the engine and Settings.

const TG1: HolidayRuleSpec = { id: "r1", name: "Thanksgiving 1", holidayTypeId: "tg", sortOrder: 0, days: [{ offset: 0, shiftTypeId: "call" }, { offset: 2, shiftTypeId: "call" }] };
const TG2: HolidayRuleSpec = { id: "r2", name: "Thanksgiving 2", holidayTypeId: "tg", sortOrder: 1, days: [{ offset: 3, shiftTypeId: "call" }, { offset: 1, shiftTypeId: "orc" }] };

describe("buildHolidayGroups", () => {
  it("one group per typed holiday per rule, days in date order", () => {
    const g = buildHolidayGroups([{ date: "2026-11-26", holidayTypeId: "tg" }, { date: "2027-11-25", holidayTypeId: "tg" }], [TG1, TG2]);
    expect(g.map((x) => x.key)).toEqual(["r1@2026-11-26", "r2@2026-11-26", "r1@2027-11-25", "r2@2027-11-25"]);
    expect(g[1].slots.map((s) => [s.date, s.shiftTypeId])).toEqual([["2026-11-27", "orc"], ["2026-11-29", "call"]]);
  });

  it("crosses a month end", () => {
    const [g] = buildHolidayGroups([{ date: "2026-11-30", holidayTypeId: "tg" }], [TG1]);
    expect(g.slots.map((s) => s.date)).toEqual(["2026-11-30", "2026-12-02"]);
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("a holiday with no type, or another type, makes no group", () => {
    expect(buildHolidayGroups([{ date: "2026-11-26" }, { date: "2026-12-25", holidayTypeId: "xmas" }], [TG1])).toEqual([]);
  });

  it("from/to keep only groups touching the range, whole", () => {
    const g = buildHolidayGroups([{ date: "2026-11-26", holidayTypeId: "tg" }], [TG1, TG2], "2026-11-29", "2026-12-31");
    expect(g.map((x) => x.ruleId)).toEqual(["r2"]);
    expect(g[0].slots).toHaveLength(2);
  });

  it("span is the furthest day from a holiday", () => {
    expect(ruleSpan([TG1, TG2])).toBe(3);
    expect(ruleSpan([])).toBe(0);
  });

  it("card #218: reach is the widest first-to-last day distance of a rule", () => {
    expect(ruleReach([TG1, TG2])).toBe(2);
    expect(ruleReach([{ ...TG1, days: [{ offset: -7, shiftTypeId: "call" }, { offset: 7, shiftTypeId: "call" }] }])).toBe(14);
    expect(ruleReach([])).toBe(0);
  });
});

describe("validateHolidayRules", () => {
  const types = new Set(["tg"]);
  const shifts = new Set(["call", "orc"]);
  const ok = (raw: unknown) => validateHolidayRules(raw, types, shifts);

  it("accepts the two Thanksgiving rules and trims names", () => {
    const v = ok([{ ...TG1, name: "  Thanksgiving 1 " }, TG2]);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.rules[0].name).toBe("Thanksgiving 1");
      expect(v.rules[1].days.map((d) => d.offset)).toEqual([1, 3]);
    }
  });

  it.each([
    ["not a list", {}],
    ["empty name", [{ ...TG1, name: "  " }]],
    ["long name", [{ ...TG1, name: "x".repeat(61) }]],
    ["unknown type", [{ ...TG1, holidayTypeId: "gone" }]],
    ["one day", [{ ...TG1, days: [{ offset: 0, shiftTypeId: "call" }] }]],
    ["offset out of range", [{ ...TG1, days: [{ offset: 0, shiftTypeId: "call" }, { offset: 8, shiftTypeId: "call" }] }]],
    ["fractional offset", [{ ...TG1, days: [{ offset: 0, shiftTypeId: "call" }, { offset: 1.5, shiftTypeId: "call" }] }]],
    ["same day twice", [{ ...TG1, days: [{ offset: 0, shiftTypeId: "call" }, { offset: 0, shiftTypeId: "orc" }] }]],
    ["unknown shift", [{ ...TG1, days: [{ offset: 0, shiftTypeId: "call" }, { offset: 2, shiftTypeId: "nope" }] }]],
    ["duplicate name in a type", [TG1, { ...TG2, name: "thanksgiving 1" }]],
    ["same day+shift in two rules", [TG1, { ...TG2, days: [{ offset: 2, shiftTypeId: "call" }, { offset: 3, shiftTypeId: "call" }] }]],
  ])("refuses %s", (_label, raw) => {
    expect(ok(raw).ok).toBe(false);
  });
});

describe("splitGroupWarnings", () => {
  const [g] = buildHolidayGroups([{ date: "2026-11-26", holidayTypeId: "tg" }], [TG2]);
  const label = (id: string) => id.toUpperCase();
  const code = (id: string) => id.toUpperCase();
  it("warns when the days are held by different people", () => {
    const held: Record<string, string[]> = { "2026-11-27|orc": ["ko"], "2026-11-29|call": ["cd"] };
    const w = splitGroupWarnings([g], (d, s) => held[`${d}|${s}`] ?? [], label, code);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("Thanksgiving 2");
    expect(w[0]).toContain("KO");
    expect(w[0]).toContain("CD");
  });
  it("no warning when one person holds every filled day, or a day is still empty", () => {
    expect(splitGroupWarnings([g], (d) => (d === "2026-11-27" ? ["ko", "zz"] : ["ko"]), label, code)).toEqual([]);
    expect(splitGroupWarnings([g], (d) => (d === "2026-11-27" ? ["ko"] : []), label, code)).toEqual([]);
  });
});

describe("holiday types and versions", () => {
  it("an observed holiday shares its type name", () => {
    expect(holidayTypeNameFor("Independence Day (observed)")).toBe("Independence Day");
    expect(holidayTypeNameFor("Thanksgiving Day")).toBe("Thanksgiving Day");
  });
  it("the version changes with any edit and not with list order", () => {
    const v = holidayRulesVersion([TG1, TG2]);
    expect(holidayRulesVersion([TG2, TG1])).toBe(v);
    expect(holidayRulesVersion([{ ...TG1, name: "Thanksgiving A" }, TG2])).not.toBe(v);
    expect(holidayRulesVersion([TG1, { ...TG2, days: [{ offset: 1, shiftTypeId: "call" }, { offset: 3, shiftTypeId: "call" }] }])).not.toBe(v);
    expect(holidayRulesVersion([])).not.toBe(v);
  });
});
