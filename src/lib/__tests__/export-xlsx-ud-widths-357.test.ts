import { describe, it, expect } from "vitest";
import { xlsxColumnWidths } from "../export-xlsx";
import { buildPrintedMonth, type PrintedMonth } from "../print-month-model";
import { DEFAULT_PRINT_LAYOUT, DEFAULT_UD_WIDTH, type UdWidthSettings } from "../print-layout";
import { input, NOW } from "./fixtures/export-input";

// Card #357: the year spreadsheet honors the Settings width choice for the user-defined columns.
function month(ud: Partial<UdWidthSettings>): PrintedMonth {
  const m = buildPrintedMonth(input({ printLayout: { ...DEFAULT_PRINT_LAYOUT, udWidth: { ...DEFAULT_UD_WIDTH, ...ud } } }), 2026, 0, NOW);
  const columns = [...m.columns, { kind: "agg" as const, label: "OTHER", key: "agg:o" }, { kind: "agg" as const, label: "X", key: "agg:x" }];
  const rows = m.rows.map((r, k) => ({ ...r, cells: [...r.cells, { text: "AB", bg: null, bold: false }, { text: k === 3 ? "AB, CD, EF, GH, IJ" : "", bg: null, bold: false }] }));
  return { ...m, columns, rows } as PrintedMonth;
}
const idx = (m: PrintedMonth, kinds: string[]) => m.columns.map((c, i) => (kinds.includes(c.kind) ? i : -1)).filter((i) => i >= 0);

describe("xlsxColumnWidths (card #357)", () => {
  it("best fit measures the day texts, not only the label", () => {
    const m = month({});
    const w = xlsxColumnWidths(m);
    const [o, x] = idx(m, ["agg"]).slice(-2);
    expect(w[x]).toBeCloseTo(18 * 1.1 + 1.5, 6); // "AB, CD, EF, GH, IJ" is longer than the label "X"
    expect(w[o]).toBeCloseTo(5 * 1.1 + 1.5, 6);
  });
  it("staff columns stay narrow", () => {
    const m = month({ mode: "uniform", uniformHundredths: 150 });
    for (const i of idx(m, ["staff"])) expect(xlsxColumnWidths(m)[i]).toBe(4.71);
  });
  it("match largest gives every user-defined column the widest fit", () => {
    const m = month({ mode: "matchLargest" });
    const w = xlsxColumnWidths(m);
    for (const i of idx(m, ["agg", "ded"])) expect(w[i]).toBeCloseTo(18 * 1.1 + 1.5, 6);
  });
  it("one width converts inches to Excel width", () => {
    const m = month({ mode: "uniform", uniformHundredths: 100 });
    const w = xlsxColumnWidths(m);
    for (const i of idx(m, ["agg", "ded"])) expect(w[i]).toBeCloseTo((96 - 5) / 7, 6);
  });
  it("per column: the set column takes its width, the rest best fit", () => {
    const m = month({ mode: "perColumn", perColumn: { "agg:o": 150 } });
    const w = xlsxColumnWidths(m);
    const [o, x] = idx(m, ["agg"]).slice(-2);
    expect(w[o]).toBeCloseTo((1.5 * 96 - 5) / 7, 6);
    expect(w[x]).toBeCloseTo(18 * 1.1 + 1.5, 6);
  });
  it("a narrow custom width still fits the label", () => {
    const m = month({ mode: "uniform", uniformHundredths: 20 });
    const [o] = idx(m, ["agg"]).slice(-2);
    expect(xlsxColumnWidths(m)[o]).toBeCloseTo(5 * 1.1 + 1.5, 6);
  });
});
