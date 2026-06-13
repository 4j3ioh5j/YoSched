import { describe, it, expect } from "vitest";
import {
  printVisibleStaffIds,
  type PrintRule,
  type PrintVisStaff,
} from "../print-column-visibility";

describe("printVisibleStaffIds", () => {
  const fte = (id: string, pct: number | null): PrintVisStaff => ({
    id,
    employmentTypeId: "fte",
    ftePercentage: pct,
  });
  const fb = (id: string, pct: number | null = null): PrintVisStaff => ({
    id,
    employmentTypeId: "feebasis",
    ftePercentage: pct,
  });

  const rule = (over: Partial<PrintRule> = {}): PrintRule => ({
    enabled: true,
    mode: "include",
    employmentTypeIds: [],
    minFtePercentage: null,
    maxFtePercentage: null,
    shiftCodes: [],
    shiftMatch: "any",
    ...over,
  });

  const codes = (m: Record<string, string[]>) =>
    new Map(Object.entries(m).map(([k, v]) => [k, new Set(v)]));

  it("returns null (show everyone) when there are no rules", () => {
    expect(printVisibleStaffIds([fte("a", 1)], [], new Map())).toBeNull();
  });

  it("returns null (show everyone) when all rules are disabled", () => {
    const rules = [rule({ enabled: false, employmentTypeIds: ["fte"] })];
    expect(printVisibleStaffIds([fte("a", 1)], rules, new Map())).toBeNull();
  });

  it("matches by employment type (empty list = any)", () => {
    const staff = [fte("a", 1), fb("b")];
    const res = printVisibleStaffIds(staff, [rule({ employmentTypeIds: ["fte"] })], new Map());
    expect(res).toEqual(new Set(["a"]));
  });

  it("applies an FTE lower bound; null fte fails any bounded rule", () => {
    const staff = [fte("a", 1), fte("b", 0.4), fte("c", null)];
    const res = printVisibleStaffIds(staff, [rule({ minFtePercentage: 0.5 })], new Map());
    expect(res).toEqual(new Set(["a"]));
  });

  it("applies an FTE range [min,max]", () => {
    const staff = [fte("a", 0.2), fte("b", 0.5), fte("c", 0.9)];
    const res = printVisibleStaffIds(
      staff,
      [rule({ minFtePercentage: 0.5, maxFtePercentage: 0.8 })],
      new Map(),
    );
    expect(res).toEqual(new Set(["b"]));
  });

  it("shift match 'any' = at least one of the codes present that period", () => {
    const staff = [fte("a", 1), fte("b", 1), fte("c", 1)];
    const c = codes({ a: ["ORC"], b: ["OR"], c: ["AL"] });
    const res = printVisibleStaffIds(
      staff,
      [rule({ shiftCodes: ["ORC", "ORL", "OR", "CARD"], shiftMatch: "any" })],
      c,
    );
    expect(res).toEqual(new Set(["a", "b"]));
  });

  it("shift match 'all' = every listed code present that period", () => {
    const staff = [fte("a", 1), fte("b", 1)];
    const c = codes({ a: ["ICU", "CARD"], b: ["ICU"] });
    const res = printVisibleStaffIds(
      staff,
      [rule({ shiftCodes: ["ICU", "CARD"], shiftMatch: "all" })],
      c,
    );
    expect(res).toEqual(new Set(["a"]));
  });

  it("combines multiple enabled rules as a union (OR)", () => {
    const staff = [fte("a", 1), fb("b"), fte("c", 0.3)];
    const c = codes({ b: ["ICU"] });
    const rules = [
      rule({ employmentTypeIds: ["fte"], minFtePercentage: 0.5 }), // -> a
      rule({ employmentTypeIds: ["feebasis"], shiftCodes: ["ICU"] }), // -> b
    ];
    const res = printVisibleStaffIds(staff, rules, c);
    expect(res).toEqual(new Set(["a", "b"]));
  });

  it("a staff with no assigned codes fails a shift-required rule", () => {
    const staff = [fte("a", 1)];
    const res = printVisibleStaffIds(staff, [rule({ shiftCodes: ["ICU"] })], new Map());
    expect(res).toEqual(new Set());
  });

  it("exclude-only rule prints everyone EXCEPT matching staff", () => {
    const staff = [fte("a", 1), fb("b"), fte("c", 0.5)];
    const res = printVisibleStaffIds(
      staff,
      [rule({ mode: "exclude", employmentTypeIds: ["feebasis"] })],
      new Map(),
    );
    expect(res).toEqual(new Set(["a", "c"]));
  });

  it("exclude rules subtract from the include base", () => {
    const staff = [fte("a", 1), fte("b", 0.3), fb("c")];
    const rules = [
      rule({ mode: "include", employmentTypeIds: ["fte"] }), // base: a, b
      rule({ mode: "exclude", maxFtePercentage: 0.4 }), // drop b (0.3 <= 0.4)
    ];
    const res = printVisibleStaffIds(staff, rules, new Map());
    expect(res).toEqual(new Set(["a"]));
  });

  it("exclude wins over include when a staff matches both", () => {
    const staff = [fte("a", 1)];
    const c = codes({ a: ["ICU"] });
    const rules = [
      rule({ mode: "include", employmentTypeIds: ["fte"] }),
      rule({ mode: "exclude", shiftCodes: ["ICU"] }),
    ];
    const res = printVisibleStaffIds(staff, rules, c);
    expect(res).toEqual(new Set());
  });
});
