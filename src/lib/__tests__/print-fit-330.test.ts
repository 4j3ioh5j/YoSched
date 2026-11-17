// Card #330 (Codex #1565 follow-ups to #328): the room the staff/count columns need is
// measured in each column's own print font (count cells print in the monospace font), and
// a measurement taken while the printout is shrunk (zoom) is scaled back to full size, so
// a late font-load callback during print can never under-budget them.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { printNeedPx } from "../print-layout";

const grid = readFileSync(path.join(__dirname, "../../app/schedule-grid.tsx"), "utf8");

describe("printNeedPx: widest text over every font group, at full size", () => {
  const narrow = (t: string) => t.length * 5;
  const mono = (t: string) => t.length * 7;
  it("takes the widest over the groups (count digits in monospace beat the narrow font)", () => {
    expect(printNeedPx([{ texts: ["AB", "CAL"], measure: narrow }, { texts: ["11"], measure: mono }], 1)).toBe(15);
    expect(printNeedPx([{ texts: ["AB"], measure: narrow }, { texts: ["11", "123"], measure: mono }], 1)).toBe(21);
  });
  it("a measurement under zoom is divided by it (0.5 zoom halves what the browser reports)", () => {
    const half = (t: string) => t.length * 5 * 0.5;
    expect(printNeedPx([{ texts: ["CALL"], measure: half }], 0.5)).toBe(20);
  });
  it("a bad zoom counts as none", () => {
    for (const z of [0, -1, NaN, Infinity]) expect(printNeedPx([{ texts: ["CALL"], measure: narrow }], z)).toBe(20);
  });
  it("a group with nothing to measure is skipped; nothing at all gives null", () => {
    expect(printNeedPx([{ texts: [], measure: mono }, { texts: ["AB"], measure: narrow }], 1)).toBe(10);
    expect(printNeedPx([{ texts: [], measure: mono }], 1)).toBeNull();
  });
  it("a bad measurement anywhere gives null (the generous fallback is used)", () => {
    expect(printNeedPx([{ texts: ["AB"], measure: narrow }, { texts: ["11"], measure: () => NaN }], 1)).toBeNull();
  });
});

describe("the grid measures count text in the count cells' font, and undoes the zoom", () => {
  it("count texts are kept apart and measured in the monospace font as well", () => {
    expect(grid).toMatch(/countTexts/);
    expect(grid).toMatch(/font-family:var\(--font-mono\)/);
  });
  it("the zoom is read from a known-width probe inside the print root", () => {
    expect(grid).toMatch(/printNeedPx\(/);
    expect(grid).toMatch(/width:100px/);
  });
});
