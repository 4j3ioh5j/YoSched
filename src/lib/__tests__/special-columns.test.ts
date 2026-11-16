import { describe, it, expect } from "vitest";
import {
  orderSpecialColumns,
  specialColumnKey,
  validateSpecialColumnOrder,
  parseSpecialColumnOrder,
  planKeepIds,
} from "../special-columns";

// Card #300: one admin-set order across the schedule's special columns (aggregate,
// dedicated-shift and count columns). A null/empty order is exactly today's layout:
// aggregate → dedicated → count, each group in its own order.

const agg = [{ id: "g1", label: "OTHER" }, { id: "g2", label: "OTHER" }]; // duplicate labels on purpose
const ded = [{ id: "st-card", code: "CARD" }, { id: "st-icu", code: "ICU" }];
const count = [{ id: "c1", label: "#" }];

const keys = (xs: { key: string }[]) => xs.map((x) => x.key);

describe("specialColumnKey", () => {
  it("prefixes the kind", () => {
    expect(specialColumnKey("agg", "g1")).toBe("agg:g1");
    expect(specialColumnKey("ded", "st-card")).toBe("ded:st-card");
    expect(specialColumnKey("count", "c1")).toBe("count:c1");
  });
});

describe("orderSpecialColumns", () => {
  it("null or empty order → today's layout (agg, then ded, then count)", () => {
    const want = ["agg:g1", "agg:g2", "ded:st-card", "ded:st-icu", "count:c1"];
    expect(keys(orderSpecialColumns({ agg, ded, count }, null))).toEqual(want);
    expect(keys(orderSpecialColumns({ agg, ded, count }, []))).toEqual(want);
  });

  it("a full custom order interleaves the kinds and keeps each column's own data", () => {
    const out = orderSpecialColumns({ agg, ded, count }, ["count:c1", "ded:st-icu", "agg:g2", "ded:st-card", "agg:g1"]);
    expect(keys(out)).toEqual(["count:c1", "ded:st-icu", "agg:g2", "ded:st-card", "agg:g1"]);
    expect(out.map((x) => x.kind)).toEqual(["count", "ded", "agg", "ded", "agg"]);
    // Same-label aggregate columns stay tied to their own ids, not their labels.
    expect(out[2].col).toBe(agg[1]);
    expect(out[4].col).toBe(agg[0]);
  });

  it("stale keys are ignored; columns the order does not name follow, in the default order", () => {
    const out = orderSpecialColumns({ agg, ded, count }, ["count:gone", "ded:st-icu", "agg:old", "count:c1"]);
    expect(keys(out)).toEqual(["ded:st-icu", "count:c1", "agg:g1", "agg:g2", "ded:st-card"]);
  });

  it("a key listed twice places its column once (the first time)", () => {
    const out = orderSpecialColumns({ agg, ded, count }, ["count:c1", "count:c1", "agg:g1"]);
    expect(keys(out)).toEqual(["count:c1", "agg:g1", "agg:g2", "ded:st-card", "ded:st-icu"]);
  });

  it("a key whose id belongs to another kind does not move that column", () => {
    // "ded:c1" is not a dedicated column even though c1 is a count column id.
    const out = orderSpecialColumns({ agg, ded, count }, ["ded:c1"]);
    expect(keys(out)).toEqual(["agg:g1", "agg:g2", "ded:st-card", "ded:st-icu", "count:c1"]);
  });

  it("empty groups are fine", () => {
    expect(keys(orderSpecialColumns({ agg: [], ded: [], count: [] }, ["agg:g1"]))).toEqual([]);
    expect(keys(orderSpecialColumns({ agg: [], ded, count: [] }, ["ded:st-icu"]))).toEqual(["ded:st-icu", "ded:st-card"]);
  });
});

describe("validateSpecialColumnOrder", () => {
  it("accepts a list of kind:id keys", () => {
    expect(validateSpecialColumnOrder(["agg:g1", "ded:st-card", "count:c1"])).toEqual({ ok: true, value: ["agg:g1", "ded:st-card", "count:c1"] });
    expect(validateSpecialColumnOrder([])).toEqual({ ok: true, value: [] });
  });

  it("rejects bad shapes, bad prefixes, bad ids, duplicates and oversize lists", () => {
    for (const bad of [
      "agg:g1",
      { a: 1 },
      [1],
      ["g1"],
      ["other:g1"],
      ["agg:"],
      ["agg:has space"],
      ["agg:" + "x".repeat(65)],
      ["agg:g1", "agg:g1"],
      Array.from({ length: 501 }, (_, i) => `agg:g${i}`),
    ]) {
      expect(validateSpecialColumnOrder(bad).ok).toBe(false);
    }
  });
});

describe("parseSpecialColumnOrder (stored value → order)", () => {
  it("returns the keys for a valid stored list and null for anything else", () => {
    expect(parseSpecialColumnOrder(["agg:g1"])).toEqual(["agg:g1"]);
    expect(parseSpecialColumnOrder(null)).toBeNull();
    expect(parseSpecialColumnOrder(undefined)).toBeNull();
    expect(parseSpecialColumnOrder("junk")).toBeNull();
    expect(parseSpecialColumnOrder(["agg:g1", 5])).toBeNull();
  });
});

describe("planKeepIds (writers keep the ids of the columns they are sent)", () => {
  it("keeps ids that exist, creates the rest, deletes rows not sent", () => {
    const plan = planKeepIds(new Set(["a", "b", "c"]), ["b", undefined, "zz", "a"]);
    expect(plan).toEqual({ ok: true, keep: ["b", null, null, "a"], deleteIds: ["c"] });
  });

  it("an old client sending no ids → every row recreated (today's behaviour)", () => {
    expect(planKeepIds(new Set(["a", "b"]), [undefined, undefined])).toEqual({ ok: true, keep: [null, null], deleteIds: ["a", "b"] });
  });

  it("the same id twice → refused", () => {
    expect(planKeepIds(new Set(["a"]), ["a", "a"]).ok).toBe(false);
  });

  it("a non-string id is treated as absent", () => {
    expect(planKeepIds(new Set(["a"]), [5 as unknown as string])).toEqual({ ok: true, keep: [null], deleteIds: ["a"] });
  });
});
