import { describe, it, expect } from "vitest";
import {
  computeAggregateColumns,
  effectiveCriteria,
  isInertLine,
  type AggregateColumn,
  type CriteriaLine,
} from "../print-aggregate-columns";
import type { PrintVisStaff, ShiftKind, ShiftCondition } from "../print-column-visibility";

// Card #309: a printed aggregate column (e.g. "Other") takes several rule lines, each Include or
// Exclude. Listed when the person matches ANY Include line and NO Exclude line. On a catch-all,
// Include adds people to the leftovers and Exclude removes them. criteria null = the old single rule.

const kindById = new Map<string, ShiftKind>([
  ["OR", "work"], ["ICU", "work"], ["CARD", "work"], ["AL", "leave"], ["x", "off"],
]);
const p = (id: string, et = "fte", pct: number | null = 1): PrintVisStaff => ({ id, employmentTypeId: et, ftePercentage: pct });

const col = (over: Partial<AggregateColumn> = {}): AggregateColumn => ({
  label: "Col", enabled: true, isOther: false, suppressMembers: true, conditionScope: "month",
  employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions: [], ...over,
});
const other = (over: Partial<AggregateColumn> = {}): AggregateColumn =>
  col({ label: "Other", isOther: true, suppressMembers: false, ...over });
const line = (over: Partial<CriteriaLine> = {}): CriteriaLine => ({
  mode: "include", employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions: [], staffIds: [], ...over,
});
const cond = (quantifier: string, over: Partial<ShiftCondition> = {}): ShiftCondition => ({
  quantifier, categories: [], shiftTypeIds: [], exceptIds: [], ...over,
});

type Schedule = Record<string, Record<string, string>>;
function run(staff: PrintVisStaff[], vis: ReadonlySet<string> | null, cols: AggregateColumn[], dates: string[], schedule: Schedule) {
  const month = new Map<string, Set<string>>();
  for (const [id, days] of Object.entries(schedule)) month.set(id, new Set(Object.values(days)));
  return computeAggregateColumns(
    staff, vis, cols, dates, month,
    (id, d) => schedule[id]?.[d],
    kindById,
    (id, d) => schedule[id]?.[d] != null && kindById.get(schedule[id][d]) !== "off",
  );
}
const on = (res: ReturnType<typeof run>, label: string, d: string) => res.columns.find((c) => c.label === label)!.memberIdsByDate[d];

// "Only works ICU": has an ICU shift and no work shift other than ICU.
const onlyIcu = (mode: "include" | "exclude" = "exclude") =>
  line({ mode, conditions: [cond("has_any", { shiftTypeIds: ["ICU"] }), cond("has_none", { categories: ["work"], exceptIds: ["ICU"] })] });

describe("effectiveCriteria: null criteria = the old single rule (card #309)", () => {
  it("a named column with a rule becomes one Include line", () => {
    const c = col({ employmentTypeIds: ["fb"], minFtePercentage: 0.2, maxFtePercentage: 0.8, conditions: [cond("has_any", { categories: ["work"] })] });
    expect(effectiveCriteria(c)).toEqual([
      line({ employmentTypeIds: ["fb"], minFtePercentage: 0.2, maxFtePercentage: 0.8, conditions: [cond("has_any", { categories: ["work"] })] }),
    ]);
  });
  it("a named column with no rule, and a catch-all, have no lines", () => {
    expect(effectiveCriteria(col())).toEqual([]);
    expect(effectiveCriteria(col({ criteria: null }))).toEqual([]);
    expect(effectiveCriteria(other({ employmentTypeIds: ["fb"] }))).toEqual([]);
  });
  it("stored criteria win over the legacy fields", () => {
    const lines = [line({ mode: "exclude", staffIds: ["a"] })];
    expect(effectiveCriteria(col({ employmentTypeIds: ["fb"], criteria: lines }))).toEqual(lines);
  });
});

describe("isInertLine", () => {
  it("a line with nothing set is inert; any one setting makes it active", () => {
    expect(isInertLine(line())).toBe(true);
    expect(isInertLine(line({ conditions: [cond("has_any")] }))).toBe(true); // a condition with no selector
    expect(isInertLine(line({ staffIds: ["a"] }))).toBe(false);
    expect(isInertLine(line({ employmentTypeIds: ["fb"] }))).toBe(false);
    expect(isInertLine(line({ minFtePercentage: 0 }))).toBe(false);
    expect(isInertLine(line({ conditions: [cond("has_none", { categories: ["leave"] })] }))).toBe(false);
  });
});

describe("computeAggregateColumns with rule lines (card #309)", () => {
  const D = ["d1", "d2"];

  it("several Include lines are OR'd", () => {
    const staff = [p("a", "fb"), p("b", "fte", 0.4), p("c", "fte", 1)];
    const c = col({ label: "PT", criteria: [line({ employmentTypeIds: ["fb"] }), line({ maxFtePercentage: 0.5 })] });
    const res = run(staff, null, [c], D, { a: { d1: "OR" }, b: { d1: "OR" }, c: { d1: "OR" } });
    expect(on(res, "PT", "d1")).toEqual(["a", "b"]);
  });

  it("an Exclude line wins over an Include line; no Include lines = everyone", () => {
    const staff = [p("a"), p("b"), p("c")];
    const sched = { a: { d1: "OR" }, b: { d1: "OR" }, c: { d1: "OR" } };
    const res = run(staff, null, [col({ label: "X", criteria: [line({ staffIds: ["a", "b"] }), line({ mode: "exclude", staffIds: ["b"] })] })], D, sched);
    expect(on(res, "X", "d1")).toEqual(["a"]);
    const res2 = run(staff, null, [col({ label: "Y", criteria: [line({ mode: "exclude", staffIds: ["c"] })] })], D, sched);
    expect(on(res2, "Y", "d1")).toEqual(["a", "b"]);
  });

  it("named people lines combine with the other parts of the line (AND)", () => {
    const staff = [p("a", "fb"), p("b", "fte")];
    const res = run(staff, null, [col({ label: "X", criteria: [line({ staffIds: ["a", "b"], employmentTypeIds: ["fb"] })] })], D,
      { a: { d1: "OR" }, b: { d1: "OR" } });
    expect(on(res, "X", "d1")).toEqual(["a"]);
  });

  it("inert lines are ignored in both modes (a blank Exclude never empties a column)", () => {
    const staff = [p("a"), p("b")];
    const sched = { a: { d1: "OR" }, b: { d1: "OR" } };
    const res = run(staff, null, [col({ label: "X", criteria: [line({ mode: "exclude" }), line({ staffIds: ["a"] }), line()] })], D, sched);
    expect(on(res, "X", "d1")).toEqual(["a"]);
  });

  it("the render gate still applies: Include never lists someone on an unscheduled or off day", () => {
    const res = run([p("a")], null, [col({ label: "X", criteria: [line({ staffIds: ["a"] })] })], D, { a: { d1: "OR", d2: "x" } });
    expect(on(res, "X", "d1")).toEqual(["a"]);
    expect(on(res, "X", "d2")).toEqual([]);
  });

  it("David's example: Other leaves out whoever only works ICU that month; a mixed ICU+OR person stays", () => {
    const staff = [p("icu"), p("mix"), p("or")];
    const sched = { icu: { d1: "ICU", d2: "ICU" }, mix: { d1: "ICU", d2: "OR" }, or: { d1: "OR" } };
    const res = run(staff, new Set(), [other({ criteria: [onlyIcu()] })], D, sched);
    expect(on(res, "Other", "d1")).toEqual(["mix", "or"]);
    expect(on(res, "Other", "d2")).toEqual(["mix"]);
  });

  it("…and with leave in the month the ICU-only person is still left out", () => {
    const res = run([p("icu")], new Set(), [other({ criteria: [onlyIcu()] })], D, { icu: { d1: "ICU", d2: "AL" } });
    expect(on(res, "Other", "d1")).toEqual([]);
    expect(on(res, "Other", "d2")).toEqual([]);
  });

  it("catch-all, day scope: Exclude 'has ICU' drops people only on their ICU days", () => {
    const res = run([p("mix")], new Set(), [other({ conditionScope: "day", criteria: [line({ mode: "exclude", conditions: [cond("has_any", { shiftTypeIds: ["ICU"] })] })] })],
      D, { mix: { d1: "ICU", d2: "OR" } });
    expect(on(res, "Other", "d1")).toEqual([]);
    expect(on(res, "Other", "d2")).toEqual(["mix"]);
  });

  it("catch-all Include adds people who print elsewhere, keeps the leftovers, and claims no ownership", () => {
    const staff = [p("ind"), p("own"), p("left")];
    const sched = { ind: { d1: "OR" }, own: { d1: "OR" }, left: { d1: "OR" } };
    const res = run(staff, new Set(["ind"]), [
      col({ label: "Owned", criteria: [line({ staffIds: ["own"] })] }),
      other({ criteria: [line({ staffIds: ["ind", "own"] })] }),
    ], D, sched);
    expect(on(res, "Other", "d1")).toEqual(["ind", "own", "left"]);
    expect(on(res, "Owned", "d1")).toEqual(["own"]);
  });

  it("catch-all: Exclude beats its own Include", () => {
    const res = run([p("a")], new Set(["a"]), [other({ criteria: [line({ staffIds: ["a"] }), line({ mode: "exclude", staffIds: ["a"] })] })], D, { a: { d1: "OR" } });
    expect(on(res, "Other", "d1")).toEqual([]);
  });

  it("a catch-all with no active lines keeps the old residual, and ignores day scope", () => {
    const staff = [p("a"), p("b")];
    const sched = { a: { d1: "OR" }, b: { d1: "ICU" } };
    const plain = run(staff, new Set(["a"]), [other()], D, sched);
    const inert = run(staff, new Set(["a"]), [other({ conditionScope: "day", criteria: [line({ mode: "exclude" })] })], D, sched);
    expect(on(plain, "Other", "d1")).toEqual(["b"]);
    expect(on(inert, "Other", "d1")).toEqual(["b"]);
  });

  it("named columns: suppression and first-match ownership work with lines, and the catch-all residual follows", () => {
    const staff = [p("a"), p("b")];
    const sched = { a: { d1: "OR" }, b: { d1: "OR" } };
    const res = run(staff, null, [
      col({ label: "A", criteria: [line({ staffIds: ["a"] })] }),
      col({ label: "B", criteria: [line({ mode: "exclude", staffIds: ["b"] })] }),
      other(),
    ], D, sched);
    expect(on(res, "A", "d1")).toEqual(["a"]);
    expect(on(res, "B", "d1")).toEqual([]); // a owned by A first; b excluded
    expect([...res.suppressedIndividualIds]).toEqual(["a"]);
    expect(on(res, "Other", "d1")).toEqual([]); // b prints individually
  });
});

describe("legacy rows give exactly today's output (criteria null vs explicit lines)", () => {
  const staff = [p("a", "fb", null), p("b", "fte", 0.4), p("c", "fte", 1), p("d", "fte", 0.8)];
  const sched: Schedule = {
    a: { d1: "OR", d2: "ICU" }, b: { d1: "ICU", d2: "AL" }, c: { d1: "OR", d2: "x" }, d: { d2: "CARD" },
  };
  const D = ["d1", "d2"];
  const variants: Partial<AggregateColumn>[] = [
    {},
    { employmentTypeIds: ["fb"] },
    { minFtePercentage: 0.5 },
    { maxFtePercentage: 0.5, conditions: [cond("has_any", { shiftTypeIds: ["ICU"] })] },
    { conditions: [cond("has_none", { categories: ["work"], exceptIds: ["ICU"] })] },
    { conditions: [cond("has_any", { shiftTypeIds: ["ICU"] })], conditionScope: "day" },
    { suppressMembers: false, employmentTypeIds: ["fte"] },
  ];
  for (const [i, v] of variants.entries()) {
    it(`variant ${i}`, () => {
      const legacy = [col({ label: "N", ...v }), other()];
      const explicit = legacy.map((c) => ({ ...c, criteria: effectiveCriteria(c) }));
      for (const vis of [null, new Set(["c"]), new Set<string>()]) {
        expect(run(staff, vis, explicit, D, sched)).toEqual(run(staff, vis, legacy, D, sched));
      }
    });
  }
});

describe("people who have left (Codex r1 CRITICAL)", () => {
  it("an Include line naming only removed people lists nobody, never everyone", () => {
    const res = run([p("a"), p("b")], null, [col({ label: "X", criteria: [line({ staffIds: ["gone"] })] })], ["d1"], { a: { d1: "OR" }, b: { d1: "OR" } });
    expect(on(res, "X", "d1")).toEqual([]);
  });
  it("an Exclude line naming a removed person changes nothing", () => {
    const res = run([p("a")], new Set(), [other({ criteria: [line({ mode: "exclude", staffIds: ["gone"] })] })], ["d1"], { a: { d1: "OR" } });
    expect(on(res, "Other", "d1")).toEqual(["a"]);
  });
});
