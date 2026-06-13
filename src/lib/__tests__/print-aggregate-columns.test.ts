import { describe, it, expect } from "vitest";
import { computeAggregateColumns, type AggregateColumn } from "../print-aggregate-columns";
import type { PrintVisStaff, ShiftKind } from "../print-column-visibility";

describe("computeAggregateColumns", () => {
  const fte = (id: string, pct: number | null = 1): PrintVisStaff => ({ id, employmentTypeId: "fte", ftePercentage: pct });
  const fb = (id: string): PrintVisStaff => ({ id, employmentTypeId: "feebasis", ftePercentage: null });

  const kindByCode = new Map<string, ShiftKind>([
    ["OR", "work"], ["ICU", "work"], ["AL", "leave"], ["x", "off"],
  ]);
  const noCodes = new Map<string, Set<string>>();

  const col = (over: Partial<AggregateColumn> = {}): AggregateColumn => ({
    label: "Col",
    enabled: true,
    isOther: false,
    suppressMembers: true,
    employmentTypeIds: [],
    minFtePercentage: null,
    maxFtePercentage: null,
    conditions: [],
    ...over,
  });
  const other = (over: Partial<AggregateColumn> = {}): AggregateColumn =>
    col({ label: "Other", isOther: true, suppressMembers: false, ...over });

  it("returns no columns and no suppression when there are no aggregate columns", () => {
    const res = computeAggregateColumns([fte("a")], null, [], noCodes, kindByCode);
    expect(res.columns).toEqual([]);
    expect(res.suppressedIndividualIds.size).toBe(0);
  });

  it("named column collects matching staff and suppresses them when suppressMembers", () => {
    const staff = [fte("a"), fb("b"), fb("c")];
    const cols = [col({ label: "FB", employmentTypeIds: ["feebasis"] })];
    const res = computeAggregateColumns(staff, null, cols, noCodes, kindByCode);
    expect(res.columns).toEqual([{ label: "FB", isOther: false, memberIds: ["b", "c"] }]);
    expect(res.suppressedIndividualIds).toEqual(new Set(["b", "c"]));
  });

  it("does NOT suppress members when suppressMembers is false (co-exist)", () => {
    const staff = [fte("a"), fb("b")];
    const cols = [col({ label: "FB", employmentTypeIds: ["feebasis"], suppressMembers: false })];
    const res = computeAggregateColumns(staff, null, cols, noCodes, kindByCode);
    expect(res.columns[0].memberIds).toEqual(["b"]);
    expect(res.suppressedIndividualIds.size).toBe(0);
  });

  it("first-match-wins across named columns (no double-listing)", () => {
    const staff = [fb("a")];
    const cols = [
      col({ label: "First", employmentTypeIds: ["feebasis"] }),
      col({ label: "Second", employmentTypeIds: ["feebasis"] }),
    ];
    const res = computeAggregateColumns(staff, null, cols, noCodes, kindByCode);
    expect(res.columns[0].memberIds).toEqual(["a"]);
    expect(res.columns[1].memberIds).toEqual([]);
  });

  it("Other is empty when everyone has an individual column (default/migration safety)", () => {
    const staff = [fte("a"), fte("b")];
    const res = computeAggregateColumns(staff, null, [other()], noCodes, kindByCode);
    expect(res.columns).toEqual([{ label: "Other", isOther: true, memberIds: [] }]);
  });

  it("Other catches staff with no printed individual column and no named column", () => {
    const staff = [fte("a"), fte("b"), fb("c")];
    // individualVisible excludes c (e.g. an exclude PrintColumnRule), no named columns.
    const res = computeAggregateColumns(staff, new Set(["a", "b"]), [other()], noCodes, kindByCode);
    expect(res.columns[0].memberIds).toEqual(["c"]);
  });

  it("W1: a staff claimed by a suppressing named column is NOT also in Other (final set)", () => {
    const staff = [fte("a"), fb("b")];
    // b has an individual column (visible) but a suppressing named column claims it.
    const cols = [col({ label: "FB", employmentTypeIds: ["feebasis"], suppressMembers: true }), other()];
    const res = computeAggregateColumns(staff, null, cols, noCodes, kindByCode);
    expect(res.suppressedIndividualIds).toEqual(new Set(["b"]));
    const fbCol = res.columns.find((c) => c.label === "FB")!;
    const otherCol = res.columns.find((c) => c.isOther)!;
    expect(fbCol.memberIds).toEqual(["b"]);
    expect(otherCol.memberIds).toEqual([]); // b appears in FB, not Other
  });

  it("a co-exist named member appears in its column AND keeps individual, so not in Other", () => {
    const staff = [fb("b")];
    const cols = [col({ label: "FB", employmentTypeIds: ["feebasis"], suppressMembers: false }), other()];
    const res = computeAggregateColumns(staff, null, cols, noCodes, kindByCode);
    expect(res.columns.find((c) => c.label === "FB")!.memberIds).toEqual(["b"]);
    expect(res.columns.find((c) => c.isOther)!.memberIds).toEqual([]);
  });

  it("disabled columns are ignored entirely", () => {
    const staff = [fb("a")];
    const cols = [col({ label: "Off", employmentTypeIds: ["feebasis"], enabled: false })];
    const res = computeAggregateColumns(staff, null, cols, noCodes, kindByCode);
    expect(res.columns).toEqual([]);
    expect(res.suppressedIndividualIds.size).toBe(0);
  });

  it("preserves input column order in the output", () => {
    const staff = [fte("a"), fb("b")];
    const cols = [other(), col({ label: "FB", employmentTypeIds: ["feebasis"] })];
    const res = computeAggregateColumns(staff, new Set(["a"]), cols, noCodes, kindByCode);
    expect(res.columns.map((c) => c.label)).toEqual(["Other", "FB"]);
  });

  it("matches shift conditions via the shared rule matcher", () => {
    const staff = [fte("a"), fte("b")];
    const codes = new Map<string, Set<string>>([["a", new Set(["ICU"])], ["b", new Set(["OR"])]]);
    // has_any ICU
    const cols = [col({ label: "ICU team", conditions: [{ quantifier: "has_any", categories: [], codes: ["ICU"], except: [] }] })];
    const res = computeAggregateColumns(staff, null, cols, codes, kindByCode);
    expect(res.columns[0].memberIds).toEqual(["a"]);
  });
});
