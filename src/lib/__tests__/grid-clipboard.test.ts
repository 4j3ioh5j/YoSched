import { describe, it, expect } from "vitest";
import { selectionToTsv, parseClipboardGrid, resolvePaste, pasteSummary } from "../grid-clipboard";

// Grid order: 3 dates (rows) × 3 staff (cols). Assignments below; missing = unassigned.
const dateOrder = ["2026-06-01", "2026-06-02", "2026-06-03"];
const staffOrder = ["s1", "s2", "s3"];
const codes: Record<string, string> = {
  "s1:2026-06-01": "ORC", "s2:2026-06-01": "X",   "s3:2026-06-01": "OR",
  "s1:2026-06-02": "X",   "s2:2026-06-02": "ORC", "s3:2026-06-02": "OR",
  "s1:2026-06-03": "OR",                          "s3:2026-06-03": "X",
};
const codeAt = (staffId: string, date: string) => codes[`${staffId}:${date}`];

const rect = (staff: string[], dates: string[]) =>
  staff.flatMap((s) => dates.map((d) => `${s}:${d}`));

describe("selectionToTsv", () => {
  it("emits a rectangle in grid order (dates rows, staff cols)", () => {
    const keys = rect(["s1", "s2"], ["2026-06-01", "2026-06-02"]);
    expect(selectionToTsv(keys, { dateOrder, staffOrder, codeAt })).toBe("ORC\tX\nX\tORC");
  });

  it("orders output by grid order, not selection/iteration order", () => {
    // s1 & s2 (adjacent) over 6/01 & 6/02, supplied scrambled.
    const keys = ["s2:2026-06-02", "s1:2026-06-01", "s2:2026-06-01", "s1:2026-06-02"];
    expect(selectionToTsv(keys, { dateOrder, staffOrder, codeAt })).toBe("ORC\tX\nX\tORC");
  });

  it("keeps a skipped middle staff column as a blank (bounding rectangle)", () => {
    // Select s1 & s3 on 6/01, skipping s2 — s2 must remain a blank middle column so
    // positions don't collapse when pasted into Excel.
    const keys = ["s1:2026-06-01", "s3:2026-06-01"];
    expect(selectionToTsv(keys, { dateOrder, staffOrder, codeAt })).toBe("ORC\t\tOR");
  });

  it("keeps a skipped middle date row as a blank (bounding rectangle)", () => {
    // Select s1 on 6/01 & 6/03, skipping 6/02 — 6/02 stays a blank middle row.
    const keys = ["s1:2026-06-01", "s1:2026-06-03"];
    expect(selectionToTsv(keys, { dateOrder, staffOrder, codeAt })).toBe("ORC\n\nOR");
  });

  it("renders an unassigned selected cell as blank", () => {
    const keys = rect(["s1", "s2"], ["2026-06-03"]); // s2 on 6/03 is unassigned
    expect(selectionToTsv(keys, { dateOrder, staffOrder, codeAt })).toBe("OR\t");
  });

  it("blanks bounding-box cells that are not in the selection", () => {
    // Select s1:6/01 and s2:6/02 — bounding box is 2x2 but only the diagonal is selected.
    const keys = ["s1:2026-06-01", "s2:2026-06-02"];
    expect(selectionToTsv(keys, { dateOrder, staffOrder, codeAt })).toBe("ORC\t\n\tORC");
  });

  it("handles a single cell", () => {
    expect(selectionToTsv(["s2:2026-06-01"], { dateOrder, staffOrder, codeAt })).toBe("X");
  });

  it("returns null for an empty selection", () => {
    expect(selectionToTsv([], { dateOrder, staffOrder, codeAt })).toBeNull();
  });
});

describe("parseClipboardGrid", () => {
  it("parses rows and tab-separated columns", () => {
    expect(parseClipboardGrid("ORC\tX\nOR\tX")).toEqual([["ORC", "X"], ["OR", "X"]]);
  });

  it("normalizes CRLF and drops one trailing newline (Excel)", () => {
    expect(parseClipboardGrid("ORC\tX\r\nOR\tX\r\n")).toEqual([["ORC", "X"], ["OR", "X"]]);
  });

  it("keeps interior blank cells", () => {
    expect(parseClipboardGrid("ORC\t\tOR")).toEqual([["ORC", "", "OR"]]);
  });

  it("handles a single value and empty text", () => {
    expect(parseClipboardGrid("ORC")).toEqual([["ORC"]]);
    expect(parseClipboardGrid("")).toEqual([]);
  });
});

describe("resolvePaste", () => {
  const dateOrder = ["2026-06-01", "2026-06-02", "2026-06-03"];
  const staffOrder = ["s1", "s2", "s3"];
  const codeToId = new Map([["ORC", "id-orc"], ["X", "id-x"], ["OR", "id-or"]]);
  const noLocks = () => false;
  const base = { dateOrder, staffOrder, codeToId, isLocked: noLocks };
  const at = (dateIndex: number, staffIndex: number) => ({ dateIndex, staffIndex });

  it("places a block positionally from the anchor, down and right", () => {
    const block = [["ORC", "X"], ["OR", "ORC"]];
    const { sets } = resolvePaste(block, at(0, 0), base);
    expect(sets).toEqual([
      { staffId: "s1", date: "2026-06-01", shiftTypeId: "id-orc" },
      { staffId: "s2", date: "2026-06-01", shiftTypeId: "id-x" },
      { staffId: "s1", date: "2026-06-02", shiftTypeId: "id-or" },
      { staffId: "s2", date: "2026-06-02", shiftTypeId: "id-orc" },
    ]);
  });

  it("anchors at a non-origin cell", () => {
    const { sets } = resolvePaste([["X"]], at(2, 2), base);
    expect(sets).toEqual([{ staffId: "s3", date: "2026-06-03", shiftTypeId: "id-x" }]);
  });

  it("matches codes case-insensitively", () => {
    const { sets } = resolvePaste([["orc"]], at(0, 0), base);
    expect(sets).toEqual([{ staffId: "s1", date: "2026-06-01", shiftTypeId: "id-orc" }]);
  });

  it("skips and counts unknown codes", () => {
    const res = resolvePaste([["ZZZ", "X"]], at(0, 0), base);
    expect(res.skippedUnknown).toBe(1);
    expect(res.sets).toEqual([{ staffId: "s2", date: "2026-06-01", shiftTypeId: "id-x" }]);
  });

  it("skips blank cells without clearing (counts them)", () => {
    const res = resolvePaste([["ORC", "", "OR"]], at(0, 0), base);
    expect(res.skippedBlank).toBe(1);
    expect(res.sets.map((s) => s.staffId)).toEqual(["s1", "s3"]);
  });

  it("skips and counts locked target cells", () => {
    const isLocked = (staffId: string) => staffId === "s2";
    const res = resolvePaste([["ORC", "X"]], at(0, 0), { ...base, isLocked });
    expect(res.skippedLocked).toBe(1);
    expect(res.sets).toEqual([{ staffId: "s1", date: "2026-06-01", shiftTypeId: "id-orc" }]);
  });

  it("clips cells past the right and bottom edges", () => {
    // 2x2 block anchored at the bottom-right cell → 3 of 4 fall off the grid.
    const block = [["ORC", "X"], ["OR", "X"]];
    const res = resolvePaste(block, at(2, 2), base);
    expect(res.clipped).toBe(3);
    expect(res.sets).toEqual([{ staffId: "s3", date: "2026-06-03", shiftTypeId: "id-orc" }]);
  });

  it("handles ragged rows", () => {
    const block = [["ORC"], ["OR", "X"]];
    const res = resolvePaste(block, at(0, 0), base);
    expect(res.sets).toEqual([
      { staffId: "s1", date: "2026-06-01", shiftTypeId: "id-orc" },
      { staffId: "s1", date: "2026-06-02", shiftTypeId: "id-or" },
      { staffId: "s2", date: "2026-06-02", shiftTypeId: "id-x" },
    ]);
  });
});

describe("pasteSummary", () => {
  const none = { skippedUnknown: 0, skippedLocked: 0, skippedBlank: 0, clipped: 0 };

  it("summarizes a clean paste", () => {
    expect(pasteSummary(12, none)).toBe("12 cells set");
    expect(pasteSummary(1, none)).toBe("1 cell set");
  });

  it("lists only non-zero skip categories", () => {
    expect(pasteSummary(5, { skippedUnknown: 2, skippedLocked: 1, skippedBlank: 3, clipped: 4 })).toBe(
      "5 cells set · 1 locked · 2 unknown codes · 4 past edge · 3 blank"
    );
  });

  it("folds server-side locks into the locked count", () => {
    expect(pasteSummary(3, { ...none, skippedLocked: 1 }, 2)).toBe("3 cells set · 3 locked");
  });
});
