import { describe, it, expect } from "vitest";
import { printUdWidthsIn, printWidthScale, printPageStyle, printPage, printFit, DEFAULT_PRINT_LAYOUT, DEFAULT_UD_WIDTH, UD_CELL_PAD_PX, type PrintLayout, type UdWidthSettings } from "../print-layout";

// Card #357: the browser printout's user-defined column widths and the width-aware shrink.
const lay = (ud: Partial<UdWidthSettings>): PrintLayout => ({ ...DEFAULT_PRINT_LAYOUT, udWidth: { ...DEFAULT_UD_WIDTH, ...ud } });
const printable = (l: PrintLayout) => { const p = printPage(l); return p.wIn - 2 * p.marginIn; };
const cols = [
  { key: "agg:o", fitPx: 80, titlePx: 40, fitCh: 10, titleCh: 5 },
  { key: "ded:i", fitPx: 20, titlePx: 20, fitCh: 2, titleCh: 3 },
];
const room = { reservedIn: 0.78, autoCount: 10, autoNeedPx: 20, autoNeedCh: 3 };
const pad = UD_CELL_PAD_PX / 96;

describe("printUdWidthsIn (card #357)", () => {
  it("best fit: each column its measured text + the cell padding", () => {
    const { widths } = printUdWidthsIn(lay({}), cols, room);
    expect(widths.get("agg:o")).toBeCloseTo(80 / 96 + pad, 6);
    expect(widths.get("ded:i")).toBeCloseTo(20 / 96 + pad, 6);
  });
  it("one width / match largest: equal", () => {
    for (const mode of ["uniform", "matchLargest"] as const) {
      const ws = [...printUdWidthsIn(lay({ mode, uniformHundredths: 90 }), cols, room).widths.values()];
      expect(ws[0]).toBeCloseTo(ws[1], 9);
    }
    expect(printUdWidthsIn(lay({ mode: "uniform", uniformHundredths: 90 }), cols, room).widths.get("ded:i")).toBeCloseTo(0.9, 6);
  });
  it("not measured yet: falls back to a generous width per character", () => {
    const { widths } = printUdWidthsIn(lay({}), cols.map((c) => ({ ...c, fitPx: null, titlePx: null })), room);
    expect(widths.get("agg:o")!).toBeGreaterThan(widths.get("ded:i")!);
    for (const w of widths.values()) expect(Number.isFinite(w) && w > 0).toBe(true);
  });
  it("the row fits the printable width when there is room", () => {
    const l = lay({ mode: "uniform", uniformHundredths: 200 });
    const { widths, needIn } = printUdWidthsIn(l, cols, room);
    const fixed = room.reservedIn + room.autoCount * (20 + 5) / 96;
    expect(needIn).toBeCloseTo(fixed + [...widths.values()].reduce((a, b) => a + b, 0), 6);
    expect(needIn).toBeLessThanOrEqual(printable(l) / printFit(l).scale + 1e-6);
    expect(printPageStyle(l, needIn)).toBe(printPageStyle(l));
  });
  it("titles wider than the page: the printout shrinks so the whole row fits", () => {
    const l = lay({ mode: "uniform", uniformHundredths: 20 });
    const many = Array.from({ length: 30 }, (_, i) => ({ key: `agg:c${i}`, fitPx: 60, titlePx: 60, fitCh: 8, titleCh: 8 }));
    const { widths, needIn } = printUdWidthsIn(l, many, room);
    for (const w of widths.values()) expect(w).toBeCloseTo(60 / 96 + pad, 6); // titles kept
    expect(needIn).toBeGreaterThan(printable(l));
    const css = printPageStyle(l, needIn);
    const zoom = Number(/zoom:([0-9.]+)/.exec(css)![1]);
    expect(zoom * needIn).toBeLessThanOrEqual(printable(l) + 1e-6);
    expect(zoom).toBeLessThan(1);
  });
});

describe("printWidthScale (card #357)", () => {
  it("keeps the height shrink when the width fits, or the need is junk", () => {
    expect(printWidthScale(10, 0.9, 10)).toBe(0.9);
    expect(printWidthScale(10, 1, undefined)).toBe(1);
    expect(printWidthScale(10, 1, NaN)).toBe(1);
    expect(printWidthScale(10, 1, -5)).toBe(1);
  });
  it("shrinks further when the row is wider than the page", () => {
    expect(printWidthScale(10, 1, 20)).toBe(0.5);
    expect(printWidthScale(10, 0.9, 12)).toBeCloseTo(0.833, 3);
    expect(printWidthScale(10, 1, 1e9) * 1e9).toBeLessThanOrEqual(10 + 1e-9); // always fits, however wide
    expect(printWidthScale(10, 1, 1e9)).toBeGreaterThan(0);
  });
});
