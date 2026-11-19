import { describe, it, expect } from "vitest";
import { buildUdWidthSnapshot, parseUdWidthSnapshot, saveUdWidthSnapshot, loadUdWidthSnapshot, UD_WIDTH_SNAPSHOT_KEY } from "../ud-width-snapshot";
import { printUdWidthsIn, DEFAULT_PRINT_LAYOUT, DEFAULT_UD_WIDTH, UD_CELL_PAD_PX, UD_WIDTH_MAX_ENTRIES } from "../print-layout";

// Card #359: Settings › Column Widths shows each column's current width. The schedule page
// measures the text in the print font and records the widths; Settings reads them.
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("printUdWidthsIn reports each column's best fit too", () => {
  it("best fit = measured text + padding, whatever the choice", () => {
    const cols = [{ key: "agg:o", fitPx: 80, titlePx: 40, fitCh: 10, titleCh: 5 }];
    const room = { reservedIn: 0.78, autoCount: 10, autoNeedPx: 20, autoNeedCh: 3 };
    const r = printUdWidthsIn({ ...DEFAULT_PRINT_LAYOUT, udWidth: { ...DEFAULT_UD_WIDTH, mode: "uniform", uniformHundredths: 150 } }, cols, room);
    expect(r.widths.get("agg:o")).toBeCloseTo(1.5, 6);
    expect(r.bestFitIn.get("agg:o")).toBeCloseTo(80 / 96 + UD_CELL_PAD_PX / 96, 6);
  });
});

describe("width snapshot", () => {
  const snap = buildUdWidthSnapshot("2027-02", new Map([["agg:o", 1.1], ["ded:i", 0.3]]), new Map([["agg:o", 0.9], ["ded:i", 0.3]]));
  it("round-trips through storage", () => {
    const s = memory();
    saveUdWidthSnapshot(snap, s);
    expect(loadUdWidthSnapshot(s)).toEqual(snap);
    expect(snap.cols["agg:o"]).toEqual({ printIn: 1.1, bestFitIn: 0.9 });
  });
  it("missing, empty, garbage or wrong-shape storage reads as nothing", () => {
    for (const raw of [null, "", "{", "null", "[]", '{"month":"x","cols":{}}', '{"month":"2027-02","cols":[]}']) {
      expect(parseUdWidthSnapshot(raw)).toBeNull();
    }
  });
  it("drops entries that are not finite positive widths", () => {
    const raw = JSON.stringify({ month: "2027-02", cols: { "agg:a": { printIn: 1, bestFitIn: 1 }, "agg:b": { printIn: -1, bestFitIn: 1 }, "agg:c": { printIn: "1", bestFitIn: 1 }, "agg:d": { printIn: 1e9, bestFitIn: 1 } } });
    expect(Object.keys(parseUdWidthSnapshot(raw)!.cols)).toEqual(["agg:a"]);
  });
  it("bounded: at most UD_WIDTH_MAX_ENTRIES columns", () => {
    const cols = Object.fromEntries(Array.from({ length: UD_WIDTH_MAX_ENTRIES + 50 }, (_, i) => [`agg:${i}`, { printIn: 1, bestFitIn: 1 }]));
    expect(Object.keys(parseUdWidthSnapshot(JSON.stringify({ month: "2027-02", cols }))!.cols)).toHaveLength(UD_WIDTH_MAX_ENTRIES);
  });
  it("storage that throws (private mode) never breaks the page", () => {
    const bad = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
    expect(() => saveUdWidthSnapshot(snap, bad)).not.toThrow();
    expect(loadUdWidthSnapshot(bad)).toBeNull();
  });
  it("a browser that denies the storage getter itself never breaks the page", () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, "window");
    const win = {};
    Object.defineProperty(win, "localStorage", { get() { throw new Error("SecurityError"); } });
    Object.defineProperty(globalThis, "window", { value: win, configurable: true, writable: true });
    try {
      expect(() => saveUdWidthSnapshot(snap)).not.toThrow();
      expect(loadUdWidthSnapshot()).toBeNull();
    } finally {
      if (desc) Object.defineProperty(globalThis, "window", desc); else delete (globalThis as { window?: unknown }).window;
    }
  });
  it("one key, shared by the schedule page and Settings", () => {
    expect(UD_WIDTH_SNAPSHOT_KEY).toBe("yosched:udWidthSnapshot");
  });
});
