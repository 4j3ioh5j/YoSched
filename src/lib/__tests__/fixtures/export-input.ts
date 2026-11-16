// Card #299: a small schedule shared by the export tests.
import type { ExportScheduleInput } from "../../print-month-model";
import { DEFAULT_PRINT_LAYOUT } from "../../print-layout";
import { DEFAULT_DAY_SHADING } from "../../day-shading";

export const NOW = new Date(2026, 10, 16, 20, 5); // 2026-11-16 20:05 local

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

export function input(over: Partial<ExportScheduleInput> = {}): ExportScheduleInput {
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

