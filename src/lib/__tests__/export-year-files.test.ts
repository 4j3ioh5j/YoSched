import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { buildYearExportFiles } from "../export-year-files";
import { input, NOW } from "./fixtures/export-input";

// Card #299: one click builds BOTH files from one snapshot and one timestamp.

const fonts = {
  regular: new Uint8Array(readFileSync(join(__dirname, "../../../public/fonts/ArchivoNarrow-Regular.ttf"))),
  bold: new Uint8Array(readFileSync(join(__dirname, "../../../public/fonts/ArchivoNarrow-Bold.ttf"))),
};

describe("buildYearExportFiles (card #299)", () => {
  it("builds the xlsx and the pdf for the chosen year with the same footer time", async () => {
    const { xlsx, pdf } = await buildYearExportFiles(input(), 2026, NOW, async () => fonts, { compress: false });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
    expect(wb.worksheets).toHaveLength(12);
    expect(wb.worksheets[0].name).toBe("JAN 2026");
    const footer = String(wb.getWorksheet("JAN 2026")!.getCell("A35").value);
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF")).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)?.length).toBe(12);
    expect(footer).toMatch(/^11\/16\/2026 20:05/);
  });

  it("a font load failure fails the whole build (no half export)", async () => {
    await expect(buildYearExportFiles(input(), 2026, NOW, async () => { throw new Error("font 404"); })).rejects.toThrow(/font 404/);
  });
});
