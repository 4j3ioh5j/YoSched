import { describe, it, expect } from "vitest";
import { pdfMonthLayout, pdfPage } from "../export-pdf";
import { buildPrintedMonth, type PrintedMonth } from "../print-month-model";
import { DEFAULT_PRINT_LAYOUT, DEFAULT_UD_WIDTH, type UdWidthSettings } from "../print-layout";
import { input, NOW } from "./fixtures/export-input";

// Card #357: the year PDF honors the Settings width choice for the user-defined columns
// (additional columns such as OTHER, shift columns such as ICU).

function month(ud: Partial<UdWidthSettings>): PrintedMonth {
  const m = buildPrintedMonth(input({ printLayout: { ...DEFAULT_PRINT_LAYOUT, udWidth: { ...DEFAULT_UD_WIDTH, ...ud } } }), 2026, 0, NOW);
  // Add two additional columns: a short one and one with long initials lists.
  const columns = [...m.columns, { kind: "agg" as const, label: "OTHER", key: "agg:o" }, { kind: "agg" as const, label: "X", key: "agg:x" }];
  const rows = m.rows.map((r, k) => ({
    ...r,
    cells: [...r.cells, { text: "AB", bg: null, bold: false }, { text: k === 3 ? "AB, CD, EF, GH, IJ" : "", bg: null, bold: false }],
  }));
  return { ...m, columns, rows } as PrintedMonth;
}
const off = (m: PrintedMonth) => (m.splitDateDay ? 2 : 1);
const udIdx = (m: PrintedMonth) => m.columns.map((c, i) => (c.kind === "agg" || c.kind === "ded" ? i + off(m) : -1)).filter((i) => i >= 0);
const fitsPage = (m: PrintedMonth) => {
  const l = pdfMonthLayout(m);
  const P = pdfPage(m.layout);
  expect(l.tableLeft + l.colW.reduce((a, b) => a + b, 0) + l.labelW).toBeLessThanOrEqual(P.w - P.margin + 0.01);
  return l;
};

describe("PDF user-defined column widths (card #357)", () => {
  it("the fixture has a shift column and the two additional columns", () => {
    const m = month({});
    expect(m.columns.filter((c) => c.kind === "ded").length).toBeGreaterThan(0);
    expect(udIdx(m)).toHaveLength(m.columns.filter((c) => c.kind === "ded").length + 2);
  });
  it("best fit: the long column is wider than the short one, and neither is stretched past its fit", () => {
    const m = month({});
    const l = fitsPage(m);
    const [o, x] = udIdx(m).slice(-2);
    expect(l.colW[x]).toBeGreaterThan(l.colW[o]);
    // fit = longest text estimate + pad; stretched columns would be 2.5x
    expect(l.colW[o]).toBeLessThan(l.fontSize * 0.52 * 5 + 4 + 0.01);
  });
  it("match largest: every user-defined column has the same width", () => {
    const m = month({ mode: "matchLargest" });
    const l = fitsPage(m);
    const ws = udIdx(m).map((i) => l.colW[i]);
    for (const w of ws) expect(w).toBeCloseTo(ws[0], 6);
    expect(ws[0]).toBeGreaterThan(l.fontSize * 0.52 * 10);
  });
  it("one width: every user-defined column is that width in inches", () => {
    const m = month({ mode: "uniform", uniformHundredths: 80 });
    const l = fitsPage(m);
    for (const i of udIdx(m)) expect(l.colW[i]).toBeCloseTo(0.8 * 72, 6);
  });
  it("per column: the set column takes its width, the rest best fit", () => {
    const m = month({ mode: "perColumn", perColumn: { "agg:o": 100 } });
    const best = pdfMonthLayout(month({}));
    const l = fitsPage(m);
    const [o, x] = udIdx(m).slice(-2);
    expect(l.colW[o]).toBeCloseTo(72, 6);
    expect(l.colW[x]).toBeCloseTo(best.colW[x], 6);
  });
  it("a huge one width still fits the page, the columns staying equal", () => {
    const m = month({ mode: "uniform", uniformHundredths: 200 });
    const many = { ...m, columns: [...m.columns, ...Array.from({ length: 8 }, (_, i) => ({ kind: "agg" as const, label: `A${i}`, key: `agg:a${i}` }))],
      rows: m.rows.map((r) => ({ ...r, cells: [...r.cells, ...Array.from({ length: 8 }, () => ({ text: "", bg: null, bold: false }))] })) } as PrintedMonth;
    const l = fitsPage(many);
    const ws = udIdx(many).map((i) => l.colW[i]);
    for (const w of ws) expect(w).toBeCloseTo(ws[0], 6);
    expect(ws[0]).toBeLessThan(144);
  });
});

describe("pdfCellFontSize (card #357)", () => {
  it("keeps the size when the text fits, shrinks it to the cell when it does not", async () => {
    const { pdfCellFontSize } = await import("../export-pdf");
    expect(pdfCellFontSize("AB", 40, 9)).toBe(9);
    const s = pdfCellFontSize("AB, CD, EF, GH, IJ", 30, 9);
    expect(s).toBeLessThan(9);
    expect("AB, CD, EF, GH, IJ".length * s * 0.52).toBeCloseTo(30 - 4, 6);
    expect(pdfCellFontSize("", 30, 9)).toBe(9);
  });
});

describe("PDF titles wider than the page (reviewer round 2)", () => {
  const wide = (mode: UdWidthSettings["mode"]) => {
    const m = month({ mode, uniformHundredths: 20 });
    const extra = Array.from({ length: 12 }, (_, i) => ({ kind: "agg" as const, label: i === 0 ? "A VERY LONG ADDITIONAL COLUMN TITLE" : `C${i}`, key: `agg:w${i}` }));
    return { ...m, columns: [...m.columns, ...extra],
      rows: m.rows.map((r) => ({ ...r, cells: [...r.cells, ...extra.map(() => ({ text: "AB", bg: null, bold: false }))] })) } as PrintedMonth;
  };
  it.each(["uniform", "matchLargest", "bestFit", "perColumn"] as const)("%s: the font shrinks so the row still fits the page", (mode) => {
    const m = wide(mode);
    const l = fitsPage(m);
    // equal modes put every column at the long title's width, which only fits at a smaller font
    if (mode === "uniform" || mode === "matchLargest") expect(l.fontSize).toBeLessThan(9);
    expect(l.fontSize).toBeGreaterThan(0);
    // every title fits its column at the shrunk font
    const heads = [...(m.splitDateDay ? ["DATE", "DAY"] : ["DATE"]), ...m.columns.map((c) => c.label)];
    for (const i of udIdx(m)) expect(l.colW[i] + 1e-6).toBeGreaterThanOrEqual(heads[i].length * l.fontSize * 0.52 + 4);
    if (mode === "uniform" || mode === "matchLargest") {
      const ws = udIdx(m).map((i) => l.colW[i]);
      for (const w of ws) expect(w).toBeCloseTo(ws[0], 6);
    }
  });
});

describe("PDF in an equal mode with no user-defined columns (reviewer round 3 warning)", () => {
  it.each(["uniform", "matchLargest"] as const)("%s: many staff columns still lay out", (mode) => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, initials: `S${i}`, employmentTypeId: "ft", ftePercentage: 1, isActive: true }));
    const m = buildPrintedMonth(input({ staff: many, printLayout: { ...DEFAULT_PRINT_LAYOUT, udWidth: { ...DEFAULT_UD_WIDTH, mode } } }), 2026, 11, NOW);
    const bare = { ...m, columns: m.columns.filter((c) => c.kind === "staff" || c.kind === "count"),
      rows: m.rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => m.columns[i].kind === "staff" || m.columns[i].kind === "count") })) } as PrintedMonth;
    expect(udIdx(bare)).toHaveLength(0);
    fitsPage(bare);
  });
});
