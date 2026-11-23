import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cutPlan, manualCellKeys } from "../grid-clipboard";

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

// Card #463: in Auto-generate, a hand-placed cell (source "manual" when the session began)
// can't be cleared; cut must leave it in place like a locked cell, not refuse the whole cut.
describe("cut keeps hand-placed cells during Auto-generate (card #463)", () => {
  const grid = readFileSync(join(__dirname, "../../app/schedule-grid.tsx"), "utf8");

  it("manualCellKeys lists only cells whose source is manual", () => {
    const keys = manualCellKeys([
      { staffId: "a", date: "2026-01-01", source: "manual" },
      { staffId: "b", date: "2026-01-01", source: "engine" },
      { staffId: "a", date: "2026-01-02", source: "manual" },
      { staffId: "c", date: "2026-01-03" },
    ]);
    expect([...keys].sort()).toEqual(["a:2026-01-01", "a:2026-01-02"]);
    expect(manualCellKeys([]).size).toBe(0);
  });

  it("a mixed selection clears the generated cells and keeps the hand-placed one", () => {
    const manual = new Set(["a:2026-01-01"]);
    const codes = new Map([["a:2026-01-01", "D"], ["b:2026-01-01", "N"]]);
    const plan = cutPlan(["a:2026-01-01", "b:2026-01-01"], {
      dateOrder: ["2026-01-01"],
      staffOrder: ["a", "b"],
      codeAt: (s, d) => codes.get(`${s}:${d}`),
      isLocked: (s, d) => manual.has(`${s}:${d}`),
    });
    expect(plan.tsv).toBe("D\tN");
    expect(plan.clears).toEqual([{ staffId: "b", date: "2026-01-01" }]);
    expect(plan.skippedLocked).toBe(1);
  });

  it("liveEdit and cut share the one hand-placed set; cut uses it only in Auto-generate", () => {
    const live = grid.slice(grid.indexOf("function liveEdit("), grid.indexOf("function liveEdit(") + 1500);
    expect(live).toMatch(/manualCellKeys\(base\.existingAssignments\)/);
    const i = grid.indexOf("function onCut(");
    const cut = grid.slice(i, grid.indexOf('document.addEventListener("cut", onCut)', i));
    expect(cut).toMatch(/liveModeRef\.current && liveBaseInputRef\.current \? manualCellKeys\(liveBaseInputRef\.current\.existingAssignments\)/);
    expect(cut).toMatch(/isLocked: \(staffId, date\) => !!assignmentMap\.get\(`\$\{staffId\}:\$\{date\}`\)\?\.isLocked \|\| handPlaced\.has\(`\$\{staffId\}:\$\{date\}`\)/);
    expect(cut).toMatch(/locked or hand-placed/);
  });
});
