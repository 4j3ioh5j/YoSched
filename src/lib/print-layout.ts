// Card #301: the printed month schedule's header, footer, font and DATE/DAY columns.
// Everything here is pure, so the printout and the year export (card #299) share it.
// The values are Settings (SchedulingPreferences); these are only the defaults.

import { wallClock, zonedCalendarDate } from "./time-zone";
import { formatDate, type DateFormatKey } from "./date-format";
import { DEFAULT_PDF_FONT, isPdfFontId } from "./pdf-fonts";

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
  /** Card #320: the Settings time zone; {DATE} and {TIME} are in it. Card #368: {TIME} prints no zone label. */
  zone: string;
};

const pad2 = (n: number) => (n < 10 ? "0" + n : String(n));

/** "17:00": the 24-hour wall clock in `zone`, without the zone label (card #368). */
function clock24(date: Date, zone: string): string {
  const w = wallClock(date, zone);
  return `${pad2(w.hour)}:${pad2(w.minute)}`;
}

/** Fill-in words: {MONTH} JANUARY, {Month} January, {MON} JAN, {YEAR}, {DATE} (date format
 *  setting), {TIME} (24-hour, no time zone: card #368), {VERSION} (saved version, two digits; "—" when none).
 *  Anything else is left exactly as typed. Plain text: callers render it as text. */
export function renderPrintTemplate(text: string, ctx: PrintTemplateContext): string {
  const name = MONTHS[ctx.month] ?? "";
  const words: Record<string, string> = {
    MONTH: name.toUpperCase(),
    Month: name,
    MON: name.slice(0, 3).toUpperCase(),
    YEAR: String(ctx.year),
    DATE: formatDate(zonedCalendarDate(ctx.printedAt, ctx.zone), ctx.dateFormat),
    TIME: clock24(ctx.printedAt, ctx.zone),
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

/** Card #357: how wide the user-defined columns print (additional columns such as OTHER and
 *  shift columns such as CARD/ICU/OR): each at its best fit (the default), all at the widest
 *  best fit, one custom width for all, or a custom width per column (a column without one:
 *  best fit). Widths are in hundredths of an inch; per-column entries are keyed like the
 *  Column Order ("agg:<id>", "ded:<id>"), and a key naming no current column is ignored. */
export const UD_WIDTH_MODES = ["bestFit", "matchLargest", "uniform", "perColumn"] as const;
export type UdWidthMode = (typeof UD_WIDTH_MODES)[number];
export type UdWidthSettings = { mode: UdWidthMode; uniformHundredths: number; perColumn: Record<string, number> };
export const UD_WIDTH_MIN = 20;
export const UD_WIDTH_MAX = 200;
export const UD_WIDTH_MAX_ENTRIES = 500;
export const DEFAULT_UD_WIDTH: UdWidthSettings = Object.freeze({ mode: "bestFit", uniformHundredths: 50, perColumn: Object.freeze({}) as Record<string, number> }) as UdWidthSettings;
const UD_KEY_RE = /^(agg|ded):[A-Za-z0-9_-]{1,64}$/;

export function isUdWidthMode(v: unknown): v is UdWidthMode {
  return typeof v === "string" && (UD_WIDTH_MODES as readonly string[]).includes(v);
}
export function validUdHundredths(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= UD_WIDTH_MIN && v <= UD_WIDTH_MAX;
}
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The stored settings → the choice; each bad field (or per-column entry) → its default. */
export function parseUdWidth(mode: unknown, hundredths: unknown, perColumn: unknown): UdWidthSettings {
  const map: Record<string, number> = {};
  if (isPlainObject(perColumn)) {
    for (const [k, v] of Object.entries(perColumn).slice(0, UD_WIDTH_MAX_ENTRIES)) if (UD_KEY_RE.test(k) && validUdHundredths(v)) map[k] = v;
  }
  return {
    mode: isUdWidthMode(mode) ? mode : DEFAULT_UD_WIDTH.mode,
    uniformHundredths: validUdHundredths(hundredths) ? hundredths : DEFAULT_UD_WIDTH.uniformHundredths,
    perColumn: map,
  };
}

/** Strict check of a Settings save: undefined fields are not being saved. */
export function validateUdWidthPatch(b: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  if (b.printUdWidthMode !== undefined && !isUdWidthMode(b.printUdWidthMode)) return { ok: false, error: `printUdWidthMode must be one of ${UD_WIDTH_MODES.join(", ")}` };
  if (b.printUdWidthHundredths !== undefined && !validUdHundredths(b.printUdWidthHundredths)) return { ok: false, error: `printUdWidthHundredths must be a whole number from ${UD_WIDTH_MIN} to ${UD_WIDTH_MAX}` };
  const m = b.printUdColumnWidths;
  if (m !== undefined) {
    if (!isPlainObject(m)) return { ok: false, error: "printUdColumnWidths must be an object of column widths" };
    const entries = Object.entries(m);
    if (entries.length > UD_WIDTH_MAX_ENTRIES) return { ok: false, error: `printUdColumnWidths has more than ${UD_WIDTH_MAX_ENTRIES} entries` };
    for (const [k, v] of entries) {
      if (!UD_KEY_RE.test(k)) return { ok: false, error: "printUdColumnWidths keys must look like agg:<id> or ded:<id>" };
      if (!validUdHundredths(v)) return { ok: false, error: `printUdColumnWidths widths must be whole numbers from ${UD_WIDTH_MIN} to ${UD_WIDTH_MAX}` };
    }
  }
  return { ok: true };
}

/** Card #364: how a user-defined column sizes in the on-screen print columns view, whose text
 *  is larger than the printout's: "fit" = as wide as its screen text (best fit), "atLeast" =
 *  the printout's width or wider if its text needs it (match largest), "fixed" = a width the
 *  user set (one width for all, or Custom), whose day text clips. A header never clips, so a
 *  column is never narrower than its title. */
export function udScreenSizing(s: UdWidthSettings, key: string): "fit" | "atLeast" | "fixed" {
  if (s.mode === "uniform") return "fixed";
  if (s.mode === "matchLargest") return "atLeast";
  if (s.mode === "perColumn" && validUdHundredths(s.perColumn[key])) return "fixed";
  return "fit";
}

/** Card #364: a set width (hundredths of an inch) is narrower than the column's title (inches,
 *  as the printout measures it, rounded up to the hundredth Settings shows). Unknown: false. */
export function udNarrowerThanTitle(hundredths: number | null | undefined, titleIn: number | null | undefined): boolean {
  if (hundredths == null || !Number.isFinite(hundredths) || titleIn == null || !Number.isFinite(titleIn) || titleIn <= 0) return false;
  return hundredths < Math.ceil(Math.round(titleIn * 1e6) / 1e4);
}

/** Card #364: the one screen width (CSS px, rounded up) the equal-width modes share, from the
 *  screen widths of the headers and day cells (text + padding + borders): one width for all =
 *  the widest header, match largest = the widest header or day text. Other modes, or nothing
 *  measured: null. A header widens every column together, never one alone. */
export function udScreenEqualPx(s: UdWidthSettings, headPx: readonly number[], cellPx: readonly number[]): number | null {
  if (s.mode !== "uniform" && s.mode !== "matchLargest") return null;
  const all = s.mode === "uniform" ? headPx : [...headPx, ...cellPx];
  const ok = all.filter((v) => Number.isFinite(v) && v > 0);
  return ok.length ? Math.ceil(Math.max(...ok)) : null;
}

/** Card #364: the width (inches) a set width narrower than the title prints at: one width for
 *  all floors every column at the widest title; a Custom width at its own title. */
export function udTitleFloorIn(mode: UdWidthSettings["mode"], key: string, cols: Readonly<Record<string, { titleIn?: number }>>): number | null {
  const ok = (v: number | undefined): v is number => v != null && Number.isFinite(v) && v > 0;
  if (mode === "uniform") {
    const t = Object.values(cols).map((c) => c.titleIn).filter(ok);
    return t.length ? Math.max(...t) : null;
  }
  const own = cols[key]?.titleIn;
  return ok(own) ? own : null;
}

export type UdColumnFit = { key: string; fitIn: number; titleIn: number };
const posFinite = (n: number) => Number.isFinite(n) && n > 0;
/** A column's best fit, never junk: its fit, else its title, else the narrowest custom width. */
const safeFit = (c: UdColumnFit) => posFinite(c.fitIn) ? c.fitIn : posFinite(c.titleIn) ? c.titleIn : UD_WIDTH_MIN / 100;
const safeTitle = (c: UdColumnFit) => posFinite(c.titleIn) ? c.titleIn : 0;

/** Card #357: the width (inches) each user-defined column asks for under the Settings choice,
 *  never narrower than its title (a header prints on one line, card #323). */
export function udRequestedIn(s: UdWidthSettings, cols: readonly UdColumnFit[]): Map<string, number> {
  const out = new Map<string, number>();
  const largest = cols.reduce((m, c) => Math.max(m, safeFit(c)), 0);
  // One width / match largest: one group with one floor (the widest title), so they stay equal.
  const equal = s.mode === "uniform" || s.mode === "matchLargest";
  const maxTitle = cols.reduce((m, c) => Math.max(m, safeTitle(c)), 0);
  for (const c of cols) {
    const custom = s.perColumn[c.key];
    const w = s.mode === "matchLargest" ? largest
      : s.mode === "uniform" ? s.uniformHundredths / 100
      : s.mode === "perColumn" && validUdHundredths(custom) ? custom / 100
      : safeFit(c);
    out.set(c.key, Math.max(w, equal ? maxTitle : safeTitle(c)));
  }
  return out;
}

/** Card #357: the requested widths fitted to `roomIn`, what the page leaves the user-defined
 *  columns. When they do not fit, every column narrows together: the room beyond the titles is
 *  shared in proportion to what each asks beyond its title, and no column goes below its title
 *  (a header prints on one line, card #323). A junk room keeps the requested widths. */
export function udWidthsIn(s: UdWidthSettings, cols: readonly UdColumnFit[], roomIn: number): Map<string, number> {
  // Fit the requested widths into roomIn with one shared cap (water-fill): every column is
  // min(requested, cap), never below its title, and the cap is the widest that fills the room
  // exactly. Columns asking the same width stay equal (one width / match largest), the widest
  // narrow first, and the total never exceeds the room unless the titles alone do — then each
  // column keeps its title (the header stays on one line) and the page's own fit (browser
  // scale-to-fit, PDF font shrink) absorbs the rest.
  const req = udRequestedIn(s, cols);
  if (cols.length === 0) return req; // nothing to fit (a month with no user-defined columns)
  const total = [...req.values()].reduce((a, b) => a + b, 0);
  if (!Number.isFinite(roomIn) || total <= roomIn) return req;
  if (s.mode === "uniform" || s.mode === "matchLargest") {
    // One group: the same width for all, never below the widest title.
    const maxTitle = cols.reduce((m, c) => Math.max(m, safeTitle(c)), 0);
    const each = Math.max(maxTitle, Math.min(req.get(cols[0].key)!, roomIn / cols.length));
    return new Map(cols.map((c) => [c.key, each]));
  }
  const titles = cols.map((c) => safeTitle(c));
  const want = cols.map((c) => req.get(c.key)!);
  const widthAt = (cap: number) => cols.map((_, i) => Math.max(titles[i], Math.min(want[i], cap)));
  const sumAt = (cap: number) => widthAt(cap).reduce((a, b) => a + b, 0);
  let lo = 0;
  let hi = Math.max(0, ...want);
  if (sumAt(lo) >= roomIn) hi = lo;
  else for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (sumAt(mid) > roomIn) hi = mid; else lo = mid; }
  const w = widthAt(sumAt(hi) > roomIn ? lo : hi);
  const out = new Map<string, number>();
  cols.forEach((c, i) => out.set(c.key, w[i]));
  return out;
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
  udWidth: UdWidthSettings;
  /** Card #477: the font the PDF embeds (an id from pdf-fonts.ts). */
  pdfFont: string;
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
  udWidth: DEFAULT_UD_WIDTH,
  pdfFont: DEFAULT_PDF_FONT,
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
  printUdWidthMode?: unknown;
  printUdWidthHundredths?: unknown;
  printUdColumnWidths?: unknown;
  printPdfFont?: unknown;
};

/** The SchedulingPreferences row (or null) → the print layout; each bad field → its default. */
export function printLayoutFrom(p: PrintLayoutPrefs | null | undefined): PrintLayout {
  const d = DEFAULT_PRINT_LAYOUT;
  if (!p) return { ...d, header: { ...d.header }, footer: { ...d.footer }, udWidth: parseUdWidth(undefined, undefined, undefined) };
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
    udWidth: parseUdWidth(p.printUdWidthMode, p.printUdWidthHundredths, p.printUdColumnWidths),
    pdfFont: isPdfFontId(p.printPdfFont) ? p.printPdfFont : d.pdfFont,
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
export function printFit(layout: Pick<PrintLayout, "header" | "footer" | "fontSize" | "paper" | "marginHundredths">, days = 31): PrintFit {
  const P = PRINT_BOX;
  const page = printPage(layout);
  const inside = page.hIn - 2 * page.marginIn;
  const blocks = P.titleIn(layout.header.size) + P.footerIn(layout.footer.size) + P.slackIn;
  // Card #462: a month that prints 32 days (its weekend's second day added) budgets one more row;
  // every month of 31 days or fewer keeps the same row height.
  const rows = Math.max(31, Number.isInteger(days) ? days : 31) + 1;
  const pageRow = Math.floor(((inside - blocks) / rows) * 10000) / 10000;
  const contentMinIn = P.cellIn(layout.fontSize);
  const rowIn = Math.max(pageRow, Math.ceil(contentMinIn * 10000) / 10000);
  const neededIn = blocks + rows * rowIn;
  const scale = neededIn <= inside ? 1 : Math.floor((inside / neededIn) * 1000) / 1000;
  return { rowIn, contentMinIn, neededIn, scale };
}

/** The printout's row height in inches (see printFit). */
export function printRowHeightIn(layout: Pick<PrintLayout, "header" | "footer" | "fontSize" | "paper" | "marginHundredths">, days?: number): number {
  return printFit(layout, days).rowIn;
}

/** Card #357: the printout's shrink factor with the width taken into account too: when the
 *  columns need more than the printable width (at the height shrink), everything shrinks
 *  further so the row still fits across the page. A junk or absent need keeps the height one. */
export function printWidthScale(printableWIn: number, heightScale: number, widthNeedIn?: number): number {
  if (widthNeedIn == null || !Number.isFinite(widthNeedIn) || widthNeedIn <= 0) return heightScale;
  if (widthNeedIn * heightScale <= printableWIn + 1e-9) return heightScale;
  // Rounded down so the row always fits; never zero (a zoom of 0 would hide the printout).
  const f = Math.floor((printableWIn / widthNeedIn) * 1000) / 1000;
  return f > 0 ? f : printableWIn / widthNeedIn;
}

/** The print-only CSS for the page: built only from a known paper name and numbers, never from
 *  stored text. Zero page margin keeps the browser's own header and footer off (card #173); the
 *  margin is the body's padding instead. */
export function printPageStyle(layout: PrintLayout, widthNeedIn?: number, days?: number): string {
  const page = printPage(layout);
  const css = PAPER_IN[isPrintPaper(layout.paper) ? layout.paper : DEFAULT_PRINT_PAPER].css;
  const fit = printFit({ ...layout, paper: isPrintPaper(layout.paper) ? layout.paper : DEFAULT_PRINT_PAPER, marginHundredths: page.marginIn * 100 }, days);
  const scale = printWidthScale(page.wIn - 2 * page.marginIn, fit.scale, widthNeedIn);
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

/** Card #330: the widest text over groups measured in different fonts (staff text in the
 *  Settings print font, count text also in the monospace font its cells print in), scaled back
 *  to full size: a measurement taken while the printout is zoomed reports zoom × the width.
 *  A group with nothing to measure is skipped; a bad measurement anywhere gives null (fallback). */
export function printNeedPx(groups: readonly { texts: Iterable<string>; measure: (text: string) => number }[], zoom: number): number | null {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  let need: number | null = null;
  for (const g of groups) {
    const texts = [...g.texts].filter(Boolean);
    if (texts.length === 0) continue;
    const px = autoColNeedPx(texts, (t) => g.measure(t) / z);
    if (px == null) return null;
    need = Math.max(need ?? 0, px);
  }
  return need;
}


const finite = (n: number, min = 0) => (Number.isFinite(n) && n > min ? n : min);


/** Card #357: what a user-defined print cell needs besides its text (side padding + borders),
 *  the same 12px the additional columns always had. */
export const UD_CELL_PAD_PX = 12;
/** Card #357: one user-defined column of the browser printout. fitPx / titlePx are the widest
 *  day text and the title as the browser measured them in the print font (null = not measured
 *  yet: fitCh / titleCh characters at AUTO_COL_FALLBACK_CH × half the font size are used). */
export type UdPrintCol = { key: string; fitPx: number | null; titlePx: number | null; fitCh: number; titleCh: number };
export type UdPrintRoom = { reservedIn: number; autoCount: number; autoNeedPx: number | null; autoNeedCh: number };

/** Card #357: the browser printout's width (inches) for each user-defined column, from the
 *  Settings choice, fitted into the room the fixed columns and the equal-share staff and count
 *  columns leave on the page (divided by the shrink factor: the print zoom scales inches too). */
export function printUdWidthsIn(layout: PrintLayout, cols: readonly UdPrintCol[], room: UdPrintRoom, days?: number): { widths: Map<string, number>; needIn: number; bestFitIn: Map<string, number>; titleIn: Map<string, number> } {
  const page = printPage(layout);
  const { scale } = printFit({ ...layout, paper: isPrintPaper(layout.paper) ? layout.paper : DEFAULT_PRINT_PAPER, marginHundredths: page.marginIn * 100 }, days);
  const fontPt = Number.isFinite(layout.fontSize) && layout.fontSize > 0 ? layout.fontSize : DEFAULT_PRINT_FONT_SIZE;
  const chIn = (ch: number) => (finite(ch) * AUTO_COL_FALLBACK_CH * fontPt * 0.5) / 72;
  const inOf = (px: number | null, ch: number) =>
    (px != null && Number.isFinite(px) && px >= 0 ? px / 96 : chIn(ch)) + UD_CELL_PAD_PX / 96;
  const fits: UdColumnFit[] = cols.map((c) => {
    const titleIn = inOf(c.titlePx, c.titleCh);
    return { key: c.key, titleIn, fitIn: Math.max(titleIn, inOf(c.fitPx, c.fitCh)) };
  });
  const autoCount = Number.isInteger(room.autoCount) && room.autoCount > 0 ? room.autoCount : 0;
  const needCh = Number.isFinite(room.autoNeedCh) && room.autoNeedCh > 1 ? room.autoNeedCh : 1;
  const needIn = room.autoNeedPx != null && Number.isFinite(room.autoNeedPx) && room.autoNeedPx > 0
    ? (Math.ceil(room.autoNeedPx) + AUTO_COL_PAD_PX) / 96
    : chIn(needCh) + AUTO_COL_PAD_PX / 96;
  const fixedIn = finite(room.reservedIn) + autoCount * needIn;
  const roomIn = (page.wIn - 2 * page.marginIn) / scale - fixedIn;
  const widths = udWidthsIn(layout.udWidth ?? DEFAULT_UD_WIDTH, fits, Math.max(0, roomIn));
  // needIn: the whole row's width at full size; printPageStyle shrinks the printout when the
  // titles alone do not fit (printWidthScale).
  // bestFitIn (card #359): each column's own best fit, shown in Settings to help choose a width.
  // titleIn (card #364): each title's width, so Settings can warn about a set width under it.
  return { widths, needIn: fixedIn + [...widths.values()].reduce((a, b) => a + b, 0), bestFitIn: new Map(fits.map((f) => [f.key, f.fitIn])), titleIn: new Map(fits.map((f) => [f.key, f.titleIn])) };
}

