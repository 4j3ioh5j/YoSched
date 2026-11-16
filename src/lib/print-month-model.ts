// Card #299: one pure model of a printed month. The year export (Excel and PDF) renders it,
// and computePrintColumns is the same column set the on-screen print uses, so the export
// and the printout cannot drift apart. Saved schedule only: no Live what-if, no request markers.

import { isWeekendDow } from "./scheduler-tuning";
import { rowPrintShade, type DayShading } from "./day-shading";
import { renderPrintTemplate, footerLine, formatDateColumn, formatDayColumn, ppLabelText, type PrintLayout, type PrintTemplateContext } from "./print-layout";
import { isPastMonth, visibleStaffForMonth } from "./schedule-visibility";
import { payPeriodLabel, periodLengthOf } from "./pay-periods";
import { dedicatedColumnInitials } from "./dedicated-columns";
import { countColumnTotals } from "./count-columns";
import { printVisibleStaffIds, type PrintRule, type ShiftKind } from "./print-column-visibility";
import { computeAggregateColumns, type AggregateColumn } from "./print-aggregate-columns";
import { orderSpecialColumns } from "./special-columns";
import { formatDateCompact, type DateFormatKey } from "./date-format";

/** The bold-cell grey of the printout (globals.css `td[data-bold-cell]`). */
export const BOLD_CELL_GREY = "#e6e6e6";

type ColStaff = { id: string; initials: string; employmentTypeId: string; ftePercentage: number | null };
type ColShift = { id: string; isOffShift: boolean; isLeave: boolean };

export type PrintColumnsInput = {
  visibleStaff: readonly ColStaff[];
  /** Every date the caller renders a row for (the grid's padded weeks); only in-month dates decide. */
  dates: readonly string[];
  firstOfMonth: string;
  lastOfMonth: string;
  shiftTypeIdAt: (staffId: string, date: string) => string | undefined;
  shiftTypes: readonly ColShift[];
  printColumnRules: readonly PrintRule[];
  printAggregateColumns: readonly AggregateColumn[];
};

export type PrintAggColumn = { id?: string; label: string; initialsByDate: Record<string, string[]> };

/**
 * The printed schedule's column model:
 *  - hiddenIds: staff whose individual column is hidden — they match no enabled print-column
 *    rule, OR they're claimed by an aggregate column with suppressMembers;
 *  - aggColumns: the aggregate columns, each with per-date member initials over every date,
 *    kept only when a member is scheduled on an in-month day.
 * Only in-month dates count: padding rows never print, so a shift landing only on one must
 * not make a column print, appear or be suppressed.
 */
export function computePrintColumns(i: PrintColumnsInput): { hiddenIds: Set<string>; aggColumns: PrintAggColumn[] } {
  const inMonth = i.dates.filter((d) => d >= i.firstOfMonth && d <= i.lastOfMonth);
  const offIds = new Set(i.shiftTypes.filter((st) => st.isOffShift).map((st) => st.id));
  const shiftIdsByStaff = new Map<string, Set<string>>();
  for (const p of i.visibleStaff) {
    const set = new Set<string>();
    for (const date of inMonth) {
      const id = i.shiftTypeIdAt(p.id, date);
      if (id) set.add(id);
    }
    if (set.size > 0) shiftIdsByStaff.set(p.id, set);
  }
  const kindById = new Map<string, ShiftKind>();
  for (const st of i.shiftTypes) kindById.set(st.id, st.isOffShift ? "off" : st.isLeave ? "leave" : "work");
  const visStaff = i.visibleStaff.map((p) => ({ id: p.id, employmentTypeId: p.employmentTypeId, ftePercentage: p.ftePercentage }));
  const visIds = printVisibleStaffIds(visStaff, i.printColumnRules, shiftIdsByStaff, kindById);

  const isScheduledNonOff = (staffId: string, date: string) => {
    const id = i.shiftTypeIdAt(staffId, date);
    return !!id && !offIds.has(id);
  };
  const agg = computeAggregateColumns(visStaff, visIds, i.printAggregateColumns, inMonth, shiftIdsByStaff, i.shiftTypeIdAt, kindById, isScheduledNonOff);

  const hiddenIds = visIds ? new Set(i.visibleStaff.filter((p) => !visIds.has(p.id)).map((p) => p.id)) : new Set<string>();
  for (const id of agg.suppressedIndividualIds) hiddenIds.add(id);

  const initialsById = new Map(i.visibleStaff.map((p) => [p.id, p.initials]));
  const aggColumns = agg.columns
    .map((c) => {
      const initialsByDate: Record<string, string[]> = {};
      for (const d of i.dates) initialsByDate[d] = (c.memberIdsByDate[d] ?? []).map((id) => initialsById.get(id) ?? "");
      return { id: c.id, label: c.label, initialsByDate };
    })
    .filter((c) => inMonth.some((d) => (c.initialsByDate[d]?.length ?? 0) > 0));
  return { hiddenIds, aggColumns };
}

export type ExportScheduleInput = {
  staff: readonly (ColStaff & { isActive: boolean })[];
  assignments: readonly { staffId: string; date: string; shiftTypeId: string; code: string }[];
  shiftTypes: readonly (ColShift & { code: string; dedicatedColumn?: boolean; boldOnSchedule?: boolean; printBackgroundColor?: string | null })[];
  payPeriods: readonly { startDate: string; endDate: string }[];
  holidays: readonly { date: string }[];
  countColumns: readonly { id?: string; label: string; shiftTypeIds: string[] }[];
  specialColumnOrder: readonly string[] | null | undefined;
  printColumnRules: readonly PrintRule[];
  printAggregateColumns: readonly AggregateColumn[];
  dayShading: DayShading;
  printLayout: PrintLayout;
  weekendStartDow: number;
  dateFormat: DateFormatKey;
  versions: readonly { year: number; month: number; versionNumber: number }[];
};

export type PrintedColumn = { kind: "staff" | "agg" | "ded" | "count"; label: string };
export type PrintedCell = { text: string; bg: string | null; bold: boolean };
export type PrintedRow = {
  iso: string;
  dow: number;
  dateText: string;
  /** null when the date block is one column. */
  dayText: string | null;
  ppStart: boolean;
  ppLabel: string | null;
  shade: string | null;
  monthLast: boolean;
  cells: PrintedCell[];
};
export type PrintedMonth = {
  year: number;
  /** 0 = January */
  month: number;
  sheetName: string;
  title: string;
  footer: string;
  splitDateDay: boolean;
  layout: PrintLayout;
  columns: PrintedColumn[];
  rows: PrintedRow[];
};

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad2 = (n: number) => (n < 10 ? "0" + n : String(n));
const isoOf = (y: number, m0: number, d: number) => `${y}-${pad2(m0 + 1)}-${pad2(d)}`;

export function buildPrintedMonth(input: ExportScheduleInput, year: number, month: number, now: Date): PrintedMonth {
  const daysIn = new Date(year, month + 1, 0).getDate();
  const dates = Array.from({ length: daysIn }, (_, k) => isoOf(year, month, k + 1));
  const first = dates[0];
  const last = dates[daysIn - 1];
  const layout = input.printLayout;

  const cell = new Map<string, (typeof input.assignments)[number]>();
  for (const a of input.assignments) if (a.date >= first && a.date <= last) cell.set(`${a.staffId}:${a.date}`, a);
  const shiftById = new Map(input.shiftTypes.map((st) => [st.id, st]));
  const offIds = new Set(input.shiftTypes.filter((st) => st.isOffShift).map((st) => st.id));
  const shiftTypeIdAt = (p: string, d: string) => cell.get(`${p}:${d}`)?.shiftTypeId;

  const visible = visibleStaffForMonth([...input.staff], [...input.assignments], first, last, isPastMonth(year, month, now), false, offIds);
  const { hiddenIds, aggColumns } = computePrintColumns({
    visibleStaff: visible,
    dates,
    firstOfMonth: first,
    lastOfMonth: last,
    shiftTypeIdAt,
    shiftTypes: input.shiftTypes,
    printColumnRules: input.printColumnRules,
    printAggregateColumns: input.printAggregateColumns,
  });
  const printedStaff = visible.filter((p) => !hiddenIds.has(p.id));

  const dedicated = input.shiftTypes.filter((st) => st.dedicatedColumn);
  const allStaff = input.staff.map((p) => ({ id: p.id, initials: p.initials }));
  const dedData = dedicated.map((st) => dedicatedColumnInitials(allStaff, dates, st.code, (p, d) => cell.get(`${p}:${d}`)?.code));
  const counts = countColumnTotals(input.countColumns, dates, input.staff.map((p) => p.id), shiftTypeIdAt);
  const specials = orderSpecialColumns(
    {
      agg: aggColumns.map((c, i) => ({ id: c.id ?? `#${i}`, i })),
      ded: dedicated.map((st, i) => ({ id: st.id, i })),
      count: input.countColumns.map((c, i) => ({ id: c.id ?? `#${i}`, i })),
    },
    input.specialColumnOrder,
  );

  const columns: PrintedColumn[] = [
    ...printedStaff.map((p) => ({ kind: "staff" as const, label: p.initials })),
    ...specials.map((sc): PrintedColumn =>
      sc.kind === "agg"
        ? { kind: "agg", label: aggColumns[sc.col.i].label }
        : sc.kind === "ded"
          ? { kind: "ded", label: dedicated[sc.col.i].code }
          : { kind: "count", label: input.countColumns[sc.col.i].label || "#" },
    ),
  ];

  const holidays = new Set(input.holidays.map((h) => h.date));
  const pps = [...input.payPeriods].sort((a, b) => a.startDate.localeCompare(b.startDate));

  const rows: PrintedRow[] = dates.map((iso) => {
    const dow = new Date(year, month, Number(iso.slice(8, 10))).getDay();
    const shade = rowPrintShade(isWeekendDow(dow, input.weekendStartDow), holidays.has(iso), input.dayShading);
    const pp = pps.find((p) => p.startDate === iso);
    const cells: PrintedCell[] = [
      ...printedStaff.map((p) => {
        const a = cell.get(`${p.id}:${iso}`);
        const st = a ? shiftById.get(a.shiftTypeId) : undefined;
        const bold = !!st?.boldOnSchedule;
        return { text: a?.code ?? "", bg: st?.printBackgroundColor || (bold ? BOLD_CELL_GREY : null) || shade, bold };
      }),
      ...specials.map((sc): PrintedCell => {
        if (sc.kind === "agg") return { text: (aggColumns[sc.col.i].initialsByDate[iso] ?? []).join(", "), bg: shade, bold: false };
        if (sc.kind === "ded") {
          const inits = dedData[sc.col.i][iso] ?? [];
          const tint = dedicated[sc.col.i].printBackgroundColor;
          return { text: inits.join(", "), bg: tint && inits.length ? tint : shade, bold: false };
        }
        return { text: String(counts[sc.col.i][iso] ?? 0), bg: shade, bold: false };
      }),
    ];
    return {
      iso,
      dow,
      dateText: layout.splitDateDay ? formatDateColumn(iso, layout.dateColumnFormat) : `${DAY_NAMES[dow]} ${formatDateCompact(new Date(year, month, Number(iso.slice(8, 10))), input.dateFormat)}`,
      dayText: layout.splitDateDay ? formatDayColumn(dow, layout.dayColumnFormat) : null,
      ppStart: !!pp,
      ppLabel: pp && layout.payPeriodLabels ? ppLabelText(payPeriodLabel(pp.startDate, periodLengthOf(pp)).number) : null,
      shade,
      monthLast: iso === last,
      cells,
    };
  });

  const v = input.versions.find((x) => x.year === year && x.month === month);
  const ctx: PrintTemplateContext = { year, month, printedAt: now, dateFormat: input.dateFormat, version: v ? v.versionNumber : null };
  return {
    year,
    month,
    sheetName: `${MON[month]} ${year}`,
    title: renderPrintTemplate(layout.header.text, ctx),
    footer: footerLine(layout.footer.text, ctx),
    splitDateDay: layout.splitDateDay,
    layout,
    columns,
    rows,
  };
}

/** All 12 months from ONE input snapshot and ONE timestamp (both files share them). */
export function buildPrintedYear(input: ExportScheduleInput, year: number, now: Date): PrintedMonth[] {
  return Array.from({ length: 12 }, (_, m) => buildPrintedMonth(input, year, m, now));
}
