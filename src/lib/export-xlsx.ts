// Card #299: the Excel half of the year export. One sheet per month, laid out like the
// reference MD Schedule workbook: title in A1, the header row, one row per day, the footer
// row, and the pay-period labels in a strip right of the table. exceljs is loaded on demand,
// so the schedule page bundle does not carry it.

import type { Borders, Border, Cell, Worksheet } from "exceljs";
import { udRequestedIn, DEFAULT_UD_WIDTH, type DateColumnFormat } from "./print-layout";
import type { PrintedMonth } from "./print-month-model";

const DATE_NUM_FMT: Record<DateColumnFormat, string> = {
  "MM-DD": "mm-dd",
  "DD-MM": "dd-mm",
  "MM/DD": "mm/dd",
  "DD/MM": "dd/mm",
  "M/D": "m/d",
  "D/M": "d/m",
  "DD.MM": "dd\\.mm",
};

const argb = (hex: string) => "FF" + hex.replace("#", "").toUpperCase();
const THIN: Partial<Border> = { style: "thin" };
const MEDIUM: Partial<Border> = { style: "medium" };
const DOUBLE: Partial<Border> = { style: "double" };

function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

const XLSX_MIN_W = 4.71;
const charsFor = (s: string) => s.length * 1.1 + 1.5;
// Excel column width (characters of the default font) ↔ inches at 96 px/in: px = chars·7 + 5.
const inFromChars = (w: number) => (w * 7 + 5) / 96;
const charsFromIn = (inch: number) => (inch * 96 - 5) / 7;

/** Card #357: the Excel width of each printed column. Staff columns stay narrow; count columns
 *  fit their label; the user-defined columns (additional and shift columns) take the Settings
 *  width choice, best fit measuring the label and every day's text. A sheet scrolls, so there is
 *  no page fit here. */
export function xlsxColumnWidths(m: PrintedMonth): number[] {
  const longest = (i: number) => Math.max(0, ...m.rows.map((r) => r.cells[i]?.text.length ?? 0));
  const udCols = m.columns.flatMap((c, i) => (c.kind === "agg" || c.kind === "ded"
    ? [{ i, key: c.key ?? `#${i}`, fitIn: inFromChars(Math.max(XLSX_MIN_W, charsFor(c.label), longest(i) * 1.1 + 1.5)), titleIn: inFromChars(Math.max(XLSX_MIN_W, charsFor(c.label))) }]
    : []));
  const ud = udRequestedIn(m.layout.udWidth ?? DEFAULT_UD_WIDTH, udCols);
  const byIdx = new Map(udCols.map((c) => [c.i, charsFromIn(ud.get(c.key)!)]));
  return m.columns.map((c, i) => byIdx.get(i) ?? (c.kind === "staff" ? XLSX_MIN_W : Math.max(XLSX_MIN_W, charsFor(c.label))));
}

function writeMonth(ws: Worksheet, m: PrintedMonth) {
  const L = m.layout;
  const font = { name: L.fontFamily, size: L.fontSize };
  const dateCols = m.splitDateDay ? 2 : 1;
  const lastCol = dateCols + m.columns.length;
  const labelCol = lastCol + 1;
  const headerRow = 2;
  const firstBody = 3;
  const lastBody = firstBody + m.rows.length - 1;
  const footerRow = lastBody + 1;

  // Widths in Excel character units, close to the reference workbook.
  ws.getColumn(1).width = m.splitDateDay ? 5.29 : 9.5;
  if (m.splitDateDay) ws.getColumn(2).width = L.dayColumnFormat === "Dddd" ? 9 : 4.71;
  xlsxColumnWidths(m).forEach((w, i) => {
    ws.getColumn(dateCols + 1 + i).width = w;
  });
  ws.getColumn(labelCol).width = 4.29;

  // Title, merged across the table so its alignment means the table's width.
  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = m.title;
  title.font = { name: L.fontFamily, size: L.header.size, bold: L.header.bold };
  title.alignment = { horizontal: L.header.align, vertical: "middle" };
  ws.getRow(1).height = Math.max(15, L.header.size * 1.36);

  const border = (row: number, col: number, topStyle: Partial<Border>): Partial<Borders> => ({
    top: row === headerRow ? MEDIUM : topStyle,
    bottom: row === headerRow || row === lastBody ? MEDIUM : THIN,
    left: col === 1 ? MEDIUM : THIN,
    right: col === lastCol || col === dateCols ? MEDIUM : THIN,
  });
  const style = (c: Cell, row: number, col: number, top: Partial<Border>, bold: boolean, bg: string | null) => {
    c.font = { ...font, bold };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = border(row, col, top);
    if (bg) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(bg) } };
  };

  // Header row.
  const heads = [m.splitDateDay ? ["DATE", "DAY"] : ["DATE"], m.columns.map((c) => c.label)].flat();
  heads.forEach((h, i) => {
    const c = ws.getCell(headerRow, i + 1);
    c.value = h;
    style(c, headerRow, i + 1, MEDIUM, true, null);
  });
  ws.getRow(headerRow).height = 15.75;

  // Day rows.
  m.rows.forEach((r, k) => {
    const row = firstBody + k;
    const top = r.ppStart ? DOUBLE : THIN;
    const dc = ws.getCell(row, 1);
    if (m.splitDateDay) {
      dc.value = new Date(Date.UTC(Number(r.iso.slice(0, 4)), Number(r.iso.slice(5, 7)) - 1, Number(r.iso.slice(8, 10))));
      dc.numFmt = DATE_NUM_FMT[L.dateColumnFormat];
      const day = ws.getCell(row, 2);
      day.value = r.dayText ?? "";
      style(day, row, 2, top, false, r.shade);
    } else {
      dc.value = r.dateText;
    }
    style(dc, row, 1, top, false, r.shade);
    r.cells.forEach((cell, i) => {
      const col = dateCols + 1 + i;
      const c = ws.getCell(row, col);
      if (cell.text) c.value = cell.text;
      style(c, row, col, top, cell.bold, cell.bg);
    });
    if (r.ppLabel) {
      const lc = ws.getCell(row, labelCol);
      lc.value = r.ppLabel;
      lc.font = { name: L.fontFamily, size: 6 };
      lc.alignment = { horizontal: "left", vertical: "top" };
    }
  });

  // Footer: one merged line under the table.
  ws.mergeCells(footerRow, 1, footerRow, lastCol);
  const f = ws.getCell(footerRow, 1);
  f.value = m.footer;
  f.font = { name: L.fontFamily, size: L.footer.size, bold: L.footer.bold };
  f.alignment = { horizontal: L.footer.align, vertical: "middle" };

  ws.pageSetup = {
    orientation: "landscape",
    paperSize: 1 as NonNullable<Worksheet["pageSetup"]["paperSize"]>, // Letter (OOXML 1; exceljs' enum lacks it)
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    margins: { left: 0.2, right: 0.2, top: 0.2, bottom: 0.2, header: 0.3, footer: 0.3 },
    printArea: `A1:${colLetter(labelCol)}${footerRow}`,
  };
}

/** The year's 12 printed months → .xlsx bytes. */
export async function exportYearXlsx(months: readonly PrintedMonth[]): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "YoSched";
  for (const m of months) writeMonth(wb.addWorksheet(m.sheetName), m);
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
