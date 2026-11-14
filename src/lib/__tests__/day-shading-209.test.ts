import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rowPrintShade, screenHolidayTint, isShadeColor, dayShadingFrom, DEFAULT_DAY_SHADING } from "../day-shading";

// Card #209: weekend and holiday shading come from Settings; null = off.

const S = { printWeekendColor: "#EBEBEB", printHolidayColor: "#D0D0D0", screenHolidayColor: "#4A3410" };

describe("rowPrintShade", () => {
  it("weekend only, holiday only, holiday on a weekend (holiday wins), plain weekday", () => {
    expect(rowPrintShade(true, false, S)).toBe("#EBEBEB");
    expect(rowPrintShade(false, true, S)).toBe("#D0D0D0");
    expect(rowPrintShade(true, true, S)).toBe("#D0D0D0");
    expect(rowPrintShade(false, false, S)).toBeNull();
  });
  it("holiday colour off: a weekend holiday falls back to the weekend shade; a weekday holiday gets none", () => {
    const s = { ...S, printHolidayColor: null };
    expect(rowPrintShade(true, true, s)).toBe("#EBEBEB");
    expect(rowPrintShade(false, true, s)).toBeNull();
  });
  it("both off → no shading anywhere", () => {
    const s = { ...S, printWeekendColor: null, printHolidayColor: null };
    for (const [w, h] of [[true, false], [false, true], [true, true]] as const) expect(rowPrintShade(w, h, s)).toBeNull();
  });
});

describe("screenHolidayTint", () => {
  it("holiday rows only, and off when null", () => {
    expect(screenHolidayTint(true, S)).toBe("#4A3410");
    expect(screenHolidayTint(false, S)).toBeNull();
    expect(screenHolidayTint(true, { ...S, screenHolidayColor: null })).toBeNull();
  });
});

describe("isShadeColor / dayShadingFrom", () => {
  it("only #RRGGBB", () => {
    expect(isShadeColor("#d0d0d0")).toBe(true);
    for (const bad of ["gray", "#EEE", "D0D0D0", "#D0D0D0FF", "", 42, null]) expect(isShadeColor(bad)).toBe(false);
  });
  it("no stored row → defaults; a stored explicit null stays off", () => {
    expect(dayShadingFrom(null)).toEqual(DEFAULT_DAY_SHADING);
    expect(dayShadingFrom({ printWeekendColor: null, printHolidayColor: "#D0D0D0", screenHolidayColor: null }))
      .toEqual({ printWeekendColor: null, printHolidayColor: "#D0D0D0", screenHolidayColor: null });
  });
});

describe("source checks", () => {
  const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
  const grid = readFileSync(join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
  it("print CSS shades rows from the setting, with no hard-coded weekend colour, and shift colours still win", () => {
    expect(css).not.toMatch(/tr\[data-weekend="true"\] td \{\s*background: #/);
    const shade = css.indexOf("tbody tr[data-print-shade] td {");
    const shift = css.indexOf("tbody tr[data-print-shade] td[data-print-bg]");
    expect(shade).toBeGreaterThan(-1);
    expect(shift).toBeGreaterThan(shade);
  });
  it("grid has no hard-coded holiday tint and no holiday lookup by shift code", () => {
    expect(grid).not.toContain("bg-amber-950/20");
    expect(grid).not.toMatch(/st\.code === "HOL"/);
  });
});
