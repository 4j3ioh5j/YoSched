import { describe, it, expect } from "vitest";
import { selectionToTsv } from "../grid-clipboard";

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
