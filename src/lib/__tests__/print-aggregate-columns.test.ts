import { describe, it, expect } from "vitest";
import { computeAggregateColumns, coerceConditionScope, type AggregateColumn } from "../print-aggregate-columns";
import type { PrintVisStaff, ShiftKind } from "../print-column-visibility";

describe("coerceConditionScope", () => {
  it('maps only "day" to "day"; everything else (incl. stale/malformed) to "month"', () => {
    expect(coerceConditionScope("day")).toBe("day");
    expect(coerceConditionScope("month")).toBe("month");
    expect(coerceConditionScope(undefined)).toBe("month");
    expect(coerceConditionScope(null)).toBe("month");
    expect(coerceConditionScope("DAY")).toBe("month");
    expect(coerceConditionScope("weekly")).toBe("month");
    expect(coerceConditionScope(1)).toBe("month");
  });
});

describe("computeAggregateColumns", () => {
  const fte = (id: string, pct: number | null = 1): PrintVisStaff => ({ id, employmentTypeId: "fte", ftePercentage: pct });
  const fb = (id: string): PrintVisStaff => ({ id, employmentTypeId: "feebasis", ftePercentage: null });

  const kindByCode = new Map<string, ShiftKind>([
    ["OR", "work"], ["ICU", "work"], ["AL", "leave"], ["x", "off"],
  ]);

  const col = (over: Partial<AggregateColumn> = {}): AggregateColumn => ({
    label: "Col",
    enabled: true,
    isOther: false,
    suppressMembers: true,
    conditionScope: "month",
    employmentTypeIds: [],
    minFtePercentage: null,
    maxFtePercentage: null,
    conditions: [],
    ...over,
  });
  const other = (over: Partial<AggregateColumn> = {}): AggregateColumn =>
    col({ label: "Other", isOther: true, suppressMembers: false, ...over });

  // Build the per-day inputs from a simple { staffId: { date: code } } schedule.
  type Schedule = Record<string, Record<string, string>>;
  function build(schedule: Schedule) {
    const monthCodes = new Map<string, Set<string>>();
    for (const [id, days] of Object.entries(schedule)) {
      const set = new Set<string>();
      for (const code of Object.values(days)) set.add(code);
      if (set.size > 0) monthCodes.set(id, set);
    }
    const codeByStaffDate = (id: string, date: string) => schedule[id]?.[date];
    const isScheduledNonOff = (id: string, date: string) => {
      const code = schedule[id]?.[date];
      return code != null && kindByCode.get(code) !== "off";
    };
    return { monthCodes, codeByStaffDate, isScheduledNonOff };
  }

  function run(
    staff: PrintVisStaff[],
    vis: ReadonlySet<string> | null,
    cols: AggregateColumn[],
    dates: string[],
    schedule: Schedule,
  ) {
    const { monthCodes, codeByStaffDate, isScheduledNonOff } = build(schedule);
    return computeAggregateColumns(staff, vis, cols, dates, monthCodes, codeByStaffDate, kindByCode, isScheduledNonOff);
  }

  const idsOn = (res: ReturnType<typeof computeAggregateColumns>, label: string, date: string) =>
    res.columns.find((c) => c.label === label)!.memberIdsByDate[date];

  const D = ["d1", "d2"];

  it("returns no columns and no suppression when there are no aggregate columns", () => {
    const res = run([fte("a")], null, [], D, { a: { d1: "OR" } });
    expect(res.columns).toEqual([]);
    expect(res.suppressedIndividualIds.size).toBe(0);
  });

  it("named column lists matching staff per scheduled day and suppresses them when suppressMembers", () => {
    const staff = [fte("a"), fb("b"), fb("c")];
    const cols = [col({ label: "FB", employmentTypeIds: ["feebasis"] })];
    // b works both days; c only d1.
    const res = run(staff, null, cols, D, { a: { d1: "OR", d2: "OR" }, b: { d1: "OR", d2: "OR" }, c: { d1: "OR" } });
    expect(idsOn(res, "FB", "d1")).toEqual(["b", "c"]);
    expect(idsOn(res, "FB", "d2")).toEqual(["b"]); // c not scheduled d2
    expect(res.suppressedIndividualIds).toEqual(new Set(["b", "c"])); // owned on ≥1 day
  });

  it("does NOT suppress members when suppressMembers is false (co-exist)", () => {
    const staff = [fte("a"), fb("b")];
    const cols = [col({ label: "FB", employmentTypeIds: ["feebasis"], suppressMembers: false })];
    const res = run(staff, null, cols, D, { b: { d1: "OR" } });
    expect(idsOn(res, "FB", "d1")).toEqual(["b"]);
    expect(res.suppressedIndividualIds.size).toBe(0);
  });

  it("month scope: global first-match — a member stays in the first column every scheduled day", () => {
    const staff = [fb("a")];
    const cols = [
      col({ label: "First", employmentTypeIds: ["feebasis"] }),
      col({ label: "Second", employmentTypeIds: ["feebasis"] }),
    ];
    const res = run(staff, null, cols, D, { a: { d1: "OR", d2: "ICU" } });
    expect(idsOn(res, "First", "d1")).toEqual(["a"]);
    expect(idsOn(res, "First", "d2")).toEqual(["a"]);
    expect(idsOn(res, "Second", "d1")).toEqual([]);
    expect(idsOn(res, "Second", "d2")).toEqual([]);
  });

  it("DAY scope: per-day first-match — OR Monday / ICU Tuesday land in their own columns (the #784 case)", () => {
    const staff = [fte("a")];
    const cols = [
      col({ label: "OR", conditionScope: "day", suppressMembers: false, conditions: [{ quantifier: "has_any", categories: [], codes: ["OR"], except: [] }] }),
      col({ label: "ICU", conditionScope: "day", suppressMembers: false, conditions: [{ quantifier: "has_any", categories: [], codes: ["ICU"], except: [] }] }),
    ];
    const res = run(staff, null, cols, D, { a: { d1: "OR", d2: "ICU" } });
    expect(idsOn(res, "OR", "d1")).toEqual(["a"]);
    expect(idsOn(res, "OR", "d2")).toEqual([]);
    expect(idsOn(res, "ICU", "d1")).toEqual([]);
    expect(idsOn(res, "ICU", "d2")).toEqual(["a"]);
  });

  it("DAY scope, no conditions: shows on every scheduled non-off day, never on unscheduled days", () => {
    const staff = [fte("a")];
    const cols = [col({ label: "Any", conditionScope: "day", suppressMembers: false })];
    const res = run(staff, null, cols, D, { a: { d1: "OR" } }); // not scheduled d2
    expect(idsOn(res, "Any", "d1")).toEqual(["a"]);
    expect(idsOn(res, "Any", "d2")).toEqual([]);
  });

  it("render gate: leave renders; off never renders even when a condition targets off", () => {
    const staff = [fte("a")];
    // a: leave (AL) d1, off (x) d2.
    const schedule = { a: { d1: "AL", d2: "x" } };
    const leaveCol = col({ label: "L", conditionScope: "day", suppressMembers: false, conditions: [{ quantifier: "has_any", categories: ["leave"], codes: [], except: [] }] });
    const offCol = col({ label: "O", conditionScope: "day", suppressMembers: false, conditions: [{ quantifier: "has_any", categories: ["off"], codes: [], except: [] }] });
    const resL = run(staff, null, [leaveCol], D, schedule);
    expect(idsOn(resL, "L", "d1")).toEqual(["a"]); // leave is not off → renders
    const resO = run(staff, null, [offCol], D, schedule);
    expect(idsOn(resO, "O", "d2")).toEqual([]); // off gated out of aggregate columns
  });

  it("ignores dates outside the provided in-month set (padding rows can't own or suppress)", () => {
    const staff = [fte("a")];
    // A day-scoped suppressing column. `a` matches OR only on d2, which is NOT passed as an
    // in-month date below (it stands in for a leading/trailing padding row). On the only
    // in-month day d1, `a` has an off shift → not scheduled. Must not own or suppress.
    const cols = [col({ label: "OR", conditionScope: "day", suppressMembers: true, conditions: [{ quantifier: "has_any", categories: [], codes: ["OR"], except: [] }] })];
    const res = run(staff, null, cols, ["d1"], { a: { d1: "x", d2: "OR" } });
    expect(idsOn(res, "OR", "d1")).toEqual([]);
    expect(res.suppressedIndividualIds.size).toBe(0); // d2 is outside the in-month set
  });

  it("month scope: matches shift conditions via the shared rule matcher (whole-month codes)", () => {
    const staff = [fte("a"), fte("b")];
    const cols = [col({ label: "ICU team", suppressMembers: false, conditions: [{ quantifier: "has_any", categories: [], codes: ["ICU"], except: [] }] })];
    // a does ICU once in the month → member every scheduled day; b never does ICU.
    const res = run(staff, null, cols, D, { a: { d1: "ICU", d2: "OR" }, b: { d1: "OR", d2: "OR" } });
    expect(idsOn(res, "ICU team", "d1")).toEqual(["a"]);
    expect(idsOn(res, "ICU team", "d2")).toEqual(["a"]); // month membership → shows on d2 too
  });

  it("malformed stored conditionScope behaves as month, not a third behavior", () => {
    const staff = [fte("a")];
    const cols = [col({ label: "OR", conditionScope: "garbage" as unknown as string, suppressMembers: false, conditions: [{ quantifier: "has_any", categories: [], codes: ["OR"], except: [] }] })];
    const res = run(staff, null, cols, D, { a: { d1: "OR", d2: "ICU" } });
    // month behavior: member matched the month (has OR) → shows on every scheduled day.
    expect(idsOn(res, "OR", "d1")).toEqual(["a"]);
    expect(idsOn(res, "OR", "d2")).toEqual(["a"]);
  });

  it("disabled columns are ignored entirely", () => {
    const staff = [fb("a")];
    const cols = [col({ label: "Off", employmentTypeIds: ["feebasis"], enabled: false })];
    const res = run(staff, null, cols, D, { a: { d1: "OR" } });
    expect(res.columns).toEqual([]);
    expect(res.suppressedIndividualIds.size).toBe(0);
  });

  it("preserves input column order in the output", () => {
    const staff = [fte("a"), fb("b")];
    const cols = [other(), col({ label: "FB", employmentTypeIds: ["feebasis"] })];
    const res = run(staff, new Set(["a"]), cols, D, { a: { d1: "OR" }, b: { d1: "OR" } });
    expect(res.columns.map((c) => c.label)).toEqual(["Other", "FB"]);
  });

  describe("catch-all (isOther) residual, per day", () => {
    it("is empty when everyone has an individual column", () => {
      const staff = [fte("a"), fte("b")];
      const res = run(staff, null, [other()], D, { a: { d1: "OR" }, b: { d1: "OR" } });
      expect(idsOn(res, "Other", "d1")).toEqual([]);
    });

    it("catches a scheduled staff with no printed individual column and no named column", () => {
      const staff = [fte("a"), fb("c")];
      // individualVisible excludes c; c works d1 only.
      const res = run(staff, new Set(["a"]), [other()], D, { a: { d1: "OR" }, c: { d1: "OR" } });
      expect(idsOn(res, "Other", "d1")).toEqual(["c"]);
      expect(idsOn(res, "Other", "d2")).toEqual([]); // c not scheduled d2
    });

    it("a member claimed by a suppressing named column is NOT also in Other on owned days", () => {
      const staff = [fb("b")];
      const cols = [col({ label: "FB", employmentTypeIds: ["feebasis"], suppressMembers: true }), other()];
      const res = run(staff, null, cols, D, { b: { d1: "OR" } });
      expect(res.suppressedIndividualIds).toEqual(new Set(["b"]));
      expect(idsOn(res, "FB", "d1")).toEqual(["b"]);
      expect(idsOn(res, "Other", "d1")).toEqual([]); // b is in FB on d1, not Other
    });

    it("Other picks up a suppressed member on a day its day-scoped column does NOT own them", () => {
      const staff = [fte("a")];
      // Day-scoped suppressing OR column owns a only on the OR day.
      const cols = [
        col({ label: "OR", conditionScope: "day", suppressMembers: true, conditions: [{ quantifier: "has_any", categories: [], codes: ["OR"], except: [] }] }),
        other(),
      ];
      const res = run(staff, null, cols, D, { a: { d1: "OR", d2: "ICU" } });
      expect(res.suppressedIndividualIds).toEqual(new Set(["a"])); // owned on d1 → whole column hidden
      expect(idsOn(res, "OR", "d1")).toEqual(["a"]);
      expect(idsOn(res, "OR", "d2")).toEqual([]);
      expect(idsOn(res, "Other", "d1")).toEqual([]); // owned by OR on d1
      expect(idsOn(res, "Other", "d2")).toEqual(["a"]); // suppressed + unowned + scheduled → residual
    });

    it("zero catch-all: no residual column is produced", () => {
      const staff = [fte("a"), fb("b")];
      const cols = [col({ label: "FB", employmentTypeIds: ["feebasis"], suppressMembers: false })];
      const res = run(staff, new Set(["a"]), cols, D, { b: { d1: "OR" } });
      expect(res.columns.map((c) => c.label)).toEqual(["FB"]);
      expect(res.columns.some((c) => c.isOther)).toBe(false);
    });

    it("multiple catch-all columns each show the same residual", () => {
      const staff = [fte("a"), fb("b")];
      const cols = [other({ label: "Other A" }), other({ label: "Other B" })];
      const res = run(staff, new Set(["a"]), cols, D, { b: { d1: "OR" } });
      expect(idsOn(res, "Other A", "d1")).toEqual(["b"]);
      expect(idsOn(res, "Other B", "d1")).toEqual(["b"]);
    });
  });

  it("GOLDEN: mixed month-scoped named + suppress + catch-all (current-behavior regression)", () => {
    // Realistic config: a fee-basis suppressing column, a co-exist ICU column, and a
    // catch-all — all month-scoped (today's only mode). Asserts the full per-day output.
    const staff = [fte("a"), fte("b"), fb("c"), fb("d")];
    const cols = [
      col({ label: "FB", employmentTypeIds: ["feebasis"], suppressMembers: true }), // claims c, d
      col({ label: "ICU", suppressMembers: false, conditions: [{ quantifier: "has_any", categories: [], codes: ["ICU"], except: [] }] }), // a (co-exist)
      other(),
    ];
    // a: ICU d1, OR d2.  b: OR both days (plain).  c: OR d1 only.  d: OR both days.
    const res = run(staff, null, cols, D, {
      a: { d1: "ICU", d2: "OR" },
      b: { d1: "OR", d2: "OR" },
      c: { d1: "OR" },
      d: { d1: "OR", d2: "OR" },
    });
    // FB (suppressing) owns c+d on their scheduled days.
    expect(idsOn(res, "FB", "d1")).toEqual(["c", "d"]);
    expect(idsOn(res, "FB", "d2")).toEqual(["d"]);
    // ICU (co-exist) holds a (matched ICU in the month) every scheduled day.
    expect(idsOn(res, "ICU", "d1")).toEqual(["a"]);
    expect(idsOn(res, "ICU", "d2")).toEqual(["a"]);
    // suppression: only the FB members.
    expect(res.suppressedIndividualIds).toEqual(new Set(["c", "d"]));
    // Other residual: a prints individually (co-exist), b prints individually, c/d suppressed
    // but owned by FB on their scheduled days → nobody lands in Other.
    expect(idsOn(res, "Other", "d1")).toEqual([]);
    expect(idsOn(res, "Other", "d2")).toEqual([]);
  });
});
