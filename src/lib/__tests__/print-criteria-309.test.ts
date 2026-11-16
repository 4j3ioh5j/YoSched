import { describe, it, expect } from "vitest";
import { parseCriteriaIn, legacyMirror, buildCriteriaSave, MAX_CRITERIA_LINES } from "../print-criteria";
import { STALE_CLIENT } from "../stale-client";

// Card #309: the save side of a printed column's rule lines.
const shifts = { ids: new Set(["s-icu", "s-or"]), codes: new Set(["ICU", "OR"]) };
const parse = (v: unknown) => parseCriteriaIn(v, shifts, "column 0");
const L = (over: Record<string, unknown> = {}) => ({
  mode: "include", employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions: [], staffIds: [], ...over,
});

describe("parseCriteriaIn", () => {
  it("accepts include and exclude lines and normalises them", () => {
    const r = parse([
      L({ staffIds: ["p1"] }),
      L({ mode: "exclude", conditions: [{ quantifier: "has_none", categories: ["work"], shiftTypeIds: [], exceptIds: ["s-icu"] }] }),
      L({ employmentTypeIds: ["fb"], minFtePercentage: "0.2", maxFtePercentage: 0.8 }),
    ]);
    expect(r).toEqual({
      ok: true,
      criteria: [
        L({ staffIds: ["p1"] }),
        L({ mode: "exclude", conditions: [{ quantifier: "has_none", categories: ["work"], shiftTypeIds: [], exceptIds: ["s-icu"] }] }),
        L({ employmentTypeIds: ["fb"], minFtePercentage: 0.2, maxFtePercentage: 0.8 }),
      ],
    });
  });

  it("missing or null criteria is an empty list", () => {
    expect(parse(null)).toEqual({ ok: true, criteria: [] });
    expect(parse(undefined)).toEqual({ ok: true, criteria: [] });
  });

  it("drops lines with nothing set (they would do nothing)", () => {
    expect(parse([L(), L({ mode: "exclude" }), L({ staffIds: ["p2"] })])).toEqual({ ok: true, criteria: [L({ staffIds: ["p2"] })] });
  });

  it("refuses a bad mode, a non-array, a non-object line", () => {
    for (const bad of [[L({ mode: "maybe" })], "x", [null], [L({ staffIds: "p1" })], [L({ employmentTypeIds: [3] })]]) {
      const r = parse(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });

  it("refuses FTE min above max, and non-numbers", () => {
    const r = parse([L({ minFtePercentage: 0.8, maxFtePercentage: 0.2 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.body.error).toMatch(/FTE/);
    expect(parse([L({ minFtePercentage: "abc" })]).ok).toBe(false);
  });

  it("keeps a person removed since the page loaded (matches nobody), refuses one listed twice", () => {
    expect(parse([L({ staffIds: ["gone"] })])).toEqual({ ok: true, criteria: [L({ staffIds: ["gone"] })] });
    expect(parse([L({ staffIds: ["p1", "p1"] })]).ok).toBe(false);
  });

  it("shift ids go through the same checks as before: a code is a stale tab (409), an unknown id is 400", () => {
    const stale = parse([L({ conditions: [{ quantifier: "has_any", categories: [], shiftTypeIds: ["ICU"], exceptIds: [] }] })]);
    expect(stale).toEqual({ ok: false, status: 409, body: STALE_CLIENT });
    const unknown = parse([L({ conditions: [{ quantifier: "has_any", categories: [], shiftTypeIds: ["s-zzz"], exceptIds: [] }] })]);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.status).toBe(400);
  });

  it(`caps a column at ${MAX_CRITERIA_LINES} lines`, () => {
    const many = Array.from({ length: MAX_CRITERIA_LINES + 1 }, () => L({ staffIds: ["p1"] }));
    expect(parse(many).ok).toBe(false);
    expect(parse(many.slice(1)).ok).toBe(true);
  });
});

describe("legacyMirror: what the old single-rule fields hold, for a code rollback", () => {
  const cond = { quantifier: "has_any", categories: ["work"], shiftTypeIds: [], exceptIds: [] };
  it("no lines → the empty rule", () => {
    expect(legacyMirror([])).toEqual({ employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions: [] });
  });
  it("one Include line without people → that rule", () => {
    expect(legacyMirror([L({ employmentTypeIds: ["fb"], maxFtePercentage: 0.5, conditions: [cond] }) as never]))
      .toEqual({ employmentTypeIds: ["fb"], minFtePercentage: null, maxFtePercentage: 0.5, conditions: [cond] });
  });
  it("anything the old rule cannot express → null (leave the stored fields alone)", () => {
    expect(legacyMirror([L({ staffIds: ["p1"] }) as never])).toBeNull();
    expect(legacyMirror([L({ mode: "exclude", employmentTypeIds: ["fb"] }) as never])).toBeNull();
    expect(legacyMirror([L({ employmentTypeIds: ["a"] }) as never, L({ employmentTypeIds: ["b"] }) as never])).toBeNull();
  });
});

describe("buildCriteriaSave: the client payload", () => {
  it("drops inert lines and condition shift codes; keeps every person, removed ones too", () => {
    const out = buildCriteriaSave([
      L() as never,
      L({ staffIds: ["p1", "gone", "p1"] }) as never,
      L({ mode: "exclude", conditions: [{ quantifier: "has_any", categories: [], shiftTypeIds: ["s-icu"], exceptIds: [], codes: ["ICU"], except: [] }] }) as never,
    ]);
    expect(out).toEqual([
      L({ staffIds: ["p1", "gone"] }),
      L({ mode: "exclude", conditions: [{ quantifier: "has_any", categories: [], shiftTypeIds: ["s-icu"], exceptIds: [] }] }),
    ]);
  });
});

describe("coerceCriteria: the stored JSON", () => {
  it("NULL (a row from before rule lines) stays null; junk entries are dropped", async () => {
    const { coerceCriteria } = await import("../print-criteria");
    expect(coerceCriteria(null)).toBeNull();
    expect(coerceCriteria({})).toBeNull();
    expect(coerceCriteria([null, 3, { mode: "exclude", staffIds: ["a", 2], minFtePercentage: "x" }])).toEqual([
      L({ mode: "exclude", staffIds: ["a"] }),
    ]);
  });
});

describe("liveCriteria: an edit by an older server during a rollback wins (Codex r1 warning)", () => {
  it("downgrade → old save changes the FTE → upgrade: the single rule applies again", async () => {
    const { liveCriteria, legacySnapshot } = await import("../print-criteria");
    const cond = { quantifier: "has_any", categories: ["work"], shiftTypeIds: ["s-or", "s-icu"], exceptIds: [] };
    const legacy = { isOther: false, conditionScope: "month", employmentTypeIds: ["b", "a"], minFtePercentage: null, maxFtePercentage: 0.5, conditions: [cond] };
    const lines = [L({ mode: "exclude", staffIds: ["p1"] })];
    const row = { ...legacy, criteria: lines, criteriaBase: legacySnapshot(legacy) };
    expect(liveCriteria(row)).toEqual(lines);
    // An old save of identical values (ids in another order) keeps the lines.
    expect(liveCriteria({ ...row, employmentTypeIds: ["a", "b"], conditions: [{ ...cond, shiftTypeIds: ["s-icu", "s-or"] }] })).toEqual(lines);
    // An old save that changed the rule: the single rule wins.
    expect(liveCriteria({ ...row, maxFtePercentage: 0.6 })).toBeNull();
    expect(liveCriteria({ ...row, isOther: true })).toBeNull();
    expect(liveCriteria({ ...row, conditionScope: "day" })).toBeNull(); // Codex r2: scope too
    // Lines without a base (never written that way) and rows without lines: the single rule.
    expect(liveCriteria({ ...row, criteriaBase: null })).toBeNull();
    expect(liveCriteria({ ...row, criteria: null })).toBeNull();
  });

  // Codex r1 (REVIEW #1478) CRITICAL: PostgreSQL jsonb does not keep object key order (it sorts
  // keys by length, then bytes), so the stored base comes back with its keys reordered.
  it("a criteriaBase read back from jsonb (keys reordered at every level) still matches", async () => {
    const { liveCriteria, legacySnapshot } = await import("../print-criteria");
    const jsonbOrder = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(jsonbOrder);
      if (!v || typeof v !== "object") return v;
      const keys = Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(keys.map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]));
    };
    const cond = { quantifier: "has_none", categories: ["work"], shiftTypeIds: [], exceptIds: ["s-icu"] };
    const legacy = { isOther: true, conditionScope: "month", employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions: [cond] };
    const lines = [L({ mode: "exclude", conditions: [cond] })];
    const base = jsonbOrder(legacySnapshot(legacy));
    expect(JSON.stringify(base)).not.toBe(JSON.stringify(legacySnapshot(legacy))); // really reordered
    expect(liveCriteria({ ...legacy, criteria: jsonbOrder(lines), criteriaBase: base })).toEqual(lines);
    // A real change is still seen through the reordering.
    expect(liveCriteria({ ...legacy, maxFtePercentage: 0.5, criteria: lines, criteriaBase: base })).toBeNull();
  });
});
