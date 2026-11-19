import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { udScreenSizing, udNarrowerThanTitle, printUdWidthsIn, DEFAULT_PRINT_LAYOUT, DEFAULT_UD_WIDTH, UD_CELL_PAD_PX } from "../print-layout";
import { buildUdWidthSnapshot, parseUdWidthSnapshot } from "../ud-width-snapshot";

// Card #364: best fit never makes a column narrower than its title, and a width the user sets
// that is narrower than the title is flagged in Settings.
describe("on-screen sizing of each user-defined column", () => {
  it("best fit columns fit their own screen text, in every choice that leaves them best fit", () => {
    expect(udScreenSizing(DEFAULT_UD_WIDTH, "agg:o")).toBe("fit");
    const per = { ...DEFAULT_UD_WIDTH, mode: "perColumn" as const, perColumn: { "ded:icu": 43 } };
    expect(udScreenSizing(per, "agg:o")).toBe("fit");
    expect(udScreenSizing(per, "ded:card")).toBe("fit");
    expect(udScreenSizing(per, "ded:icu")).toBe("fixed");
  });
  it("one width for all is fixed; match largest is a floor that grows with the text", () => {
    expect(udScreenSizing({ ...DEFAULT_UD_WIDTH, mode: "uniform" }, "agg:o")).toBe("fixed");
    expect(udScreenSizing({ ...DEFAULT_UD_WIDTH, mode: "matchLargest" }, "agg:o")).toBe("atLeast");
  });
  it("a bad stored width is not a set width", () => {
    expect(udScreenSizing({ ...DEFAULT_UD_WIDTH, mode: "perColumn", perColumn: { "agg:o": 5 } }, "agg:o")).toBe("fit");
  });
});

describe("narrower-than-title check", () => {
  it("flags a set width under the title, rounding up to the hundredth shown", () => {
    expect(udNarrowerThanTitle(40, 0.43)).toBe(true);
    expect(udNarrowerThanTitle(43, 0.43)).toBe(false);
    expect(udNarrowerThanTitle(43, 0.4301)).toBe(true);
    expect(udNarrowerThanTitle(60, 0.43)).toBe(false);
  });
  it("unknown title or width: no warning", () => {
    expect(udNarrowerThanTitle(40, undefined)).toBe(false);
    expect(udNarrowerThanTitle(null, 0.43)).toBe(false);
    expect(udNarrowerThanTitle(40, Number.NaN)).toBe(false);
  });
});

describe("the title width reaches Settings", () => {
  it("printUdWidthsIn reports each title width", () => {
    const cols = [{ key: "agg:o", fitPx: 80, titlePx: 40, fitCh: 10, titleCh: 5 }];
    const r = printUdWidthsIn(DEFAULT_PRINT_LAYOUT, cols, { reservedIn: 0.78, autoCount: 10, autoNeedPx: 20, autoNeedCh: 3 });
    expect(r.titleIn.get("agg:o")).toBeCloseTo(40 / 96 + UD_CELL_PAD_PX / 96, 6);
  });
  it("the snapshot keeps it, and an old snapshot without it still reads", () => {
    const s = buildUdWidthSnapshot("2027-02", new Map([["agg:o", 0.5]]), new Map([["agg:o", 0.5]]), new Map([["agg:o", 0.47]]));
    expect(parseUdWidthSnapshot(JSON.stringify(s))!.cols["agg:o"]).toEqual({ printIn: 0.5, bestFitIn: 0.5, titleIn: 0.47 });
    const old = JSON.stringify({ month: "2027-02", cols: { "agg:o": { printIn: 0.5, bestFitIn: 0.5 } } });
    expect(parseUdWidthSnapshot(old)!.cols["agg:o"]).toEqual({ printIn: 0.5, bestFitIn: 0.5 });
    const bad = JSON.stringify({ month: "2027-02", cols: { "agg:o": { printIn: 0.5, bestFitIn: 0.5, titleIn: -1 } } });
    expect(parseUdWidthSnapshot(bad)!.cols["agg:o"]).toEqual({ printIn: 0.5, bestFitIn: 0.5 });
  });
});

describe("the print columns view on screen", () => {
  const grid = readFileSync(join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
  const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
  const screen = css.slice(0, css.indexOf("@media print"));
  it("every user-defined header and cell says how it is sized", () => {
    expect((grid.match(/data-ud-size=\{udScreenSizing\(printLayout\.udWidth, sc\.key\)\}/g) ?? []).length).toBe(4);
  });
  it("only set widths size the column; best fit stays as wide as its text", () => {
    expect(screen).toMatch(/\[data-print-columns-view\] \[data-ud-col\]:not\(\[data-ud-size="fit"\]\) \{\s*width: var\(--ud-col-w, 1%\);\s*min-width: var\(--ud-col-w, 0\);\s*\}/);
  });
  it("only body cells of a set width clip; a header is never clipped, so the column fits its title", () => {
    expect(screen).toMatch(/\[data-print-columns-view\] tbody td\[data-ud-col\]\[data-ud-size="fixed"\] \{\s*max-width: var\(--ud-col-w, none\);\s*overflow: hidden;\s*text-overflow: ellipsis;\s*\}/);
    expect(screen).not.toMatch(/thead[^{]*\[data-ud-col\][^{]*\{[^}]*overflow: hidden/);
    expect(screen).not.toMatch(/\[data-print-columns-view\]:not\(\[data-ud-width-mode="bestFit"\]\) \[data-ud-col\] \{/);
  });
});

// Card #364 r1 (review): in the equal-width modes the columns share one screen width, at least
// the widest screen title (match largest: the widest screen text), so a long title widens them
// all together, never one alone.
import { udScreenEqualPx, udTitleFloorIn } from "../print-layout";
describe("one shared screen width in the equal-width modes", () => {
  it("one width for all: the widest header; match largest: the widest header or day text", () => {
    expect(udScreenEqualPx({ ...DEFAULT_UD_WIDTH, mode: "uniform" }, [40.2, 57.7], [300])).toBe(58);
    expect(udScreenEqualPx({ ...DEFAULT_UD_WIDTH, mode: "matchLargest" }, [40, 57.7], [271.9, 12])).toBe(272);
  });
  it("best fit and per column: no shared width", () => {
    expect(udScreenEqualPx(DEFAULT_UD_WIDTH, [40], [80])).toBeNull();
    expect(udScreenEqualPx({ ...DEFAULT_UD_WIDTH, mode: "perColumn", perColumn: { "agg:o": 43 } }, [40], [80])).toBeNull();
  });
  it("bad or missing measurements are ignored; nothing measured gives none", () => {
    expect(udScreenEqualPx({ ...DEFAULT_UD_WIDTH, mode: "uniform" }, [Number.NaN, -3, 30], [])).toBe(30);
    expect(udScreenEqualPx({ ...DEFAULT_UD_WIDTH, mode: "uniform" }, [], [])).toBeNull();
    expect(udScreenEqualPx({ ...DEFAULT_UD_WIDTH, mode: "matchLargest" }, [Number.NaN], [Infinity])).toBeNull();
  });
});

describe("the width a too-narrow set width prints at", () => {
  const cols = { "agg:o": { titleIn: 0.47 }, "ded:icu": { titleIn: 0.39 }, "ded:x": {} };
  it("one width for all prints every column at the widest title", () => {
    expect(udTitleFloorIn("uniform", "ded:icu", cols)).toBe(0.47);
  });
  it("a Custom width prints at its own title", () => {
    expect(udTitleFloorIn("perColumn", "ded:icu", cols)).toBe(0.39);
    expect(udTitleFloorIn("perColumn", "ded:x", cols)).toBeNull();
  });
});

describe("the print columns view on screen, equal-width modes", () => {
  const grid = readFileSync(join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
  const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
  const screen = css.slice(0, css.indexOf("@media print"));
  it("every column takes the shared width, and a set uniform width clips only day text at it", () => {
    expect(screen).toMatch(/\[data-print-columns-view\]\[data-ud-width-mode="uniform"\] \[data-ud-col\],\s*\[data-print-columns-view\]\[data-ud-width-mode="matchLargest"\] \[data-ud-col\] \{\s*width: max\(var\(--ud-col-w, 0px\), var\(--ud-eq-w, 0px\)\);\s*min-width: max\(var\(--ud-col-w, 0px\), var\(--ud-eq-w, 0px\)\);\s*\}/);
    expect(screen).toMatch(/\[data-print-columns-view\]\[data-ud-width-mode="uniform"\] tbody td\[data-ud-col\] \{\s*max-width: max\(var\(--ud-col-w, 0px\), var\(--ud-eq-w, 0px\)\);\s*\}/);
  });
  it("the grid measures the screen text and sets the shared width on the root", () => {
    expect(grid).toMatch(/udScreenEqualPx\(printLayout\.udWidth, /);
    expect(grid).toMatch(/"--ud-eq-w": udEqPx != null \? `\$\{udEqPx\}px` : undefined/);
  });
});
