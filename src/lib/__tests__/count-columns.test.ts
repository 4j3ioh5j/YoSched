import { describe, it, expect } from "vitest";
import { deriveCountColumnCodes, buildCountColumnsSave, countColumnsSaveErrorMessage, countColumnTotals, COUNT_COLUMNS_SAVE_URL } from "../count-columns";
import { STALE_CLIENT, saveErrorMessage } from "../stale-client";
import { equitySaveErrorMessage } from "../equity-factors";

// Count columns are stored by shift id; the chip codes are derived from the shift list loaded
// in the same request, and the grid counts cells by their shiftTypeId.

describe("deriveCountColumnCodes", () => {
  it("gives each column its shifts' CURRENT codes in the stored order; an unknown id is dropped, never invented", () => {
    const shifts = [
      { id: "st-or", code: "OR" },
      { id: "st-orc", code: "ORCX" }, // renamed ORC → ORCX
      { id: "st-orl", code: "ORL" },
    ];
    const out = deriveCountColumnCodes(
      [
        { id: "c1", label: "OR", shiftTypeIds: ["st-orl", "st-orc", "st-or"] },
        { id: "c2", label: "Gone", shiftTypeIds: ["st-gone", "st-or"] },
        { id: "c3", label: "Empty", shiftTypeIds: [] },
      ],
      shifts,
    );
    expect(out.map((c) => c.shiftCodes)).toEqual([["ORL", "ORCX", "OR"], ["OR"], []]);
    expect(out[0]).toMatchObject({ id: "c1", label: "OR", shiftTypeIds: ["st-orl", "st-orc", "st-or"] });
  });
});

describe("buildCountColumnsSave", () => {
  it("sends ids only (no shiftCodes key anywhere), sortOrder = position, to the by-shift-id route", () => {
    const payload = buildCountColumnsSave([
      { label: "OR", shiftTypeIds: ["st-or", "st-orc"] },
      { label: "Call", shiftTypeIds: ["st-call"] },
    ]);
    expect(payload).toEqual({
      columns: [
        { label: "OR", shiftTypeIds: ["st-or", "st-orc"], sortOrder: 0 },
        { label: "Call", shiftTypeIds: ["st-call"], sortOrder: 1 },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain("shiftCodes");
    expect(COUNT_COLUMNS_SAVE_URL).toBe("/api/settings/count-columns/by-shift-id");
  });

  it("copies the id arrays (editing the payload cannot change the UI state)", () => {
    const state = [{ label: "OR", shiftTypeIds: ["st-or"] }];
    const payload = buildCountColumnsSave(state);
    payload.columns[0].shiftTypeIds.push("st-x");
    expect(state[0].shiftTypeIds).toEqual(["st-or"]);
  });
});

describe("saveErrorMessage (shared by count columns and equity factors)", () => {
  it("404/405 (a server from before the slice) → the reload message; else the server's error; else the body", () => {
    expect(countColumnsSaveErrorMessage(404, "")).toBe(STALE_CLIENT.error);
    expect(countColumnsSaveErrorMessage(405, "Method Not Allowed")).toBe(STALE_CLIENT.error);
    expect(countColumnsSaveErrorMessage(409, JSON.stringify(STALE_CLIENT))).toBe(STALE_CLIENT.error);
    expect(countColumnsSaveErrorMessage(400, JSON.stringify({ error: "Unknown shift x", reason: "unknown-shift" }))).toBe("Unknown shift x");
    expect(countColumnsSaveErrorMessage(500, "boom")).toBe("boom");
    expect(countColumnsSaveErrorMessage(500, "")).toBe("Save failed (500)");
    expect(countColumnsSaveErrorMessage(500, "{not json")).toBe("{not json");
    expect(equitySaveErrorMessage).toBe(saveErrorMessage);
    expect(countColumnsSaveErrorMessage).toBe(saveErrorMessage);
  });
});

describe("countColumnTotals", () => {
  // Two shifts whose codes are each other's ids: any code/id mix-up shows up.
  const A = { id: "st-a", code: "st-b" };
  const B = { id: "st-b", code: "st-a" };
  const dates = ["2027-01-04", "2027-01-05"];
  const cells = new Map<string, { shiftTypeId: string; code: string }>([
    ["p1:2027-01-04", { shiftTypeId: A.id, code: A.code }],
    ["p2:2027-01-04", { shiftTypeId: A.id, code: A.code }],
    ["p3:2027-01-04", { shiftTypeId: B.id, code: B.code }],
    ["p1:2027-01-05", { shiftTypeId: B.id, code: B.code }],
  ]);
  const at = (pid: string, date: string) => cells.get(`${pid}:${date}`)?.shiftTypeId;

  it("counts, per date, the staff whose cell's shiftTypeId is one of the column's ids", () => {
    const totals = countColumnTotals(
      [{ label: "A", shiftTypeIds: [A.id] }, { label: "B", shiftTypeIds: [B.id] }, { label: "AB", shiftTypeIds: [A.id, B.id] }, { label: "none", shiftTypeIds: [] }],
      dates,
      ["p1", "p2", "p3", "p4"],
      at,
    );
    expect(totals).toEqual([
      { "2027-01-04": 2, "2027-01-05": 0 },
      { "2027-01-04": 1, "2027-01-05": 1 },
      { "2027-01-04": 3, "2027-01-05": 1 },
      { "2027-01-04": 0, "2027-01-05": 0 },
    ]);
  });

  it("only the listed staff count (hidden/inactive columns excluded by the caller)", () => {
    expect(countColumnTotals([{ label: "A", shiftTypeIds: [A.id] }], dates, ["p1"], at)).toEqual([{ "2027-01-04": 1, "2027-01-05": 0 }]);
  });

  it("a renamed shift keeps counting (the id did not change)", () => {
    const renamed = (pid: string, date: string) => (cells.get(`${pid}:${date}`)?.shiftTypeId === A.id ? "st-a" : cells.get(`${pid}:${date}`)?.shiftTypeId);
    expect(countColumnTotals([{ label: "A", shiftTypeIds: ["st-a"] }], dates, ["p1", "p2", "p3"], renamed)).toEqual([{ "2027-01-04": 2, "2027-01-05": 0 }]);
  });
});
