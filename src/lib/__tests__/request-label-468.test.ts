// Card #468: a cell's request label must not depend on how the requests were entered. The panel
// saves "not ORC + not ORL" as one request (label "ORC,ORL"); the Shift-C / Shift-L hotkeys save
// two requests. Both must show "ORC,ORL".
import { describe, it, expect } from "vitest";
import { summarizeCellRequests } from "../schedule-requests";

const codes: Record<string, string> = { c: "ORC", l: "ORL", d: "D", v: "VAC" };
const codeOf = (id: string) => codes[id] ?? id;
const rank: Record<string, number> = { c: 0, l: 1, d: 2, v: 3 };
const rankOf = (id: string) => rank[id] ?? 99;
type R = Parameters<typeof summarizeCellRequests>[0][number];
const neg = (ids: string[], status: R["status"] = "pending"): R => ({ kind: "NEGATE_SHIFT", shiftTypeIds: ids, leaveShiftTypeId: null, status });
const want = (ids: string[], status: R["status"] = "pending"): R => ({ kind: "REQUEST_SHIFT", shiftTypeIds: ids, leaveShiftTypeId: null, status });

describe("request label is the same however the requests were entered", () => {
  it("two one-shift 'not' requests show the codes, like one two-shift request", () => {
    const panel = summarizeCellRequests([neg(["c", "l"])], codeOf, rankOf)!;
    const keys = summarizeCellRequests([neg(["l"]), neg(["c"])], codeOf, rankOf)!;
    expect(panel.label).toBe("ORC,ORL");
    expect(keys.label).toBe("ORC,ORL");
    expect(keys.count).toBe(2);
  });
  it("the codes follow the shift order, not the order the keys were pressed", () => {
    expect(summarizeCellRequests([neg(["l"]), neg(["c"])], codeOf, rankOf)!.label).toBe("ORC,ORL");
    expect(summarizeCellRequests([neg(["c"]), neg(["l"])], codeOf, rankOf)!.label).toBe("ORC,ORL");
  });
  it("a shift named twice is listed once", () => {
    expect(summarizeCellRequests([neg(["c"]), neg(["c", "l"])], codeOf, rankOf)!.label).toBe("ORC,ORL");
  });
  it("wanted shifts combine the same way", () => {
    expect(summarizeCellRequests([want(["d"]), want(["c"])], codeOf, rankOf)!.label).toBe("ORC,D");
  });
  it("mixed statuses still combine the codes; the status shows as mixed", () => {
    const s = summarizeCellRequests([neg(["c"], "approved"), neg(["l"])], codeOf, rankOf)!;
    expect(s.label).toBe("ORC,ORL");
    expect(s.statusKind).toBe("mixed");
  });
  it("different kinds of request on one cell still show the count", () => {
    expect(summarizeCellRequests([neg(["c"]), want(["d"])], codeOf, rankOf)!.label).toBe("2");
    const off: R = { kind: "OFF", shiftTypeIds: [], leaveShiftTypeId: null, status: "pending" };
    const lv: R = { kind: "LEAVE", shiftTypeIds: [], leaveShiftTypeId: "v", status: "pending" };
    expect(summarizeCellRequests([off, neg(["c"])], codeOf, rankOf)!.label).toBe("2");
    expect(summarizeCellRequests([lv, off], codeOf, rankOf)!.label).toBe("2");
  });
  it("a single request is unchanged, and the rank is optional", () => {
    expect(summarizeCellRequests([neg(["l", "c"])], codeOf, rankOf)!.label).toBe("ORL,ORC");
    expect(summarizeCellRequests([neg(["l"]), neg(["c"])], codeOf)!.label).toBe("ORL,ORC");
  });
  it("the grid passes the shift order", () => {
    const grid = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
    expect(grid).toMatch(/summarizeCellRequests\(reqs, \(id\) => shiftTypeMap\.get\(id\)\?\.code \?\? id, shiftRankOf\)/);
  });
});
