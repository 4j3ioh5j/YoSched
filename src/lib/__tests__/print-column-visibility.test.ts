import { describe, it, expect } from "vitest";
import {
  printVisibleStaffIds,
  coerceConditions,
  legacyToConditions,
  effectiveConditions,
  type PrintRule,
  type ShiftCondition,
  type ShiftKind,
  type PrintVisStaff,
} from "../print-column-visibility";

describe("printVisibleStaffIds", () => {
  const fte = (id: string, pct: number | null): PrintVisStaff => ({ id, employmentTypeId: "fte", ftePercentage: pct });
  const fb = (id: string, pct: number | null = null): PrintVisStaff => ({ id, employmentTypeId: "feebasis", ftePercentage: pct });

  // Shift catalog: code -> kind
  const kindByCode = new Map<string, ShiftKind>([
    ["OR", "work"], ["ORC", "work"], ["ORL", "work"], ["ICU", "work"], ["CARD", "work"],
    ["AL", "leave"], ["SL", "leave"],
    ["x", "off"],
  ]);

  const cond = (over: Partial<ShiftCondition> = {}): ShiftCondition => ({
    quantifier: "has_any",
    categories: [],
    codes: [],
    except: [],
    ...over,
  });
  const rule = (over: Partial<PrintRule> = {}): PrintRule => ({
    enabled: true,
    mode: "include",
    employmentTypeIds: [],
    minFtePercentage: null,
    maxFtePercentage: null,
    conditions: [],
    ...over,
  });
  const codes = (m: Record<string, string[]>) =>
    new Map(Object.entries(m).map(([k, v]) => [k, new Set(v)]));

  it("returns null (show everyone) when there are no rules", () => {
    expect(printVisibleStaffIds([fte("a", 1)], [], new Map(), kindByCode)).toBeNull();
  });

  it("returns null when all rules are disabled", () => {
    const rules = [rule({ enabled: false, employmentTypeIds: ["fte"] })];
    expect(printVisibleStaffIds([fte("a", 1)], rules, new Map(), kindByCode)).toBeNull();
  });

  it("matches by employment type (empty list = any)", () => {
    const staff = [fte("a", 1), fb("b")];
    const res = printVisibleStaffIds(staff, [rule({ employmentTypeIds: ["fte"] })], new Map(), kindByCode);
    expect(res).toEqual(new Set(["a"]));
  });

  it("applies FTE range [min,max]; null fte fails a bounded rule", () => {
    const staff = [fte("a", 0.2), fte("b", 0.5), fte("c", 0.9), fte("d", null)];
    const res = printVisibleStaffIds(staff, [rule({ minFtePercentage: 0.5, maxFtePercentage: 0.8 })], new Map(), kindByCode);
    expect(res).toEqual(new Set(["b"]));
  });

  it("has_any over explicit codes", () => {
    const staff = [fte("a", 1), fte("b", 1), fte("c", 1)];
    const c = codes({ a: ["ORC"], b: ["OR"], c: ["AL"] });
    const res = printVisibleStaffIds(staff, [rule({ conditions: [cond({ codes: ["ORC", "ORL", "OR", "CARD"] })] })], c, kindByCode);
    expect(res).toEqual(new Set(["a", "b"]));
  });

  it("has_all over explicit codes", () => {
    const staff = [fte("a", 1), fte("b", 1)];
    const c = codes({ a: ["ICU", "CARD"], b: ["ICU"] });
    const res = printVisibleStaffIds(staff, [rule({ conditions: [cond({ quantifier: "has_all", codes: ["ICU", "CARD"] })] })], c, kindByCode);
    expect(res).toEqual(new Set(["a"]));
  });

  it("has_any over a category (any work shift)", () => {
    const staff = [fte("a", 1), fte("b", 1), fte("c", 1)];
    const c = codes({ a: ["OR"], b: ["AL"], c: ["x"] });
    const res = printVisibleStaffIds(staff, [rule({ conditions: [cond({ categories: ["work"] })] })], c, kindByCode);
    expect(res).toEqual(new Set(["a"]));
  });

  it("has_any over the OFF category", () => {
    const staff = [fte("a", 1), fte("b", 1)];
    const c = codes({ a: ["x"], b: ["OR"] });
    const res = printVisibleStaffIds(staff, [rule({ conditions: [cond({ categories: ["off"] })] })], c, kindByCode);
    expect(res).toEqual(new Set(["a"]));
  });

  it("has_any over work OR leave categories", () => {
    const staff = [fte("a", 1), fte("b", 1), fte("c", 1)];
    const c = codes({ a: ["OR"], b: ["AL"], c: ["x"] });
    const res = printVisibleStaffIds(staff, [rule({ conditions: [cond({ categories: ["work", "leave"] })] })], c, kindByCode);
    expect(res).toEqual(new Set(["a", "b"]));
  });

  it("has_any work EXCEPT ICU/CARD", () => {
    const staff = [fte("a", 1), fte("b", 1)];
    const c = codes({ a: ["ICU"], b: ["OR", "ICU"] });
    const res = printVisibleStaffIds(staff, [rule({ conditions: [cond({ categories: ["work"], except: ["ICU", "CARD"] })] })], c, kindByCode);
    expect(res).toEqual(new Set(["b"])); // a only has ICU (excepted); b has OR
  });

  it("has_none of work EXCEPT ICU/CARD (only ICU/CARD work, if any)", () => {
    const staff = [
      fte("a", 1), // only ICU -> matches (no work outside ICU/CARD)
      fte("b", 1), // ICU + OR -> fails (has OR)
      fte("c", 1), // only AL leave -> matches (no work at all)
    ];
    const c = codes({ a: ["ICU"], b: ["ICU", "OR"], c: ["AL"] });
    const res = printVisibleStaffIds(staff, [rule({ conditions: [cond({ quantifier: "has_none", categories: ["work"], except: ["ICU", "CARD"] })] })], c, kindByCode);
    expect(res).toEqual(new Set(["a", "c"]));
  });

  it("ANDs multiple conditions within a rule (no work except ICU AND any leave)", () => {
    const staff = [
      fte("a", 1), // ICU + AL -> matches both
      fte("b", 1), // ICU only -> fails (no leave)
      fte("c", 1), // OR + AL -> fails (has non-ICU work)
    ];
    const c = codes({ a: ["ICU", "AL"], b: ["ICU"], c: ["OR", "AL"] });
    const rules = [rule({ conditions: [
      cond({ quantifier: "has_none", categories: ["work"], except: ["ICU"] }),
      cond({ quantifier: "has_any", categories: ["leave"] }),
    ] })];
    const res = printVisibleStaffIds(staff, rules, c, kindByCode);
    expect(res).toEqual(new Set(["a"]));
  });

  it("ORs multiple include rules (union)", () => {
    const staff = [fte("a", 1), fb("b"), fte("c", 0.3)];
    const c = codes({ b: ["ICU"] });
    const rules = [
      rule({ employmentTypeIds: ["fte"], minFtePercentage: 0.5 }), // a
      rule({ employmentTypeIds: ["feebasis"], conditions: [cond({ codes: ["ICU"] })] }), // b
    ];
    expect(printVisibleStaffIds(staff, rules, c, kindByCode)).toEqual(new Set(["a", "b"]));
  });

  it("exclude-only rule prints everyone EXCEPT matching staff", () => {
    const staff = [fte("a", 1), fb("b"), fte("c", 0.5)];
    const res = printVisibleStaffIds(staff, [rule({ mode: "exclude", employmentTypeIds: ["feebasis"] })], new Map(), kindByCode);
    expect(res).toEqual(new Set(["a", "c"]));
  });

  it("exclude wins over include when a staff matches both", () => {
    const staff = [fte("a", 1)];
    const c = codes({ a: ["ICU"] });
    const rules = [
      rule({ mode: "include", employmentTypeIds: ["fte"] }),
      rule({ mode: "exclude", conditions: [cond({ codes: ["ICU"] })] }),
    ];
    expect(printVisibleStaffIds(staff, rules, c, kindByCode)).toEqual(new Set());
  });

  it("an empty condition imposes no constraint", () => {
    const staff = [fte("a", 1)];
    const res = printVisibleStaffIds(staff, [rule({ conditions: [cond({})] })], new Map(), kindByCode);
    expect(res).toEqual(new Set(["a"]));
  });
});

describe("condition coercion / legacy synthesis", () => {
  it("coerceConditions drops junk and defaults a bad quantifier to has_any", () => {
    const res = coerceConditions([
      { quantifier: "has_none", categories: ["work", "bogus"], codes: ["ICU", 7], except: ["AL"] },
      { quantifier: "weird" },
      "nope",
      null,
    ]);
    expect(res).toEqual([
      { quantifier: "has_none", categories: ["work"], codes: ["ICU"], except: ["AL"] },
      { quantifier: "has_any", categories: [], codes: [], except: [] },
    ]);
    expect(coerceConditions("not-an-array")).toEqual([]);
  });

  it("legacyToConditions synthesizes one condition from shiftCodes/shiftMatch", () => {
    expect(legacyToConditions(["OR", "ICU"], "any")).toEqual([
      { quantifier: "has_any", categories: [], codes: ["OR", "ICU"], except: [] },
    ]);
    expect(legacyToConditions(["OR"], "all")).toEqual([
      { quantifier: "has_all", categories: [], codes: ["OR"], except: [] },
    ]);
    expect(legacyToConditions([], "any")).toEqual([]);
  });

  it("effectiveConditions prefers stored conditions, else falls back to legacy", () => {
    // New row: conditions present → used, legacy ignored.
    const stored = [{ quantifier: "has_none", categories: ["work"], codes: [], except: ["ICU"] }];
    expect(effectiveConditions(stored, ["OR"], "any")).toEqual(stored);
    // Legacy row migrated to conditions=[]: synthesize from shiftCodes/shiftMatch.
    expect(effectiveConditions([], ["OR", "CARD"], "all")).toEqual([
      { quantifier: "has_all", categories: [], codes: ["OR", "CARD"], except: [] },
    ]);
    // Neither → no shift constraint.
    expect(effectiveConditions([], [], "any")).toEqual([]);
  });
});
