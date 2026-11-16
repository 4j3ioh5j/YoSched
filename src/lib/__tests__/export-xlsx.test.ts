import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { exportYearXlsx } from "../export-xlsx";
import { buildPrintedYear } from "../print-month-model";
import { DEFAULT_PRINT_LAYOUT } from "../print-layout";
import { input, NOW } from "./fixtures/export-input";

// Card #299: the Excel half of the year export, read back with exceljs.

async function workbook(over: Parameters<typeof input>[0] = {}) {
  const bytes = await exportYearXlsx(buildPrintedYear(input(over), 2026, NOW));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
}

const argb = (c: ExcelJS.Cell) => (c.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;

describe("exportYearXlsx (card #299)", () => {
  it("writes 12 sheets named like the reference", async () => {
    const wb = await workbook();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].map((m) => `${m} 2026`));
  });

  it("title in A1 with the header block's size, bold and alignment", async () => {
    const ws = (await workbook()).getWorksheet("JAN 2026")!;
    const a1 = ws.getCell("A1");
    expect(a1.value).toBe("JANUARY 2026 SCHEDULE");
    expect(a1.font.size).toBe(16);
    expect(a1.font.bold).toBe(true);
    expect(a1.font.name).toBe("Aptos Narrow");
    expect(a1.alignment?.horizontal).toBe("left");
  });

  it("the title spans the table, so center and right alignment work", async () => {
    const ws = (await workbook({ printLayout: { ...DEFAULT_PRINT_LAYOUT, header: { ...DEFAULT_PRINT_LAYOUT.header, align: "center" } } })).getWorksheet("JAN 2026")!;
    expect(ws.getCell("F1").isMerged).toBe(true);
    expect(ws.getCell("G1").isMerged).toBe(false);
    expect(ws.getCell("A1").alignment?.horizontal).toBe("center");
  });

  it("header row, then one row per day with a real date", async () => {
    const ws = (await workbook()).getWorksheet("JAN 2026")!;
    expect((ws.getRow(2).values as unknown[]).slice(1)).toEqual(["DATE", "DAY", "AA", "CC", "ICU", "#"]);
    const d = ws.getCell("A3");
    expect(d.value).toBeInstanceOf(Date);
    expect((d.value as Date).toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(d.numFmt).toBe("mm-dd");
    expect(ws.getCell("B3").value).toBe("THU");
    expect(ws.getCell("A33").numFmt).toBe("mm-dd");
    expect(ws.getCell("C3").font.size).toBe(9);
    expect(ws.getCell("C3").alignment?.horizontal).toBe("center");
  });

  it("the font family and size come from Settings", async () => {
    const ws = (await workbook({ printLayout: { ...DEFAULT_PRINT_LAYOUT, fontFamily: "Arial Narrow", fontSize: 11 } })).getWorksheet("JAN 2026")!;
    expect(ws.getCell("C4").font.name).toBe("Arial Narrow");
    expect(ws.getCell("C4").font.size).toBe(11);
  });

  it("fills the shift tint and bolds bold shifts", async () => {
    const ws = (await workbook()).getWorksheet("JAN 2026")!;
    const orl = ws.getCell("C4"); // AA on 01-02
    expect(orl.value).toBe("ORL");
    expect(argb(orl)).toBe("FF92D050");
    expect(orl.font.bold).toBe(true);
    expect(argb(ws.getCell("C5"))).toBe("FFE6E6E6"); // CALL: bold-cell grey
    expect(argb(ws.getCell("D10"))).toBeUndefined(); // empty, no shading
  });

  it("borders: thin inside, medium outside, double top on a pay-period start", async () => {
    const ws = (await workbook()).getWorksheet("JAN 2026")!;
    expect(ws.getCell("C10").border.left?.style).toBe("thin");
    expect(ws.getCell("A10").border.left?.style).toBe("medium");
    expect(ws.getCell("B10").border.right?.style).toBe("medium"); // end of the date block
    expect(ws.getCell("F10").border.right?.style).toBe("medium"); // last column
    expect(ws.getCell("C2").border.top?.style).toBe("medium");
    expect(ws.getCell("C33").border.bottom?.style).toBe("medium");
    expect(ws.getCell("C13").border.top?.style).toBe("double"); // 01-11
    expect(ws.getCell("F13").border.top?.style).toBe("double");
    expect(ws.getCell("C12").border.top?.style).toBe("thin");
  });

  it("puts the PP label right of the table, small and without a border", async () => {
    const ws = (await workbook()).getWorksheet("JAN 2026")!;
    const g = ws.getCell("G13");
    expect(g.value).toBe("PP#01");
    expect(g.font.size).toBe(6);
    expect(g.border?.top).toBeUndefined();
    expect(ws.getCell("G27").value).toBe("PP#02");
  });

  it("footer row under the table ends with - YoSched", async () => {
    const ws = (await workbook()).getWorksheet("JAN 2026")!;
    const f = ws.getCell("A34");
    expect(f.value).toBe("11/16/2026 20:05 VER: 09 - YoSched");
    expect(f.font.size).toBe(8);
    expect(f.alignment?.horizontal).toBe("right");
    expect(ws.getCell("F34").isMerged).toBe(true);
  });

  it("page setup: landscape, one page, 0.2 inch margins, print area", async () => {
    const ws = (await workbook()).getWorksheet("JAN 2026")!;
    expect(ws.pageSetup.orientation).toBe("landscape");
    expect(ws.pageSetup.fitToPage).toBe(true);
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.pageSetup.fitToHeight).toBe(1);
    expect(ws.pageSetup.margins?.left).toBe(0.2);
    expect(ws.pageSetup.margins?.top).toBe(0.2);
    expect(ws.pageSetup.printArea).toBe("A1:G34"); // title, header, 31 days, footer; G = PP labels
  });

  it("one date column when the split is off", async () => {
    const ws = (await workbook({ printLayout: { ...DEFAULT_PRINT_LAYOUT, splitDateDay: false } })).getWorksheet("JAN 2026")!;
    expect((ws.getRow(2).values as unknown[]).slice(1, 3)).toEqual(["DATE", "AA"]);
    expect(ws.getCell("A3").value).toBe("Thu 1/1");
    expect(ws.getCell("A3").border.right?.style).toBe("medium");
  });
});
