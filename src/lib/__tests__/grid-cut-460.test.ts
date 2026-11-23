import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cutPlan } from "../grid-clipboard";

// Card #460: Ctrl/Cmd+X did nothing anywhere, and in autogeneration (Live) Ctrl/Cmd+C copied
// the SAVED grid, so cells the engine had just generated (not saved yet) copied as blanks and
// the following Ctrl/Cmd+V pasted nothing. Cut = copy what is shown + clear those cells.

const dateOrder = ["2026-06-01", "2026-06-02", "2026-06-03"];
const staffOrder = ["s1", "s2"];
const shown: Record<string, string> = { "s1:2026-06-01": "D", "s2:2026-06-01": "N", "s1:2026-06-02": "C" };
const locked = new Set(["s2:2026-06-01"]);
const opts = {
  dateOrder,
  staffOrder,
  codeAt: (s: string, d: string) => shown[`${s}:${d}`],
  isLocked: (s: string, d: string) => locked.has(`${s}:${d}`),
};

describe("cutPlan (card #460)", () => {
  it("copies every selected cell as shown, and clears only filled, unlocked cells", () => {
    const p = cutPlan(["s1:2026-06-01", "s2:2026-06-01", "s1:2026-06-02", "s2:2026-06-02"], opts);
    expect(p.tsv).toBe("D\tN\nC\t");
    expect(p.clears).toEqual([
      { staffId: "s1", date: "2026-06-01" },
      { staffId: "s1", date: "2026-06-02" },
    ]);
    expect(p.skippedLocked).toBe(1);
  });

  it("returns nothing to do for an empty selection or cells off the grid", () => {
    expect(cutPlan([], opts)).toEqual({ tsv: null, clears: [], skippedLocked: 0 });
    expect(cutPlan(["zz:2026-06-01"], opts)).toEqual({ tsv: null, clears: [], skippedLocked: 0 });
  });

  it("an empty cell copies as blank and clears nothing", () => {
    const p = cutPlan(["s2:2026-06-03"], opts);
    expect(p.tsv).toBe("");
    expect(p.clears).toEqual([]);
  });
});

describe("grid wiring (card #460)", () => {
  const grid = readFileSync(join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
  const body = (start: string, end: string) => {
    const i = grid.indexOf(start);
    expect(i, start).toBeGreaterThan(-1);
    return grid.slice(i, grid.indexOf(end, i));
  };

  it("a cut listener exists, with the same guards as copy", () => {
    const cut = body("function onCut(", 'document.addEventListener("cut", onCut)');
    expect(cut).toMatch(/if \([^)]*\bmodalOpen\b[^)]*\) return;/);
    expect(cut).toMatch(/INPUT/);
    expect(cut).toMatch(/cutPlan\(/);
    expect(cut).toMatch(/canEdit/);
  });

  it("staff copy and cut read the cells as shown (Live-aware), not only the saved grid", () => {
    for (const [s, e] of [["function onCopy(", 'document.addEventListener("copy", onCopy)'], ["function onCut(", 'document.addEventListener("cut", onCut)']]) {
      const b = body(s, e);
      expect(b, s).toMatch(/codeAt: \(staffId, date\) => effectiveAssignmentMap\.get\(/);
    }
  });

  it("the help lists Ctrl / Cmd + X", () => {
    expect(grid).toMatch(/\["Ctrl \/ Cmd \+ X",/);
  });
});
