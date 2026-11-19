// Card #299: the PDF half of the year export. One landscape Letter page per month, drawn
// straight with jsPDF (no table plugin, so a month can never split across pages). The
// layout is a pure function: the font shrinks only when the month would not fit the
// page's width or height. A PDF must embed its font, and the Settings font (Aptos Narrow)
// cannot be shipped, so it embeds Archivo Narrow (OFL, public/fonts), the same narrow
// fallback the printout uses.

import type { PrintedMonth } from "./print-month-model";
import { PAPER_IN, DEFAULT_PRINT_PAPER, isPrintPaper, printPage, udWidthsIn, DEFAULT_UD_WIDTH, type PrintLayout } from "./print-layout";

/** Card #323: the landscape page in points, with the Settings paper and margin (the same ones
 *  the printout uses). */
export function pdfPage(layout: Pick<PrintLayout, "paper" | "marginHundredths">): { w: number; h: number; margin: number; format: string } {
  const p = printPage(layout);
  const format = PAPER_IN[isPrintPaper(layout.paper) ? layout.paper : DEFAULT_PRINT_PAPER].jspdf;
  return { w: p.wIn * 72, h: p.hIn * 72, margin: p.marginIn * 72, format };
}
const LABEL_W = 24.5; // 0.34", the printout's PP-label strip
const CELL_PAD = 4;
const MAX_STRETCH = 2.5;
const FONT = "ArchivoNarrow";
const MAX_MONTH_DAYS = 31;

/** Width of a line of text in points: a safe upper estimate for a narrow font. */
const textW = (s: string, size: number) => s.length * size * 0.52;

/** Card #357: a custom width can be narrower than a cell's text; that one cell's text shrinks to
 *  fit rather than spill into its neighbor. */
export function pdfCellFontSize(text: string, colW: number, size: number): number {
  const w = textW(text, size);
  const room = colW - CELL_PAD;
  return w > room && w > 0 && room > 0 ? size * room / w : size;
}

export type PdfMonthLayout = {
  fontSize: number;
  titleTop: number;
  tableTop: number;
  tableLeft: number;
  rowH: number;
  colW: number[];
  labelW: number;
  footerTop: number;
  footerSize: number;
};

const headLabels = (m: PrintedMonth) => [...(m.splitDateDay ? ["DATE", "DAY"] : ["DATE"]), ...m.columns.map((c) => c.label)];
const rowTexts = (m: PrintedMonth, r: PrintedMonth["rows"][number]) => [...(m.splitDateDay ? [r.dateText, r.dayText ?? ""] : [r.dateText]), ...r.cells.map((c) => c.text)];

export function pdfMonthLayout(m: PrintedMonth): PdfMonthLayout {
  const L = m.layout;
  const PAGE = pdfPage(L);
  const titleTop = PAGE.margin;
  const tableTop = titleTop + L.header.size * 1.25 + 2;
  const footerSize = L.footer.size;
  const footerTop = PAGE.h - PAGE.margin - footerSize;
  const labelW = L.payPeriodLabels ? LABEL_W : 0;
  const availW = PAGE.w - 2 * PAGE.margin - labelW;
  const availH = footerTop - 3 - tableTop;
  // Card #322: one row height for every month, sized so the header row and a 31-day month
  // fill the page down to the footer; a shorter month leaves room at the bottom.
  const rowH = availH / (MAX_MONTH_DAYS + 1);

  const heads = headLabels(m);
  const texts = [heads, ...m.rows.map((r) => rowTexts(m, r))];
  const natural = (size: number) =>
    heads.map((_, i) => Math.max(size * 2.2, ...texts.map((row) => textW(row[i] ?? "", size))) + CELL_PAD);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  // Card #357: the user-defined columns (additional and shift columns) take the Settings width
  // choice, fitted with the shared page-fit rule into the room the other columns leave; they are
  // never stretched. The other columns stretch into what is left, as before.
  const lead = m.splitDateDay ? 2 : 1;
  const isUd = heads.map((_, i) => i >= lead && (m.columns[i - lead]?.kind === "agg" || m.columns[i - lead]?.kind === "ded"));
  const udSettings = L.udWidth ?? DEFAULT_UD_WIDTH;
  const widthsAt = (size: number) => {
    const nat = natural(size);
    const udCols = heads.flatMap((h, i) => (isUd[i] ? [{ key: m.columns[i - lead].key ?? `#${i}`, fitIn: nat[i] / 72, titleIn: (textW(h, size) + CELL_PAD) / 72, i }] : []));
    const otherNat = sum(nat.filter((_, i) => !isUd[i]));
    const ud = udWidthsIn(udSettings, udCols, (availW - otherNat) / 72);
    const udW = new Map(udCols.map((c) => [c.i, ud.get(c.key)! * 72]));
    return { nat, otherNat, udW, total: otherNat + sum([...udW.values()]) };
  };

  // Shrink for height, then for width (titles and natural widths scale with the font; when the
  // titles alone — or one width's widest title times the columns — do not fit, the font shrinks
  // until they do), never grow.
  let fontSize = Math.min(L.fontSize, rowH / 1.15);
  const w0 = widthsAt(fontSize).total;
  if (w0 > availW) fontSize *= availW / w0;
  // Integer CELL_PAD keeps a little overflow after the proportional shrink; settle it.
  for (let k = 0; k < 60 && widthsAt(fontSize).total > availW; k++) fontSize *= 0.97;

  const { nat, otherNat, udW } = widthsAt(fontSize);
  const udSum = sum([...udW.values()]);
  const stretch = otherNat > 0 ? Math.min(MAX_STRETCH, (availW - udSum) / otherNat) : 1;
  const colW = nat.map((w, i) => udW.get(i) ?? w * Math.max(1, stretch));
  const tableW = sum(colW);
  const tableLeft = PAGE.margin + Math.max(0, (availW - tableW) / 2);
  return { fontSize, titleTop, tableTop, tableLeft, rowH, colW, labelW, footerTop, footerSize };
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The year's 12 printed months → PDF bytes. `fonts` are the Archivo Narrow TTFs. */
export async function exportYearPdf(
  months: readonly PrintedMonth[],
  fonts: { regular: Uint8Array; bold: Uint8Array },
  opts: { compress?: boolean } = {},
): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const first = months[0] ? pdfPage(months[0].layout) : pdfPage({ paper: DEFAULT_PRINT_PAPER, marginHundredths: 25 });
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: first.format, compress: opts.compress ?? true });
  doc.addFileToVFS("ArchivoNarrow-Regular.ttf", base64(fonts.regular));
  doc.addFont("ArchivoNarrow-Regular.ttf", FONT, "normal");
  doc.addFileToVFS("ArchivoNarrow-Bold.ttf", base64(fonts.bold));
  doc.addFont("ArchivoNarrow-Bold.ttf", FONT, "bold");
  doc.setProperties({ title: months[0] ? `${months[0].year} schedule` : "Schedule", creator: "YoSched" });

  months.forEach((m, pi) => {
    if (pi > 0) doc.addPage(pdfPage(m.layout).format, "landscape");
    const L = m.layout;
    const lay = pdfMonthLayout(m);
    const { tableLeft, tableTop, rowH, colW } = lay;
    const tableW = colW.reduce((a, b) => a + b, 0);
    const tableBottom = tableTop + rowH * (m.rows.length + 1);
    const xs = colW.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [tableLeft]);
    const alignX = (a: "left" | "center" | "right") => (a === "left" ? tableLeft : a === "center" ? tableLeft + tableW / 2 : tableLeft + tableW);
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);

    // Title.
    doc.setFont(FONT, L.header.bold ? "bold" : "normal");
    doc.setFontSize(L.header.size);
    doc.text(m.title, alignX(L.header.align), lay.titleTop, { align: L.header.align, baseline: "top" });

    // Cells: fills first, then text.
    const drawRow = (y: number, texts: string[], fills: (string | null)[], bolds: boolean[]) => {
      texts.forEach((t, i) => {
        const bg = fills[i];
        if (bg) {
          doc.setFillColor(bg);
          doc.rect(xs[i], y, colW[i], rowH, "F");
        }
        if (t) {
          doc.setFont(FONT, bolds[i] ? "bold" : "normal");
          doc.setFontSize(pdfCellFontSize(t, colW[i], lay.fontSize));
          doc.text(t, xs[i] + colW[i] / 2, y + rowH / 2, { align: "center", baseline: "middle" });
        }
      });
    };
    const heads = headLabels(m);
    drawRow(tableTop, heads, heads.map(() => null), heads.map(() => true));
    m.rows.forEach((r, k) => {
      const dateBlock = m.splitDateDay ? 2 : 1;
      drawRow(
        tableTop + rowH * (k + 1),
        rowTexts(m, r),
        [...Array(dateBlock).fill(r.shade), ...r.cells.map((c) => c.bg)],
        [...Array(dateBlock).fill(false), ...r.cells.map((c) => c.bold)],
      );
    });

    // Grid lines: thin inside; medium outside, under the header and after the date block;
    // a double line on top of each pay period's first row.
    const hline = (y: number, w: number) => { doc.setLineWidth(w); doc.line(tableLeft, y, tableLeft + tableW, y); };
    const vline = (x: number, w: number) => { doc.setLineWidth(w); doc.line(x, tableTop, x, tableBottom); };
    for (let k = 2; k <= m.rows.length; k++) {
      const r = m.rows[k - 1];
      const y = tableTop + rowH * k;
      if (r.ppStart) { hline(y - 0.8, 0.4); hline(y + 0.8, 0.4); } else hline(y, 0.4);
    }
    if (m.rows[0]?.ppStart) hline(tableTop + rowH + 1.6, 0.4);
    xs.forEach((x, i) => vline(x, i === 0 || i === xs.length - 1 || i === (m.splitDateDay ? 2 : 1) ? 1.25 : 0.4));
    hline(tableTop, 1.25);
    hline(tableTop + rowH, 1.25);
    hline(tableBottom, 1.25);

    // Pay-period labels in the strip right of the table.
    doc.setFont(FONT, "normal");
    doc.setFontSize(6);
    m.rows.forEach((r, k) => {
      if (r.ppLabel) doc.text(r.ppLabel, tableLeft + tableW + 2, tableTop + rowH * (k + 1) + 1, { baseline: "top" });
    });

    // Footer.
    doc.setFont(FONT, L.footer.bold ? "bold" : "normal");
    doc.setFontSize(L.footer.size);
    doc.text(m.footer, alignX(L.footer.align), lay.footerTop, { align: L.footer.align, baseline: "top" });
  });

  return new Uint8Array(doc.output("arraybuffer"));
}
