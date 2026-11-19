import { describe, it, expect } from "vitest";
import {
  udRequestedIn, udWidthsIn, parseUdWidth, validateUdWidthPatch, printLayoutFrom,
  DEFAULT_UD_WIDTH, DEFAULT_PRINT_LAYOUT, UD_WIDTH_MIN, UD_WIDTH_MAX, type UdWidthSettings,
} from "../print-layout";

// Card #357: Settings choose how wide the user-defined columns (additional columns such as
// OTHER, and shift columns such as CARD/ICU/OR) print: best fit each (default), all match the
// widest best fit, one custom width for all, or a custom width per column.
const cols = [
  { key: "agg:o", fitIn: 0.9, titleIn: 0.4 },
  { key: "ded:c", fitIn: 0.3, titleIn: 0.3 },
  { key: "ded:i", fitIn: 0.5, titleIn: 0.2 },
];
const s = (p: Partial<UdWidthSettings>): UdWidthSettings => ({ ...DEFAULT_UD_WIDTH, ...p });
const asObj = (m: Map<string, number>) => Object.fromEntries(m);

describe("udRequestedIn: the width each choice asks for", () => {
  it("best fit (the default) gives each column its own fit", () => {
    expect(DEFAULT_UD_WIDTH.mode).toBe("bestFit");
    expect(asObj(udRequestedIn(DEFAULT_UD_WIDTH, cols))).toEqual({ "agg:o": 0.9, "ded:c": 0.3, "ded:i": 0.5 });
  });
  it("match largest gives every column the widest fit", () => {
    expect(asObj(udRequestedIn(s({ mode: "matchLargest" }), cols))).toEqual({ "agg:o": 0.9, "ded:c": 0.9, "ded:i": 0.9 });
  });
  it("one width gives every column the custom width", () => {
    expect(asObj(udRequestedIn(s({ mode: "uniform", uniformHundredths: 65 }), cols))).toEqual({ "agg:o": 0.65, "ded:c": 0.65, "ded:i": 0.65 });
  });
  it("per column uses each custom width, and best fit for a column without one", () => {
    const m = udRequestedIn(s({ mode: "perColumn", perColumn: { "agg:o": 120, "ded:i": 40, "agg:gone": 99 } }), cols);
    expect(asObj(m)).toEqual({ "agg:o": 1.2, "ded:c": 0.3, "ded:i": 0.4 });
  });
  it("a junk fit falls back to the title, never NaN or a negative width", () => {
    const m = udRequestedIn(DEFAULT_UD_WIDTH, [{ key: "agg:x", fitIn: NaN, titleIn: 0.3 }, { key: "agg:y", fitIn: -1, titleIn: Infinity }]);
    expect(m.get("agg:x")).toBe(0.3);
    expect(Number.isFinite(m.get("agg:y")!)).toBe(true);
    expect(m.get("agg:y")!).toBeGreaterThan(0);
  });
  it("no columns gives an empty map", () => {
    expect(udRequestedIn(s({ mode: "matchLargest" }), []).size).toBe(0);
  });
});

describe("udWidthsIn: the requested widths fitted to the page", () => {
  it("keeps the requested widths when they fit", () => {
    expect(asObj(udWidthsIn(DEFAULT_UD_WIDTH, cols, 5))).toEqual({ "agg:o": 0.9, "ded:c": 0.3, "ded:i": 0.5 });
  });
  it("narrows every column together when they do not fit", () => {
    const m = udWidthsIn(s({ mode: "uniform", uniformHundredths: 200 }), cols, 3);
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(3 + 1e-9);
    expect(total).toBeCloseTo(3, 6);
    for (const c of cols) expect(m.get(c.key)!).toBeGreaterThanOrEqual(c.titleIn);
  });
  it("never narrows a column below its title (the title stays on one line)", () => {
    const m = udWidthsIn(s({ mode: "perColumn", perColumn: { "agg:o": 200, "ded:c": 200, "ded:i": 200 } }), cols, 0.5);
    expect(m.get("agg:o")).toBeCloseTo(0.4, 6);
    expect(m.get("ded:c")).toBeCloseTo(0.3, 6);
    expect(m.get("ded:i")).toBeCloseTo(0.2, 6);
    // one width keeps one floor (the widest title) for all
    const u = udWidthsIn(s({ mode: "uniform", uniformHundredths: 200 }), cols, 0.5);
    for (const c of cols) expect(u.get(c.key)).toBeCloseTo(0.4, 6);
  });
  it("one width stays one width when narrowed (all columns share one cap)", () => {
    // requested 2,2,2; titles .4,.3,.2; room 2.4 → each 0.8
    const m = udWidthsIn(s({ mode: "uniform", uniformHundredths: 200 }), cols, 2.4);
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(2.4, 6);
    for (const c of cols) expect(m.get(c.key)).toBeCloseTo(0.8, 6);
  });
  it("match largest stays equal when narrowed", () => {
    const m = udWidthsIn(s({ mode: "matchLargest" }), cols, 1.5);
    for (const c of cols) expect(m.get(c.key)).toBeCloseTo(0.5, 6);
  });
  it("a wide title floor never pushes the total past the room (reviewer's case)", () => {
    const two = [{ key: "agg:a", fitIn: 2, titleIn: 1.8 }, { key: "agg:b", fitIn: 1, titleIn: 0.1 }];
    const m = udWidthsIn(DEFAULT_UD_WIDTH, two, 2.4);
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(2.4, 6);
    expect(m.get("agg:a")).toBeCloseTo(1.8, 6);
    expect(m.get("agg:b")).toBeCloseTo(0.6, 6);
  });
  it("best fit narrows the widest columns first", () => {
    const m = udWidthsIn(DEFAULT_UD_WIDTH, cols, 1.5);
    // .9/.3/.5 → cap .6: .6 + .3 + .5 = 1.4 < 1.5 → cap .7 → .7+.3+.5 = 1.5
    expect(m.get("agg:o")).toBeCloseTo(0.7, 6);
    expect(m.get("ded:c")).toBeCloseTo(0.3, 6);
    expect(m.get("ded:i")).toBeCloseTo(0.5, 6);
  });
  it("random cases: total ≤ room whenever the titles fit, and every column ≥ its title", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let n = 0; n < 300; n++) {
      const k = 1 + Math.floor(rnd() * 6);
      const cs = Array.from({ length: k }, (_, i) => { const t = rnd() * 0.8; return { key: `agg:c${i}`, fitIn: t + rnd() * 1.5, titleIn: t }; });
      const mode = (["bestFit", "matchLargest", "uniform"] as const)[n % 3];
      const room = rnd() * 6;
    const equal = mode !== "bestFit";
      const m = udWidthsIn(s({ mode, uniformHundredths: 20 + Math.floor(rnd() * 181) }), cs, room);
      const tot = [...m.values()].reduce((a, b) => a + b, 0);
      const titles = cs.reduce((a, c) => a + c.titleIn, 0);
      if (!equal) expect(tot).toBeLessThanOrEqual(Math.max(room, titles) + 1e-6);
      for (const c of cs) expect(m.get(c.key)!).toBeGreaterThanOrEqual(c.titleIn - 1e-9);
      if (equal) { const ws = [...m.values()]; for (const w of ws) expect(w).toBeCloseTo(ws[0], 9); }
      if (equal) expect(tot).toBeLessThanOrEqual(Math.max(room, k * Math.max(...cs.map((c) => c.titleIn))) + 1e-6);
    }
  });
  it("a junk room keeps the requested widths (no NaN)", () => {
    expect(asObj(udWidthsIn(DEFAULT_UD_WIDTH, cols, NaN))).toEqual({ "agg:o": 0.9, "ded:c": 0.3, "ded:i": 0.5 });
  });
});

describe("parseUdWidth: the stored settings → the choice; each bad field → its default", () => {
  it("reads good values", () => {
    expect(parseUdWidth("perColumn", 80, { "agg:a": 50, "ded:b": 200 })).toEqual({ mode: "perColumn", uniformHundredths: 80, perColumn: { "agg:a": 50, "ded:b": 200 } });
  });
  it("defaults when the row is missing or the values are junk", () => {
    expect(parseUdWidth(undefined, undefined, undefined)).toEqual(DEFAULT_UD_WIDTH);
    expect(parseUdWidth("wide", 5.5, "x")).toEqual(DEFAULT_UD_WIDTH);
    expect(parseUdWidth("uniform", UD_WIDTH_MAX + 1, [])).toEqual({ ...DEFAULT_UD_WIDTH, mode: "uniform" });
  });
  it("drops bad per-column entries but keeps the good ones", () => {
    expect(parseUdWidth("perColumn", 50, { "agg:a": 50, "count:c": 50, "ded:b": 10, "ded:d": 1.5, bad: 50 }).perColumn).toEqual({ "agg:a": 50 });
  });
  it("printLayoutFrom carries it, with best fit by default", () => {
    expect(DEFAULT_PRINT_LAYOUT.udWidth).toEqual(DEFAULT_UD_WIDTH);
    expect(printLayoutFrom(null).udWidth).toEqual(DEFAULT_UD_WIDTH);
    expect(printLayoutFrom({ printUdWidthMode: "uniform", printUdWidthHundredths: 70, printUdColumnWidths: {} }).udWidth)
      .toEqual({ mode: "uniform", uniformHundredths: 70, perColumn: {} });
  });
  it("the default layout's per-column map is not shared between calls", () => {
    const a = printLayoutFrom(null);
    a.udWidth.perColumn["agg:x"] = 50;
    expect(printLayoutFrom(null).udWidth.perColumn).toEqual({});
    expect(DEFAULT_UD_WIDTH.perColumn).toEqual({});
  });
});

describe("validateUdWidthPatch: what the Settings save accepts", () => {
  it("accepts good values and passes undefined fields through", () => {
    expect(validateUdWidthPatch({ printUdWidthMode: "matchLargest" })).toEqual({ ok: true });
    expect(validateUdWidthPatch({ printUdWidthHundredths: UD_WIDTH_MIN, printUdColumnWidths: { "ded:x": UD_WIDTH_MAX } })).toEqual({ ok: true });
    expect(validateUdWidthPatch({})).toEqual({ ok: true });
  });
  it.each([
    [{ printUdWidthMode: "auto" }],
    [{ printUdWidthMode: null }],
    [{ printUdWidthHundredths: 19 }],
    [{ printUdWidthHundredths: 201 }],
    [{ printUdWidthHundredths: 50.5 }],
    [{ printUdWidthHundredths: "50" }],
    [{ printUdColumnWidths: [] }],
    [{ printUdColumnWidths: null }],
    [{ printUdColumnWidths: { "count:x": 50 } }],
    [{ printUdColumnWidths: { "agg:x": 0 } }],
    [{ printUdColumnWidths: { "agg:x": "50" } }],
    [{ printUdColumnWidths: Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`agg:c${i}`, 50])) }],
  ])("refuses %j", (body) => {
    const r = validateUdWidthPatch(body as Record<string, unknown>);
    expect(r.ok).toBe(false);
  });
});

describe("a custom width never goes below the column's title", () => {
  it("one narrow width still fits each title", () => {
    // one width is one group: every column at least the widest title, so they stay equal
    expect(asObj(udRequestedIn(s({ mode: "uniform", uniformHundredths: 20 }), cols))).toEqual({ "agg:o": 0.4, "ded:c": 0.4, "ded:i": 0.4 });
  });
  it("per column floors each column at its own title", () => {
    expect(asObj(udRequestedIn(s({ mode: "perColumn", perColumn: { "agg:o": 20, "ded:c": 20, "ded:i": 20 } }), cols))).toEqual({ "agg:o": 0.4, "ded:c": 0.3, "ded:i": 0.2 });
  });
});

describe("equal modes with a title wider than the cap (reviewer round 2)", () => {
  const two = [{ key: "agg:a", fitIn: 2, titleIn: 1.8 }, { key: "agg:b", fitIn: 1, titleIn: 0.1 }];
  it.each(["uniform", "matchLargest"] as const)("%s stays equal: both 1.8 (the widest title), not [1.8, 0.6]", (mode) => {
    const m = udWidthsIn(s({ mode, uniformHundredths: 200 }), two, 2.4);
    expect(m.get("agg:a")).toBeCloseTo(1.8, 9);
    expect(m.get("agg:b")).toBeCloseTo(1.8, 9);
  });
  it("equal modes share the room equally when the widest title fits the share", () => {
    const m = udWidthsIn(s({ mode: "uniform", uniformHundredths: 200 }), two, 4);
    expect(m.get("agg:a")).toBeCloseTo(2, 9);
    expect(m.get("agg:b")).toBeCloseTo(2, 9);
    const n = udWidthsIn(s({ mode: "uniform", uniformHundredths: 200 }), two, 3.8);
    expect(n.get("agg:a")).toBeCloseTo(1.9, 9);
    expect(n.get("agg:b")).toBeCloseTo(1.9, 9);
  });
});


describe("no user-defined columns (reviewer round 3 warning)", () => {
  it.each(["uniform", "matchLargest", "bestFit", "perColumn"] as const)("%s with no columns and no room gives an empty map", (mode) => {
    expect(udWidthsIn(s({ mode }), [], -5).size).toBe(0);
    expect(udWidthsIn(s({ mode }), [], 0).size).toBe(0);
  });
});
