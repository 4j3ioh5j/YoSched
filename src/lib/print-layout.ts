// Card #301: the printed month schedule's header, footer, font and DATE/DAY columns.
// Everything here is pure, so the printout and the year export (card #299) share it.
// The values are Settings (SchedulingPreferences); these are only the defaults.

import { formatClock, zonedCalendarDate } from "./time-zone";
import { formatDate, type DateFormatKey } from "./date-format";

export type PrintAlign = "left" | "center" | "right";
export type PrintBlock = { text: string; size: number; bold: boolean; align: PrintAlign };

export const DEFAULT_PRINT_HEADER: PrintBlock = { text: "{MONTH} {YEAR} SCHEDULE", size: 16, bold: true, align: "left" };
export const DEFAULT_PRINT_FOOTER: PrintBlock = { text: "{DATE} {TIME} VER: {VERSION}", size: 8, bold: false, align: "right" };

/** Always added after the footer, in the same font. Not a setting. */
export const YOSCHED_FOOTER_SUFFIX = " - YoSched";

const ALIGNS: readonly PrintAlign[] = ["left", "center", "right"];
export const PRINT_BLOCK_TEXT_MAX = 200;

export function validatePrintBlock(v: unknown): { ok: true; value: PrintBlock | null } | { ok: false; error: string } {
  if (v === null) return { ok: true, value: null };
  if (typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "must be an object with text, size, bold and align" };
  const o = v as Record<string, unknown>;
  if (typeof o.text !== "string" || o.text.length > PRINT_BLOCK_TEXT_MAX || /[\r\n]/.test(o.text)) {
    return { ok: false, error: `text must be one line of at most ${PRINT_BLOCK_TEXT_MAX} characters` };
  }
  if (typeof o.size !== "number" || !Number.isInteger(o.size) || o.size < 6 || o.size > 32) {
    return { ok: false, error: "size must be a whole number from 6 to 32" };
  }
  if (typeof o.bold !== "boolean") return { ok: false, error: "bold must be true or false" };
  if (typeof o.align !== "string" || !ALIGNS.includes(o.align as PrintAlign)) {
    return { ok: false, error: "align must be left, center or right" };
  }
  return { ok: true, value: { text: o.text, size: o.size, bold: o.bold, align: o.align as PrintAlign } };
}

/** Stored value → block; null or anything invalid → the default. */
export function resolvePrintBlock(stored: unknown, kind: "header" | "footer"): PrintBlock {
  const r = validatePrintBlock(stored ?? null);
  if (r.ok && r.value) return r.value;
  return { ...(kind === "header" ? DEFAULT_PRINT_HEADER : DEFAULT_PRINT_FOOTER) };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type PrintTemplateContext = {
  year: number;
  /** 0 = January */
  month: number;
  printedAt: Date;
  dateFormat: DateFormatKey;
  /** The month's saved schedule version, or null when it has none. */
  version: number | null;
  /** Card #320: the Settings time zone; {DATE} and {TIME} are in it, and {TIME} carries its label. */
  zone: string;
};

const pad2 = (n: number) => (n < 10 ? "0" + n : String(n));

/** Fill-in words: {MONTH} JANUARY, {Month} January, {MON} JAN, {YEAR}, {DATE} (date format
 *  setting), {TIME} (24-hour), {VERSION} (saved version, two digits; "—" when none).
 *  Anything else is left exactly as typed. Plain text: callers render it as text. */
export function renderPrintTemplate(text: string, ctx: PrintTemplateContext): string {
  const name = MONTHS[ctx.month] ?? "";
  const words: Record<string, string> = {
    MONTH: name.toUpperCase(),
    Month: name,
    MON: name.slice(0, 3).toUpperCase(),
    YEAR: String(ctx.year),
    DATE: formatDate(zonedCalendarDate(ctx.printedAt, ctx.zone), ctx.dateFormat),
    TIME: formatClock(ctx.printedAt, ctx.zone),
    VERSION: ctx.version === null ? "—" : pad2(ctx.version),
  };
  return text.replace(/\{([A-Za-z]+)\}/g, (m, w: string) => (Object.prototype.hasOwnProperty.call(words, w) ? words[w] : m));
}

/** The printed footer line: the template, then " - YoSched" (always). */
export function footerLine(text: string, ctx: PrintTemplateContext): string {
  return (renderPrintTemplate(text, ctx) + YOSCHED_FOOTER_SUFFIX).trim();
}

export function validatePrintFontFamily(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9 -]{1,64}$/.test(v) && v.trim().length > 0;
}

export function validatePrintFontSize(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 6 && v <= 14;
}

/** CSS font stack for the printout: the chosen font, then the bundled free narrow font. */
export function printFontStack(family: string): string {
  const safe = validatePrintFontFamily(family) ? `"${family}", ` : "";
  return `${safe}var(--font-print-narrow), "Arial Narrow", sans-serif`;
}

export const DATE_COLUMN_FORMATS = ["MM-DD", "DD-MM", "MM/DD", "DD/MM", "M/D", "D/M", "DD.MM"] as const;
export type DateColumnFormat = (typeof DATE_COLUMN_FORMATS)[number];
export const DAY_COLUMN_FORMATS = ["DDD", "Ddd", "Dddd"] as const;
export type DayColumnFormat = (typeof DAY_COLUMN_FORMATS)[number];

export const DEFAULT_DATE_COLUMN_FORMAT: DateColumnFormat = "MM-DD";
export const DEFAULT_DAY_COLUMN_FORMAT: DayColumnFormat = "DDD";

export function isDateColumnFormat(v: unknown): v is DateColumnFormat {
  return typeof v === "string" && (DATE_COLUMN_FORMATS as readonly string[]).includes(v);
}
export function isDayColumnFormat(v: unknown): v is DayColumnFormat {
  return typeof v === "string" && (DAY_COLUMN_FORMATS as readonly string[]).includes(v);
}

/** iso "YYYY-MM-DD" → the DATE column text. */
export function formatDateColumn(iso: string, fmt: DateColumnFormat): string {
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  switch (fmt) {
    case "MM-DD": return `${pad2(m)}-${pad2(d)}`;
    case "DD-MM": return `${pad2(d)}-${pad2(m)}`;
    case "MM/DD": return `${pad2(m)}/${pad2(d)}`;
    case "DD/MM": return `${pad2(d)}/${pad2(m)}`;
    case "M/D": return `${m}/${d}`;
    case "D/M": return `${d}/${m}`;
    case "DD.MM": return `${pad2(d)}.${pad2(m)}`;
  }
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** dow 0 = Sunday → the DAY column text. */
export function formatDayColumn(dow: number, fmt: DayColumnFormat): string {
  const name = DAYS[dow] ?? "";
  switch (fmt) {
    case "DDD": return name.slice(0, 3).toUpperCase();
    case "Ddd": return name.slice(0, 3);
    case "Dddd": return name;
  }
}

/** "PP#01": the pay-period label printed to the right of the table (card #301). */
export function ppLabelText(n: number): string {
  return `PP#${pad2(n)}`;
}

export type PrintLayout = {
  header: PrintBlock;
  footer: PrintBlock;
  fontFamily: string;
  fontSize: number;
  splitDateDay: boolean;
  dateColumnFormat: DateColumnFormat;
  dayColumnFormat: DayColumnFormat;
  payPeriodLabels: boolean;
  paper: PrintPaper;
  marginHundredths: number;
};

export const DEFAULT_PRINT_FONT_FAMILY = "Aptos Narrow";
export const DEFAULT_PRINT_FONT_SIZE = 9;

export const DEFAULT_PRINT_LAYOUT: PrintLayout = {
  header: DEFAULT_PRINT_HEADER,
  footer: DEFAULT_PRINT_FOOTER,
  fontFamily: DEFAULT_PRINT_FONT_FAMILY,
  fontSize: DEFAULT_PRINT_FONT_SIZE,
  splitDateDay: true,
  dateColumnFormat: DEFAULT_DATE_COLUMN_FORMAT,
  dayColumnFormat: DEFAULT_DAY_COLUMN_FORMAT,
  payPeriodLabels: true,
  paper: "letter",
  marginHundredths: 25,
};

type PrintLayoutPrefs = {
  printHeader?: unknown;
  printFooter?: unknown;
  printFontFamily?: unknown;
  printFontSize?: unknown;
  splitDateDayColumns?: unknown;
  dateColumnFormat?: unknown;
  dayColumnFormat?: unknown;
  printPayPeriodLabels?: unknown;
  printPaperSize?: unknown;
  printMarginHundredthsIn?: unknown;
};

/** The SchedulingPreferences row (or null) → the print layout; each bad field → its default. */
export function printLayoutFrom(p: PrintLayoutPrefs | null | undefined): PrintLayout {
  const d = DEFAULT_PRINT_LAYOUT;
  if (!p) return { ...d, header: { ...d.header }, footer: { ...d.footer } };
  return {
    header: resolvePrintBlock(p.printHeader, "header"),
    footer: resolvePrintBlock(p.printFooter, "footer"),
    fontFamily: validatePrintFontFamily(p.printFontFamily) ? p.printFontFamily : d.fontFamily,
    fontSize: validatePrintFontSize(p.printFontSize) ? p.printFontSize : d.fontSize,
    splitDateDay: typeof p.splitDateDayColumns === "boolean" ? p.splitDateDayColumns : d.splitDateDay,
    dateColumnFormat: isDateColumnFormat(p.dateColumnFormat) ? p.dateColumnFormat : d.dateColumnFormat,
    dayColumnFormat: isDayColumnFormat(p.dayColumnFormat) ? p.dayColumnFormat : d.dayColumnFormat,
    payPeriodLabels: typeof p.printPayPeriodLabels === "boolean" ? p.printPayPeriodLabels : d.payPeriodLabels,
    paper: isPrintPaper(p.printPaperSize) ? p.printPaperSize : d.paper,
    marginHundredths: validatePrintMargin(p.printMarginHundredthsIn) ? p.printMarginHundredthsIn : d.marginHundredths,
  };
}

/** Card #323: the paper the printout and the year PDF are laid out for (landscape), and the
 *  margin on every side. The margin floor, 0.25in, is the widest unprintable edge among common
 *  office printers, so "Actual size" never clips; the default is that floor (David: "the
 *  largest that will print consistently on all standard printers using US letter"). */
export const PRINT_PAPERS = ["letter", "a4"] as const;
export type PrintPaper = (typeof PRINT_PAPERS)[number];
export const PAPER_IN: Record<PrintPaper, { wIn: number; hIn: number; label: string; css: string; jspdf: string }> = {
  letter: { wIn: 11, hIn: 8.5, label: "US Letter (11 × 8.5 in)", css: "letter", jspdf: "letter" },
  a4: { wIn: 297 / 25.4, hIn: 210 / 25.4, label: "A4 (297 × 210 mm)", css: "A4", jspdf: "a4" },
};
export const PRINT_MARGIN_MIN = 25;
export const PRINT_MARGIN_MAX = 100;
export const DEFAULT_PRINT_PAPER: PrintPaper = "letter";
export const DEFAULT_PRINT_MARGIN = 25;

export function isPrintPaper(v: unknown): v is PrintPaper {
  return typeof v === "string" && (PRINT_PAPERS as readonly string[]).includes(v);
}
/** Margin in hundredths of an inch: a whole number from 25 (0.25in) to 100 (1in). */
export function validatePrintMargin(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= PRINT_MARGIN_MIN && v <= PRINT_MARGIN_MAX;
}

/** The landscape page and its margin, in inches. Junk in the layout falls back to the defaults. */
export function printPage(layout: Pick<PrintLayout, "paper" | "marginHundredths">): { wIn: number; hIn: number; marginIn: number } {
  const paper = PAPER_IN[isPrintPaper(layout.paper) ? layout.paper : DEFAULT_PRINT_PAPER];
  const m = validatePrintMargin(layout.marginHundredths) ? layout.marginHundredths : DEFAULT_PRINT_MARGIN;
  return { wIn: paper.wIn, hIn: paper.hIn, marginIn: m / 100 };
}

/** What the print CSS puts around the rows (globals.css): the title and footer take their
 *  Settings size at line height 1.2 plus their padding; a cell's text sits at line height 1.2
 *  inside 2px of padding plus its borders; the slack covers the heavier grid lines. */
export const PRINT_BOX = {
  titleIn: (pt: number) => (pt * 1.2) / 72 + 4 / 96,
  footerIn: (pt: number) => (pt * 1.2) / 72 + 3 / 96,
  cellIn: (pt: number) => (pt * 1.2) / 72 + 4 / 96,
  slackIn: 0.15,
} as const;

export type PrintFit = { rowIn: number; contentMinIn: number; neededIn: number; scale: number };

/** Card #322 + #323: one row height for every month, so the header row and a 31-day month fill
 *  the page between the title and the footer. When that is less than the text needs (big
 *  margins, a big font or title), rows take what the text needs and the whole printout is
 *  shrunk (`scale` < 1) so it still fits one page. */
export function printFit(layout: Pick<PrintLayout, "header" | "footer" | "fontSize" | "paper" | "marginHundredths">): PrintFit {
  const P = PRINT_BOX;
  const page = printPage(layout);
  const inside = page.hIn - 2 * page.marginIn;
  const blocks = P.titleIn(layout.header.size) + P.footerIn(layout.footer.size) + P.slackIn;
  const pageRow = Math.floor(((inside - blocks) / 32) * 10000) / 10000;
  const contentMinIn = P.cellIn(layout.fontSize);
  const rowIn = Math.max(pageRow, Math.ceil(contentMinIn * 10000) / 10000);
  const neededIn = blocks + 32 * rowIn;
  const scale = neededIn <= inside ? 1 : Math.floor((inside / neededIn) * 1000) / 1000;
  return { rowIn, contentMinIn, neededIn, scale };
}

/** The printout's row height in inches (see printFit). */
export function printRowHeightIn(layout: Pick<PrintLayout, "header" | "footer" | "fontSize" | "paper" | "marginHundredths">): number {
  return printFit(layout).rowIn;
}

/** The print-only CSS for the page: built only from a known paper name and numbers, never from
 *  stored text. Zero page margin keeps the browser's own header and footer off (card #173); the
 *  margin is the body's padding instead. */
export function printPageStyle(layout: PrintLayout): string {
  const page = printPage(layout);
  const css = PAPER_IN[isPrintPaper(layout.paper) ? layout.paper : DEFAULT_PRINT_PAPER].css;
  const { scale } = printFit({ ...layout, paper: isPrintPaper(layout.paper) ? layout.paper : DEFAULT_PRINT_PAPER, marginHundredths: page.marginIn * 100 });
  return `@page{size:${css} landscape;margin:0}body{padding:${page.marginIn}in !important}` + (scale < 1 ? `[data-print-root]{zoom:${scale}}` : "");
}

/** Card #323: an aggregate column's print width in characters: the widest of its title and
 *  every day's list ("AB, CD"), so its cells stay on one line (rows never grow). */
export function aggPrintWidthCh(label: string, lists: readonly (readonly string[])[]): number {
  return Math.max(3, label.length, ...lists.map((l) => l.join(", ").length));
}

/** Card #328: the print widths (inches) of the fixed-width columns. globals.css and the grid
 *  use the same numbers (a test pins them), so the spare-room sum below matches the page. */
export const PRINT_COL_IN = { date: 0.42, dateSingle: 0.72, day: 0.36, dayLong: 0.62, ded: 0.48, ppLabel: 0.34 } as const;

/** Card #328: the inches the fixed-width columns take: the date block, the pay-period label
 *  strip (when on) and each dedicated shift column. */
export function printReservedIn(layout: Pick<PrintLayout, "splitDateDay" | "dayColumnFormat" | "payPeriodLabels">, dedicatedCount: number): number {
  const ded = Number.isInteger(dedicatedCount) && dedicatedCount > 0 ? dedicatedCount : 0;
  const date = layout.splitDateDay ? PRINT_COL_IN.date + (layout.dayColumnFormat === "Dddd" ? PRINT_COL_IN.dayLong : PRINT_COL_IN.day) : PRINT_COL_IN.dateSingle;
  return date + (layout.payPeriodLabels ? PRINT_COL_IN.ppLabel : 0) + ded * PRINT_COL_IN.ded;
}

/** Card #328: the longest text (characters) any equal-share column prints: staff initials,
 *  their shift codes and request letters, count titles and numbers. In a fixed table those
 *  columns share the rest of the page equally, so one need covers them all. */
export function autoColNeedCh(texts: Iterable<string>): number {
  let n = 1;
  for (const t of texts) if (t.length > n) n = t.length;
  return n;
}

/** Card #328: what an equal-share column needs besides its text: the cell's side padding and
 *  its share of the collapsed borders (trial: 1px padding each side + 1.6px border), rounded up. */
export const AUTO_COL_PAD_PX = 5;
/** Card #328: before the browser has measured the staff text (first paint, or no DOM), each
 *  character counts as this many `ch`: the widest measured in the bundled narrow print font
 *  ("WWW" bold, 1.8ch a letter), so the fallback never squeezes staff codes. */
export const AUTO_COL_FALLBACK_CH = 1.8;

/** Card #328: the widest of `texts` in pixels as `measure` (the browser, in the Settings print
 *  font and size, bold) reports it; null when nothing could be measured. */
export function autoColNeedPx(texts: Iterable<string>, measure: (text: string) => number): number | null {
  let max = 0, any = false;
  for (const t of texts) {
    if (!t) continue;
    const w = measure(t);
    if (!Number.isFinite(w) || w < 0) return null;
    any = true;
    if (w > max) max = w;
  }
  return any ? Math.ceil(max) : null;
}

/** autoNeedPx: the measured widest staff/count text (null = not measured yet: autoNeedCh ×
 *  AUTO_COL_FALLBACK_CH is used instead). */
export type AggRoom = { reservedIn: number; autoCount: number; autoNeedPx: number | null; autoNeedCh: number; titlesCh: readonly number[] };

const finite = (n: number, min = 0) => (Number.isFinite(n) && n > min ? n : min);

/** Card #327 + #328: an aggregate column's print width (CSS): fits its longest text
 *  (aggPrintWidthCh), but never past its title plus an equal part of the spare room. The spare
 *  room is the printable width (divided by the shrink factor: the zoom in printPageStyle scales
 *  inches too) less the fixed columns, less what the equal-share staff/count columns need, less
 *  EVERY aggregate title (Codex #1562: a long title on one column must not take another's staff
 *  room). The staff need is measured by the browser in the print font (autoColNeedPx).
 *  When nothing is spare the title alone (it always fits on one line, card #323).
 *  Never a percentage: Chrome drops a min() holding a % for a fixed-layout table cell. */
export function aggPrintWidthCss(label: string, lists: readonly (readonly string[])[], room: AggRoom, layout: PrintLayout): string {
  const page = printPage(layout);
  const { scale } = printFit({ ...layout, paper: isPrintPaper(layout.paper) ? layout.paper : DEFAULT_PRINT_PAPER, marginHundredths: page.marginIn * 100 });
  const titleCh = aggPrintWidthCh(label, []);
  const titles = room.titlesCh.length > 0 ? room.titlesCh.map((t) => finite(t)) : [titleCh];
  const k = titles.length;
  const sumCh = titles.reduce((s, t) => s + t, 0);
  const w = +((page.wIn - 2 * page.marginIn) / scale - finite(room.reservedIn)).toFixed(4);
  const autoCount = Number.isInteger(room.autoCount) && room.autoCount > 0 ? room.autoCount : 0;
  const needCh = Number.isFinite(room.autoNeedCh) && room.autoNeedCh > 1 ? room.autoNeedCh : 1;
  const need = room.autoNeedPx != null && Number.isFinite(room.autoNeedPx) && room.autoNeedPx > 0
    ? `${Math.ceil(room.autoNeedPx) + AUTO_COL_PAD_PX}px`
    : `(${+(needCh * AUTO_COL_FALLBACK_CH).toFixed(4)}ch + ${AUTO_COL_PAD_PX}px)`;
  const spare = `max(0px, calc((${w}in - ${autoCount} * ${need} - ${sumCh}ch - ${k * 12}px) / ${k}))`;
  return `min(calc(${aggPrintWidthCh(label, lists)}ch + 12px), calc(${titleCh}ch + 12px + ${spare}))`;
}
