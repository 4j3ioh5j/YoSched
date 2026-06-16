import { describe, it, expect } from "vitest";
import {
  matchesWhen,
  monthOrdinalForDate,
  isLastWeekdayOccurrenceInMonth,
  ppOrdinalForDate,
  isLastWeekdayOccurrenceInPP,
  legacyPatternToWhen,
  ruleToWhen,
  buildWhenFromColumns,
  whenToColumns,
  isPlainWeekdayWhen,
  type WhenPattern,
} from "../recurrence";
import { matchesPattern, type PayPeriodRange } from "../availability";

// 4 consecutive 14-day pay periods. 2025-05-11 is a Sunday (PP[0] start).
// Reference weekdays in this range:
//   Tuesdays in May: 6 (1st), 13 (2nd), 20 (3rd), 27 (4th = last)
//   Thursdays in May: 1, 8, 15, 22 (4th), 29 (5th = last)
const PP: PayPeriodRange[] = [
  { startDate: "2025-05-11", endDate: "2025-05-24" }, // PP idx 0
  { startDate: "2025-05-25", endDate: "2025-06-07" }, // PP idx 1
  { startDate: "2025-06-08", endDate: "2025-06-21" }, // PP idx 2
  { startDate: "2025-06-22", endDate: "2025-07-05" }, // PP idx 3
];

function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T12:00:00");
  const last = new Date(end + "T12:00:00");
  while (d <= last) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
    d.setDate(d.getDate() + 1);
  }
  return out;
}
const ALL_DATES = enumerateDates("2025-05-11", "2025-07-05");
const dow = (s: string) => new Date(s + "T12:00:00").getDay();

describe("monthOrdinalForDate", () => {
  it("returns the Nth occurrence of the weekday within the month", () => {
    expect(monthOrdinalForDate("2025-05-06")).toBe(1); // 1st Tue
    expect(monthOrdinalForDate("2025-05-13")).toBe(2); // 2nd Tue
    expect(monthOrdinalForDate("2025-05-20")).toBe(3); // 3rd Tue
    expect(monthOrdinalForDate("2025-05-27")).toBe(4); // 4th Tue
    expect(monthOrdinalForDate("2025-05-29")).toBe(5); // 5th Thu
  });
});

describe("isLastWeekdayOccurrenceInMonth", () => {
  it("is true only for the final occurrence of that weekday in the month", () => {
    expect(isLastWeekdayOccurrenceInMonth("2025-05-27")).toBe(true); // last Tue
    expect(isLastWeekdayOccurrenceInMonth("2025-05-20")).toBe(false); // 3rd Tue
    expect(isLastWeekdayOccurrenceInMonth("2025-05-29")).toBe(true); // last (5th) Thu
    expect(isLastWeekdayOccurrenceInMonth("2025-05-22")).toBe(false); // 4th Thu, not last
  });
});

describe("ppOrdinalForDate / isLastWeekdayOccurrenceInPP", () => {
  it("returns 1 or 2 for the weekday's occurrence within the 14-day PP", () => {
    expect(ppOrdinalForDate("2025-05-13", PP)).toBe(1); // first Tue of PP0
    expect(ppOrdinalForDate("2025-05-20", PP)).toBe(2); // second Tue of PP0
  });
  it("returns null outside any pay period", () => {
    expect(ppOrdinalForDate("2025-01-01", PP)).toBeNull();
  });
  it("flags the last occurrence within the PP", () => {
    expect(isLastWeekdayOccurrenceInPP("2025-05-20", PP)).toBe(true);
    expect(isLastWeekdayOccurrenceInPP("2025-05-13", PP)).toBe(false);
  });
});

describe("matchesWhen — weekday gate", () => {
  const every = (daysOfWeek: number[]): WhenPattern => ({ daysOfWeek, kind: "every" });

  it("matches only the chosen weekday", () => {
    expect(matchesWhen(every([2]), "2025-05-13", PP)).toBe(true); // Tue
    expect(matchesWhen(every([2]), "2025-05-14", PP)).toBe(false); // Wed
  });
  it("[] means any day", () => {
    for (const d of ALL_DATES) expect(matchesWhen(every([]), d, PP)).toBe(true);
  });
  it("supports multiple weekdays in one rule (Mon & Wed)", () => {
    expect(matchesWhen(every([1, 3]), "2025-05-12", PP)).toBe(true); // Mon
    expect(matchesWhen(every([1, 3]), "2025-05-14", PP)).toBe(true); // Wed
    expect(matchesWhen(every([1, 3]), "2025-05-13", PP)).toBe(false); // Tue
  });
  it("supports weekends [Sun, Sat]", () => {
    expect(matchesWhen(every([0, 6]), "2025-05-17", PP)).toBe(true); // Sat
    expect(matchesWhen(every([0, 6]), "2025-05-18", PP)).toBe(true); // Sun
    expect(matchesWhen(every([0, 6]), "2025-05-16", PP)).toBe(false); // Fri
  });
});

describe("matchesWhen — ppWeek", () => {
  it("PP week 1 only", () => {
    const p: WhenPattern = { daysOfWeek: [2], kind: "ppWeek", ppWeek: 1 };
    expect(matchesWhen(p, "2025-05-13", PP)).toBe(true); // PP0 week 1
    expect(matchesWhen(p, "2025-05-20", PP)).toBe(false); // PP0 week 2
  });
  it("PP week 2 only", () => {
    const p: WhenPattern = { daysOfWeek: [2], kind: "ppWeek", ppWeek: 2 };
    expect(matchesWhen(p, "2025-05-20", PP)).toBe(true);
    expect(matchesWhen(p, "2025-05-13", PP)).toBe(false);
  });
});

describe("matchesWhen — ordinalMonth", () => {
  it("1st & 3rd Tuesday of the month", () => {
    const p: WhenPattern = { daysOfWeek: [2], kind: "ordinalMonth", ords: [1, 3] };
    expect(matchesWhen(p, "2025-05-06", PP)).toBe(true); // 1st
    expect(matchesWhen(p, "2025-05-20", PP)).toBe(true); // 3rd
    expect(matchesWhen(p, "2025-05-13", PP)).toBe(false); // 2nd
    expect(matchesWhen(p, "2025-05-27", PP)).toBe(false); // 4th
  });
  it("last (-1) Tuesday of the month", () => {
    const p: WhenPattern = { daysOfWeek: [2], kind: "ordinalMonth", ords: [-1] };
    expect(matchesWhen(p, "2025-05-27", PP)).toBe(true);
    expect(matchesWhen(p, "2025-05-20", PP)).toBe(false);
  });
  it("distinguishes 'last' from a fixed ordinal when a 5th occurrence exists", () => {
    const last: WhenPattern = { daysOfWeek: [4], kind: "ordinalMonth", ords: [-1] };
    const fourth: WhenPattern = { daysOfWeek: [4], kind: "ordinalMonth", ords: [4] };
    expect(matchesWhen(last, "2025-05-29", PP)).toBe(true); // 5th Thu = last
    expect(matchesWhen(last, "2025-05-22", PP)).toBe(false); // 4th Thu, not last
    expect(matchesWhen(fourth, "2025-05-22", PP)).toBe(true);
    expect(matchesWhen(fourth, "2025-05-29", PP)).toBe(false);
  });
});

describe("matchesWhen — ordinalPayPeriod", () => {
  it("1st occurrence of the weekday in the PP", () => {
    const p: WhenPattern = { daysOfWeek: [2], kind: "ordinalPayPeriod", ords: [1] };
    expect(matchesWhen(p, "2025-05-13", PP)).toBe(true);
    expect(matchesWhen(p, "2025-05-20", PP)).toBe(false);
  });
  it("last (-1) occurrence of the weekday in the PP", () => {
    const p: WhenPattern = { daysOfWeek: [2], kind: "ordinalPayPeriod", ords: [-1] };
    expect(matchesWhen(p, "2025-05-20", PP)).toBe(true);
    expect(matchesWhen(p, "2025-05-13", PP)).toBe(false);
  });
});

describe("matchesWhen — cycle (parity / every Nth)", () => {
  it("every other PP (payPeriod unit, n=2)", () => {
    const even: WhenPattern = { daysOfWeek: [2], kind: "cycle", cycleUnit: "payPeriod", cycleN: 2, cycleOffset: 0 };
    const odd: WhenPattern = { daysOfWeek: [2], kind: "cycle", cycleUnit: "payPeriod", cycleN: 2, cycleOffset: 1 };
    expect(matchesWhen(even, "2025-05-13", PP)).toBe(true); // PP0 (even)
    expect(matchesWhen(even, "2025-06-10", PP)).toBe(true); // PP2 (even)
    expect(matchesWhen(even, "2025-05-27", PP)).toBe(false); // PP1 (odd)
    expect(matchesWhen(even, "2025-06-24", PP)).toBe(false); // PP3 (odd)
    expect(matchesWhen(odd, "2025-05-27", PP)).toBe(true); // PP1
    expect(matchesWhen(odd, "2025-06-24", PP)).toBe(true); // PP3
    expect(matchesWhen(odd, "2025-05-13", PP)).toBe(false);
  });
  it("every other week-slot (week unit, n=2) — matches legacy every_n shape", () => {
    const p: WhenPattern = { daysOfWeek: [2], kind: "cycle", cycleUnit: "week", cycleN: 2, cycleOffset: 0 };
    // occurrence = ppIdx*2 + (week2?1:0)
    expect(matchesWhen(p, "2025-05-13", PP)).toBe(true); // PP0 wk1 -> occ 0
    expect(matchesWhen(p, "2025-05-20", PP)).toBe(false); // PP0 wk2 -> occ 1
    expect(matchesWhen(p, "2025-05-27", PP)).toBe(true); // PP1 wk1 -> occ 2
  });
  it("n=1 cycle matches every occurrence", () => {
    const p: WhenPattern = { daysOfWeek: [2], kind: "cycle", cycleUnit: "week", cycleN: 1, cycleOffset: 0 };
    for (const d of ALL_DATES.filter((x) => dow(x) === 2)) expect(matchesWhen(p, d, PP)).toBe(true);
  });
});

describe("legacyPatternToWhen — behavior-identical to legacy matchesPattern", () => {
  // For every legacy rule and date: matchesWhen(legacy) === dowMatch && matchesPattern(legacy)
  const cases: { pattern: string; cycleLength?: number; cycleOffset?: number }[] = [
    { pattern: "every" },
    { pattern: "pp_week_1" },
    { pattern: "pp_week_2" },
    { pattern: "every_n", cycleLength: 2, cycleOffset: 0 },
    { pattern: "every_n", cycleLength: 2, cycleOffset: 1 },
    { pattern: "every_n", cycleLength: 3, cycleOffset: 0 },
    { pattern: "every_n", cycleLength: 3, cycleOffset: 2 },
    { pattern: "every_n", cycleLength: 4, cycleOffset: 1 },
  ];

  it("matches across every weekday, pattern, and date in range", () => {
    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
      for (const c of cases) {
        const legacy = { dayOfWeek, ...c };
        const when = legacyPatternToWhen(legacy);
        for (const date of ALL_DATES) {
          const expected = dow(date) === dayOfWeek && matchesPattern(legacy, date, PP);
          expect(matchesWhen(when, date, PP)).toBe(expected);
        }
      }
    }
  });
});

describe("ruleToWhen — discriminator + fallback boundary", () => {
  it("null whenKind falls back to the legacy columns", () => {
    const legacy = { dayOfWeek: 2, pattern: "every_n", cycleLength: 2, cycleOffset: 0 };
    const when = ruleToWhen(legacy); // whenKind undefined
    expect(when).toEqual(legacyPatternToWhen(legacy));
    expect(matchesWhen(when, "2025-05-13", PP)).toBe(true); // PP0 wk1
    expect(matchesWhen(when, "2025-05-20", PP)).toBe(false); // PP0 wk2
  });

  it("non-null whenKind uses the explicit WHEN columns (ignores legacy fields)", () => {
    // Legacy fields say "every Monday"; explicit columns say "1st & 3rd Tuesday".
    const row = {
      dayOfWeek: 1,
      pattern: "every",
      whenKind: "ordinalMonth",
      whenDays: [2],
      whenOrds: [1, 3],
    };
    const when = ruleToWhen(row);
    expect(matchesWhen(when, "2025-05-06", PP)).toBe(true); // 1st Tue
    expect(matchesWhen(when, "2025-05-20", PP)).toBe(true); // 3rd Tue
    expect(matchesWhen(when, "2025-05-12", PP)).toBe(false); // a Monday (legacy would match)
    expect(matchesWhen(when, "2025-05-13", PP)).toBe(false); // 2nd Tue
  });

  it("explicit whenKind with empty whenDays means any day", () => {
    const when = buildWhenFromColumns({ dayOfWeek: 0, pattern: "every", whenKind: "every", whenDays: [] });
    for (const d of ALL_DATES) expect(matchesWhen(when, d, PP)).toBe(true);
  });

  describe("malformed explicit rows have a deterministic, documented boundary", () => {
    it("kind='ppWeek' with null whenPpWeek matches nothing", () => {
      const when = buildWhenFromColumns({ dayOfWeek: 2, pattern: "every", whenKind: "ppWeek", whenDays: [2] });
      expect(matchesWhen(when, "2025-05-13", PP)).toBe(false);
      expect(matchesWhen(when, "2025-05-20", PP)).toBe(false);
    });
    it("kind='cycle' with null whenCycleN falls to n=1 (matches every occurrence)", () => {
      const when = buildWhenFromColumns({ dayOfWeek: 2, pattern: "every", whenKind: "cycle", whenDays: [2], whenCycleUnit: "week" });
      for (const d of ALL_DATES.filter((x) => dow(x) === 2)) expect(matchesWhen(when, d, PP)).toBe(true);
    });
  });
});

describe("matchesWhen — outside known pay periods", () => {
  const OUT = "2025-09-01"; // after PP[3] (ends 2025-07-05)
  it("PP-anchored kinds do not apply outside known PPs", () => {
    expect(matchesWhen({ daysOfWeek: [], kind: "ppWeek", ppWeek: 1 }, OUT, PP)).toBe(false);
    expect(matchesWhen({ daysOfWeek: [], kind: "ordinalPayPeriod", ords: [1] }, OUT, PP)).toBe(false);
    expect(matchesWhen({ daysOfWeek: [], kind: "cycle", cycleUnit: "payPeriod", cycleN: 2, cycleOffset: 0 }, OUT, PP)).toBe(false);
  });
  it("cycle 'week' keeps legacy every_n behavior (matches) outside known PPs", () => {
    expect(matchesWhen({ daysOfWeek: [], kind: "cycle", cycleUnit: "week", cycleN: 2, cycleOffset: 0 }, OUT, PP)).toBe(true);
  });
});

describe("matchesWhen — unknown kind fails closed", () => {
  it("an invalid persisted kind matches nothing (does not broaden the rule)", () => {
    const bogus = { daysOfWeek: [], kind: "garbage" } as unknown as WhenPattern;
    for (const d of ALL_DATES) expect(matchesWhen(bogus, d, PP)).toBe(false);
  });
});

describe("whenToColumns — serialization", () => {
  it("round-trips through buildWhenFromColumns with identical matching", () => {
    const patterns: WhenPattern[] = [
      { daysOfWeek: [2], kind: "ordinalMonth", ords: [1, 3] },
      { daysOfWeek: [2], kind: "ordinalMonth", ords: [-1] },
      { daysOfWeek: [2], kind: "ppWeek", ppWeek: 2 },
      { daysOfWeek: [2], kind: "cycle", cycleUnit: "payPeriod", cycleN: 2, cycleOffset: 1 },
      { daysOfWeek: [1, 3, 5], kind: "every" },
    ];
    for (const w of patterns) {
      const round = buildWhenFromColumns({ dayOfWeek: 0, pattern: "every", ...whenToColumns(w) });
      for (const d of ALL_DATES) {
        expect(matchesWhen(round, d, PP)).toBe(matchesWhen(w, d, PP));
      }
    }
  });

  it("every_n with NULL cycleLength/cycleOffset backfills to n=2 / offset=0 (legacy default)", () => {
    // Mirrors the migration's COALESCE(cycleLength,2)/COALESCE(cycleOffset,0).
    const cols = whenToColumns(legacyPatternToWhen({ dayOfWeek: 2, pattern: "every_n", cycleLength: null, cycleOffset: null }));
    expect(cols.whenKind).toBe("cycle");
    expect(cols.whenCycleUnit).toBe("week");
    expect(cols.whenCycleN).toBe(2);
    expect(cols.whenCycleOffset).toBe(0);
    // And it evaluates identically to the legacy null-default rule.
    const legacy = { dayOfWeek: 2, pattern: "every_n", cycleLength: null, cycleOffset: null };
    for (const d of ALL_DATES) {
      expect(matchesWhen(ruleToWhen(legacy), d, PP)).toBe(dow(d) === 2 && matchesPattern(legacy, d, PP));
    }
  });
});

describe("isPlainWeekdayWhen — quick-toggle classification", () => {
  it("true only for single-weekday every-occurrence patterns", () => {
    expect(isPlainWeekdayWhen({ daysOfWeek: [2], kind: "every" })).toBe(true);
    // legacy + backfilled rows route here via ruleToWhen and agree:
    expect(isPlainWeekdayWhen(ruleToWhen({ dayOfWeek: 4, pattern: "every" }))).toBe(true);
    expect(
      isPlainWeekdayWhen(
        ruleToWhen({ dayOfWeek: 4, pattern: "every", whenKind: "every", whenDays: [4] }),
      ),
    ).toBe(true);
  });

  it("false for multi-day, ordinal, pp-week, and cycle patterns", () => {
    expect(isPlainWeekdayWhen({ daysOfWeek: [1, 3, 5], kind: "every" })).toBe(false); // multi-day
    expect(isPlainWeekdayWhen({ daysOfWeek: [], kind: "every" })).toBe(false); // any-day
    expect(isPlainWeekdayWhen({ daysOfWeek: [2], kind: "ordinalMonth", ords: [1, 3] })).toBe(false);
    expect(isPlainWeekdayWhen({ daysOfWeek: [2], kind: "ppWeek", ppWeek: 1 })).toBe(false);
    expect(isPlainWeekdayWhen({ daysOfWeek: [2], kind: "cycle", cycleUnit: "week", cycleN: 2, cycleOffset: 0 })).toBe(false);
  });
});

// The slice-4 carry-forward guarantee: an explicit ordinal/multi-day rule the
// picker writes must survive a client load → edit-unrelated-field → save cycle.
// saveStaff PUTs the whole rule and the route derives when* via
// whenToColumns(ruleToWhen(rule)); for an explicit row this must be identity on
// the when* columns (not collapse to the legacy back-projection).
describe("explicit WHEN rows survive the persistence derive (load→save)", () => {
  const persist = (cols: ReturnType<typeof whenToColumns>) =>
    whenToColumns(ruleToWhen({ dayOfWeek: 0, pattern: "every", ...cols }));

  it("preserves a multi-day ordinal availability rule", () => {
    // "1st & 3rd Mon/Wed/Fri of each month" — legacy can't express this.
    const cols = whenToColumns({ daysOfWeek: [1, 3, 5], kind: "ordinalMonth", ords: [1, 3] });
    expect(persist(cols)).toEqual(cols);
  });

  it("preserves an every-other pay-period eligibility rule", () => {
    const cols = whenToColumns({ daysOfWeek: [2], kind: "cycle", cycleUnit: "payPeriod", cycleN: 2, cycleOffset: 1 });
    expect(persist(cols)).toEqual(cols);
  });

  it("preserves a last-occurrence-in-PP rule", () => {
    const cols = whenToColumns({ daysOfWeek: [4], kind: "ordinalPayPeriod", ords: [-1] });
    expect(persist(cols)).toEqual(cols);
  });
});
