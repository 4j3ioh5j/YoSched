// Card #301: the printed month schedule's header, footer, font and DATE/DAY columns.
// Everything here is pure, so the printout and the year export (card #299) share it.
// The values are Settings (SchedulingPreferences); these are only the defaults.

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
    DATE: formatDate(ctx.printedAt, ctx.dateFormat),
    TIME: `${pad2(ctx.printedAt.getHours())}:${pad2(ctx.printedAt.getMinutes())}`,
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
  };
}

/** Card #322: the browser printout's page, in inches. The browser prints on whatever paper the
 *  printer is set to, so the row height is sized for the shorter of US Letter (8.5in) and A4
 *  (210mm) in landscape: a 31-day month then fits one page on either. The margin is the print
 *  CSS's body padding (globals.css). The title and footer take their Settings size at line
 *  height 1.2 plus their CSS padding; the slack covers the heavier grid lines (outer edges,
 *  pay-period double lines) that add to the rows' height. */
export const PRINT_PAGE = {
  heightIn: Math.min(8.5, 210 / 25.4),
  marginIn: 0.4,
  titleIn: (pt: number) => (pt * 1.2) / 72 + 4 / 96,
  footerIn: (pt: number) => (pt * 1.2) / 72 + 3 / 96,
  slackIn: 0.15,
} as const;

/** The printout's row height in inches, the same for every month: the header row and a
 *  31-day month fill the page between the title and the footer. */
export function printRowHeightIn(layout: Pick<PrintLayout, "header" | "footer">): number {
  const P = PRINT_PAGE;
  const avail = P.heightIn - 2 * P.marginIn - P.titleIn(layout.header.size) - P.footerIn(layout.footer.size) - P.slackIn;
  return Math.floor((avail / 32) * 10000) / 10000;
}
