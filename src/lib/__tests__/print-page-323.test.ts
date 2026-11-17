// Card #323: paper size and margin are Settings, shared by the browser printout and the year PDF.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_PRINT_LAYOUT, printLayoutFrom, printPage, printFit, printPageStyle, isPrintPaper, validatePrintMargin,
  type PrintLayout,
} from "../print-layout";

const L = (o: Partial<PrintLayout> = {}): PrintLayout => ({ ...DEFAULT_PRINT_LAYOUT, ...o });

describe("paper and margin settings", () => {
  it("defaults: US Letter, 0.25in", () => {
    expect(DEFAULT_PRINT_LAYOUT.paper).toBe("letter");
    expect(DEFAULT_PRINT_LAYOUT.marginHundredths).toBe(25);
    expect(printLayoutFrom(null).paper).toBe("letter");
  });
  it("stored values resolve; anything bad → default", () => {
    expect(printLayoutFrom({ printPaperSize: "a4", printMarginHundredthsIn: 100 })).toMatchObject({ paper: "a4", marginHundredths: 100 });
    for (const bad of ["legal", "A4", "", null, 5]) expect(printLayoutFrom({ printPaperSize: bad }).paper).toBe("letter");
    for (const bad of [24, 101, 1.5, "50", null, NaN]) expect(printLayoutFrom({ printMarginHundredthsIn: bad }).marginHundredths).toBe(25);
  });
  it("validators", () => {
    expect(isPrintPaper("letter") && isPrintPaper("a4")).toBe(true);
    expect(isPrintPaper("legal")).toBe(false);
    expect([25, 50, 100].every(validatePrintMargin)).toBe(true);
    expect([24, 101, 1.5, "30", null].some((v) => validatePrintMargin(v))).toBe(false);
  });
});

describe("printPage", () => {
  it("landscape page sizes and margin in inches", () => {
    expect(printPage(L())).toEqual({ wIn: 11, hIn: 8.5, marginIn: 0.25 });
    const a4 = printPage(L({ paper: "a4", marginHundredths: 100 }));
    expect(a4.wIn).toBeCloseTo(297 / 25.4, 6);
    expect(a4.hIn).toBeCloseTo(210 / 25.4, 6);
    expect(a4.marginIn).toBe(1);
  });
});

describe("printFit", () => {
  it("defaults fill the page at full size", () => {
    const f = printFit(L());
    expect(f.scale).toBe(1);
    expect(f.rowIn).toBeGreaterThan(0.2);
  });
  it("the row height is the same whatever the month (no month input) and smaller with bigger margins", () => {
    expect(printFit(L({ marginHundredths: 100 })).rowIn).toBeLessThan(printFit(L()).rowIn);
    expect(printFit(L({ paper: "a4" })).rowIn).toBeLessThan(printFit(L()).rowIn); // A4 landscape is shorter
  });
  it("a row is never shorter than its text needs; the whole printout is shrunk instead", () => {
    const big = L({ marginHundredths: 100, fontSize: 14, header: { ...DEFAULT_PRINT_LAYOUT.header, size: 32 }, footer: { ...DEFAULT_PRINT_LAYOUT.footer, size: 32 } });
    const f = printFit(big);
    expect(f.rowIn).toBeGreaterThanOrEqual(f.contentMinIn);
    expect(f.scale).toBeLessThan(1);
    expect(f.scale).toBeGreaterThan(0.3);
    // After shrinking, title + 32 rows + footer fit the space inside the margins.
    const p = printPage(big);
    expect(f.neededIn * f.scale).toBeLessThanOrEqual(p.hIn - 2 * p.marginIn + 1e-9);
  });
  it("9pt text with 1in margins on Letter (the reviewer's case) still fits", () => {
    const f = printFit(L({ marginHundredths: 100 }));
    const p = printPage(L({ marginHundredths: 100 }));
    expect(f.rowIn).toBeGreaterThanOrEqual(f.contentMinIn);
    expect(f.neededIn * f.scale).toBeLessThanOrEqual(p.hIn - 2 * p.marginIn + 1e-9);
  });
});

describe("printPageStyle", () => {
  it("only a known paper name and a number reach the CSS", () => {
    expect(printPageStyle(L())).toBe("@page{size:letter landscape;margin:0}body{padding:0.25in !important}");
    // A4 with 1in margins at 9pt needs a small shrink: the zoom rule follows.
    expect(printPageStyle(L({ paper: "a4", marginHundredths: 100 }))).toMatch(/^@page\{size:A4 landscape;margin:0\}body\{padding:1in !important\}\[data-print-root\]\{zoom:0\.9\d*\}$/);
    expect(printPageStyle(L({ paper: "a4", marginHundredths: 50 }))).toBe("@page{size:A4 landscape;margin:0}body{padding:0.5in !important}");
    // A layout that somehow carries junk falls back to the defaults rather than passing it through.
    const junk = { ...L(), paper: "letter;}body{display:none" as never, marginHundredths: "1;color:red" as never };
    expect(printPageStyle(junk)).toBe("@page{size:letter landscape;margin:0}body{padding:0.25in !important}");
  });
  it("includes the shrink factor only when the printout must shrink", () => {
    expect(printPageStyle(L())).not.toMatch(/zoom/);
    const big = L({ marginHundredths: 100, fontSize: 14, header: { ...DEFAULT_PRINT_LAYOUT.header, size: 32 } });
    expect(printPageStyle(big)).toMatch(/\[data-print-root\]\{zoom:0\.\d+\}/);
  });
});
