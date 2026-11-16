import { describe, it, expect } from "vitest";
import { buildPrintedMonth, buildPrintedYear, computePrintColumns, type ExportScheduleInput } from "../print-month-model";
import { DEFAULT_PRINT_LAYOUT } from "../print-layout";
import { DEFAULT_DAY_SHADING } from "../day-shading";

// Card #299: one pure model of a printed month, shared by the Excel and PDF year export
// (and, for the column set, by the on-screen print via computePrintColumns).

const NOW = new Date(2026, 10, 16, 20, 5); // 2026-11-16 20:05 local

const ST = [
  { id: "or", code: "OR", isOffShift: false, isLeave: false },
  { id: "orl", code: "ORL", isOffShift: false, isLeave: false, boldOnSchedule: true, printBackgroundColor: "#92D050" },
  { id: "call", code: "CALL", isOffShift: false, isLeave: false, boldOnSchedule: true, printBackgroundColor: null },
  { id: "x", code: "X", isOffShift: true, isLeave: false },
  { id: "hol", code: "HOL", isOffShift: false, isLeave: true, printBackgroundColor: "#FFCCFF" },
  { id: "icu", code: "ICU", isOffShift: false, isLeave: false, dedicatedColumn: true, printBackgroundColor: "#66CCFF" },
];

const staff = [
  { id: "a", initials: "AA", employmentTypeId: "ft", ftePercentage: 1, isActive: true },
  { id: "b", initials: "BB", employmentTypeId: "ft", ftePercentage: 1, isActive: true },
  { id: "c", initials: "CC", employmentTypeId: "pt", ftePercentage: 0.5, isActive: false },
];

const code = (id: string) => ST.find((s) => s.id === id)!.code;
const asg = (staffId: string, date: string, shiftTypeId: string) => ({ staffId, date, shiftTypeId, code: code(shiftTypeId) });

function input(over: Partial<ExportScheduleInput> = {}): ExportScheduleInput {
  return {
    staff,
    assignments: [
      asg("a", "2026-01-01", "hol"),
      asg("a", "2026-01-02", "orl"),
      asg("a", "2026-01-03", "call"),
      asg("c", "2026-01-02", "or"),
      asg("c", "2026-01-05", "icu"),
      asg("b", "2026-01-04", "x"), // off-shift only: B did not work January
      asg("a", "2025-12-31", "or"), // outside the month
    ],
    shiftTypes: ST,
    payPeriods: [
      { startDate: "2025-12-28", endDate: "2026-01-10" },
      { startDate: "2026-01-11", endDate: "2026-01-24" },
      { startDate: "2026-01-25", endDate: "2026-02-07" },
    ],
    holidays: [{ date: "2026-01-01" }],
    countColumns: [{ id: "c1", label: "#", shiftTypeIds: ["or", "orl"] }],
    specialColumnOrder: null,
    printColumnRules: [],
    printAggregateColumns: [],
    dayShading: { ...DEFAULT_DAY_SHADING },
    printLayout: { ...DEFAULT_PRINT_LAYOUT, header: { ...DEFAULT_PRINT_LAYOUT.header }, footer: { ...DEFAULT_PRINT_LAYOUT.footer } },
    weekendStartDow: 6,
    dateFormat: "MM/DD/YYYY",
    versions: [{ year: 2026, month: 0, versionNumber: 9 }],
    ...over,
  };
}

const staffCols = (m: ReturnType<typeof buildPrintedMonth>) => m.columns.filter((c) => c.kind === "staff").map((c) => c.label);
const cellAt = (m: ReturnType<typeof buildPrintedMonth>, iso: string, label: string) => {
  const ci = m.columns.findIndex((c) => c.label === label);
  return m.rows.find((r) => r.iso === iso)!.cells[ci];
};

describe("buildPrintedMonth (card #299)", () => {
  it("has the in-month days only, the sheet name and the last-day flag", () => {
    const m = buildPrintedMonth(input(), 2026, 0, NOW);
    expect(m.sheetName).toBe("JAN 2026");
    expect(m.rows).toHaveLength(31);
    expect(m.rows[0].iso).toBe("2026-01-01");
    expect(m.rows[30].iso).toBe("2026-01-31");
    expect(m.rows[30].monthLast).toBe(true);
    expect(m.rows[0].monthLast).toBe(false);
    expect(m.rows[0].dateText).toBe("01-01");
    expect(m.rows[0].dayText).toBe("THU");
  });

  it("past month: only the staff who worked; current/future: the active roster", () => {
    expect(staffCols(buildPrintedMonth(input(), 2026, 0, NOW))).toEqual(["AA", "CC"]);
    expect(staffCols(buildPrintedMonth(input(), 2026, 11, NOW))).toEqual(["AA", "BB"]);
  });

  it("drops rule-hidden staff and staff folded into a suppressing aggregate column", () => {
    const rules = [{ enabled: true, mode: "exclude", employmentTypeIds: ["pt"], minFtePercentage: null, maxFtePercentage: null, conditions: [] }];
    expect(staffCols(buildPrintedMonth(input({ printColumnRules: rules }), 2026, 0, NOW))).toEqual(["AA"]);

    const agg = [{ id: "o", label: "OTHER", enabled: true, isOther: false, suppressMembers: true, conditionScope: "month", employmentTypeIds: ["pt"], minFtePercentage: null, maxFtePercentage: null, conditions: [] }];
    const m = buildPrintedMonth(input({ printAggregateColumns: agg }), 2026, 0, NOW);
    expect(staffCols(m)).toEqual(["AA"]);
    expect(cellAt(m, "2026-01-02", "OTHER").text).toBe("CC");
  });

  it("dedicated columns scan every staff, even a hidden one, and tint when filled", () => {
    const rules = [{ enabled: true, mode: "exclude", employmentTypeIds: ["pt"], minFtePercentage: null, maxFtePercentage: null, conditions: [] }];
    const m = buildPrintedMonth(input({ printColumnRules: rules }), 2026, 0, NOW);
    expect(cellAt(m, "2026-01-05", "ICU")).toEqual({ text: "CC", bg: "#66CCFF", bold: false });
    expect(cellAt(m, "2026-01-06", "ICU")).toEqual({ text: "", bg: null, bold: false });
  });

  it("count columns count every staff's saved cells by shift id", () => {
    const m = buildPrintedMonth(input(), 2026, 0, NOW);
    expect(cellAt(m, "2026-01-02", "#").text).toBe("2");
    expect(cellAt(m, "2026-01-07", "#").text).toBe("0");
  });

  it("special columns follow the Settings order", () => {
    const kinds = (o: string[] | null) => buildPrintedMonth(input({ specialColumnOrder: o }), 2026, 0, NOW).columns.filter((c) => c.kind !== "staff").map((c) => c.label);
    expect(kinds(null)).toEqual(["ICU", "#"]);
    expect(kinds(["count:c1", "ded:icu"])).toEqual(["#", "ICU"]);
  });

  it("marks pay-period starts with their PP#nn label (labels can be off)", () => {
    const m = buildPrintedMonth(input(), 2026, 0, NOW);
    const starts = m.rows.filter((r) => r.ppStart).map((r) => [r.iso, r.ppLabel]);
    expect(starts).toEqual([["2026-01-11", "PP#01"], ["2026-01-25", "PP#02"]]);
    const off = buildPrintedMonth(input({ printLayout: { ...DEFAULT_PRINT_LAYOUT, payPeriodLabels: false } }), 2026, 0, NOW);
    expect(off.rows.find((r) => r.iso === "2026-01-11")!.ppLabel).toBeNull();
    expect(off.rows.find((r) => r.iso === "2026-01-11")!.ppStart).toBe(true);
  });

  it("cell colour: shift tint, then bold-cell grey, then the row shade", () => {
    const shading = { printWeekendColor: "#EEEEEE", printHolidayColor: "#DDDDDD", screenHolidayColor: null };
    const m = buildPrintedMonth(input({ dayShading: shading }), 2026, 0, NOW);
    expect(cellAt(m, "2026-01-02", "AA")).toEqual({ text: "ORL", bg: "#92D050", bold: true });
    expect(cellAt(m, "2026-01-03", "AA")).toEqual({ text: "CALL", bg: "#e6e6e6", bold: true }); // Saturday, shaded row
    expect(cellAt(m, "2026-01-01", "AA")).toEqual({ text: "HOL", bg: "#FFCCFF", bold: false }); // holiday row
    expect(cellAt(m, "2026-01-01", "CC")).toEqual({ text: "", bg: "#DDDDDD", bold: false });
    expect(m.rows[0].shade).toBe("#DDDDDD");
    expect(m.rows.find((r) => r.iso === "2026-01-05")!.shade).toBeNull();
    expect(cellAt(m, "2026-01-05", "AA")).toEqual({ text: "", bg: null, bold: false });
  });

  it("title and footer come from the templates with that month's version, or a dash", () => {
    const m = buildPrintedMonth(input(), 2026, 0, NOW);
    expect(m.title).toBe("JANUARY 2026 SCHEDULE");
    expect(m.footer).toBe("11/16/2026 20:05 VER: 09 - YoSched");
    expect(buildPrintedMonth(input(), 2026, 1, NOW).footer).toBe("11/16/2026 20:05 VER: — - YoSched");
  });

  it("one combined date column when the split is off", () => {
    const m = buildPrintedMonth(input({ printLayout: { ...DEFAULT_PRINT_LAYOUT, splitDateDay: false } }), 2026, 0, NOW);
    expect(m.splitDateDay).toBe(false);
    expect(m.rows[0].dateText).toBe("Thu 1/1");
    expect(m.rows[0].dayText).toBeNull();
  });

  it("a year is 12 months built from one snapshot and one timestamp", () => {
    const months = buildPrintedYear(input(), 2026, NOW);
    expect(months.map((m) => m.sheetName)).toEqual(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].map((s) => `${s} 2026`));
    expect(new Set(months.map((m) => m.footer.slice(0, 16)))).toEqual(new Set(["11/16/2026 20:05"]));
    expect(months[1].rows).toHaveLength(28);
  });
});

describe("computePrintColumns (card #299, shared with the grid's print)", () => {
  it("ignores shifts that fall only on padding days outside the month", () => {
    const agg = [{ id: "o", label: "OTHER", enabled: true, isOther: false, suppressMembers: false, conditionScope: "day", employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions: [{ quantifier: "has_any", categories: [], shiftTypeIds: ["or"], exceptIds: [] }] }];
    const cells = new Map([["a:2025-12-31", "or"]]);
    const r = computePrintColumns({
      visibleStaff: staff,
      dates: ["2025-12-31", "2026-01-01"],
      firstOfMonth: "2026-01-01",
      lastOfMonth: "2026-01-31",
      shiftTypeIdAt: (p, d) => cells.get(`${p}:${d}`),
      shiftTypes: ST,
      printColumnRules: [],
      printAggregateColumns: agg,
    });
    expect(r.aggColumns).toEqual([]);
    expect(r.hiddenIds.size).toBe(0);
  });
});
