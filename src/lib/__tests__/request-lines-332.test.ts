// Card #332: the Requests page groups a person's requests per day into lines, and a finished month's
// days move to an Archive whose met / not-met outcome is computed live from the schedule.
import { describe, it, expect } from "vitest";
import {
  groupRequestLines,
  isArchivedDay,
  dateInZone,
  archivedDayOutcome,
  isLeaveRequest,
  parseArchiveLeaveRule,
  isArchiveLeaveRule,
  isValidArchiveDays,
  archivedMonths,
  ARCHIVE_LEAVE_RULES,
  type LineRequest,
  type ShiftFacts,
  type ArchiveLeaveRule,
} from "../request-lines";
import { assignmentSatisfiesRequestOnDate } from "../schedule-requests";

// Shift ids: OR/ORC/ORL/PAIN work; X off; AL/HOL leave.
const FACTS: Record<string, ShiftFacts> = {
  OR: { isOff: false, isLeave: false },
  ORC: { isOff: false, isLeave: false },
  ORL: { isOff: false, isLeave: false },
  PAIN: { isOff: false, isLeave: false },
  X: { isOff: true, isLeave: false },
  AL: { isOff: false, isLeave: true },
  HOL: { isOff: false, isLeave: true },
};
const factsOf = (id: string) => FACTS[id];
const isOff = (id: string) => !!FACTS[id]?.isOff;

let n = 0;
function req(p: Partial<LineRequest> & Pick<LineRequest, "kind" | "startDate">): LineRequest {
  n += 1;
  return {
    id: p.id ?? `r${n}`,
    staffId: p.staffId ?? "BR",
    startDate: p.startDate,
    endDate: p.endDate ?? p.startDate,
    kind: p.kind,
    shiftTypeIds: p.shiftTypeIds ?? [],
    leaveShiftTypeId: p.leaveShiftTypeId ?? null,
    strength: p.strength ?? "hard",
    status: p.status ?? "approved",
  };
}
const all = () => true;

describe("grouping (current list)", () => {
  it("consecutive identical days merge into one line; the three key-press rows of a day are one line", () => {
    const rs: LineRequest[] = [];
    for (const d of ["2027-01-11", "2027-01-12", "2027-01-13"]) {
      rs.push(req({ kind: "REQUEST_SHIFT", startDate: d, shiftTypeIds: ["OR"] }));
      rs.push(req({ kind: "NEGATE_SHIFT", startDate: d, shiftTypeIds: ["ORC"] }));
      rs.push(req({ kind: "NEGATE_SHIFT", startDate: d, shiftTypeIds: ["ORL"] }));
    }
    const lines = groupRequestLines(rs, { includeDate: all });
    expect(lines).toHaveLength(1);
    expect(lines[0].startDate).toBe("2027-01-11");
    expect(lines[0].endDate).toBe("2027-01-13");
    expect(lines[0].dates).toEqual(["2027-01-11", "2027-01-12", "2027-01-13"]);
    // Two NEGATE rows with the same status join into one part "not ORC, ORL".
    expect(lines[0].parts.map((p) => [p.kind, p.shiftTypeIds])).toEqual([
      ["REQUEST_SHIFT", ["OR"]],
      ["NEGATE_SHIFT", ["ORC", "ORL"]],
    ]);
    expect(lines[0].parts[0].requestIds).toHaveLength(3);
    expect(lines[0].parts[1].requestIds).toHaveLength(6);
  });

  it("a status difference splits the run (partial approval → several lines)", () => {
    const rs = [
      req({ kind: "REQUEST_SHIFT", startDate: "2027-01-11", endDate: "2027-01-12", shiftTypeIds: ["OR"] }),
      req({ kind: "REQUEST_SHIFT", startDate: "2027-01-13", shiftTypeIds: ["OR"], status: "pending" }),
      req({ kind: "REQUEST_SHIFT", startDate: "2027-01-14", shiftTypeIds: ["OR"] }),
    ];
    const lines = groupRequestLines(rs, { includeDate: all });
    expect(lines.map((l) => [l.startDate, l.endDate, l.parts[0].status])).toEqual([
      ["2027-01-11", "2027-01-12", "approved"],
      ["2027-01-13", "2027-01-13", "pending"],
      ["2027-01-14", "2027-01-14", "approved"],
    ]);
  });

  it("a gap day splits the run, and different people never share a line", () => {
    const rs = [
      req({ kind: "OFF", startDate: "2027-01-11" }),
      req({ kind: "OFF", startDate: "2027-01-13" }),
      req({ kind: "OFF", startDate: "2027-01-11", staffId: "BC" }),
    ];
    const lines = groupRequestLines(rs, { includeDate: all });
    expect(lines.map((l) => [l.staffId, l.startDate, l.endDate])).toEqual([
      ["BC", "2027-01-11", "2027-01-11"],
      ["BR", "2027-01-11", "2027-01-11"],
      ["BR", "2027-01-13", "2027-01-13"],
    ]);
  });

  it("a range request split by another request on its middle day gives three lines", () => {
    const rs = [
      req({ kind: "NEGATE_SHIFT", startDate: "2027-02-01", endDate: "2027-02-05", shiftTypeIds: ["ORC"] }),
      req({ kind: "OFF", startDate: "2027-02-03" }),
    ];
    const lines = groupRequestLines(rs, { includeDate: all });
    expect(lines.map((l) => [l.startDate, l.endDate, l.parts.length])).toEqual([
      ["2027-02-01", "2027-02-02", 1],
      ["2027-02-03", "2027-02-03", 2],
      ["2027-02-04", "2027-02-05", 1],
    ]);
    // Every line names the same whole request, so actions still act on the request.
    expect(new Set(lines.map((l) => l.parts.find((p) => p.kind === "NEGATE_SHIFT")!.requestIds[0])).size).toBe(1);
  });

  it("strength and the leave type are part of what makes two days identical", () => {
    const rs = [
      req({ kind: "OFF", startDate: "2027-01-11" }),
      req({ kind: "OFF", startDate: "2027-01-12", strength: "soft" }),
      req({ kind: "LEAVE", startDate: "2027-01-13", leaveShiftTypeId: "AL" }),
      req({ kind: "LEAVE", startDate: "2027-01-14", leaveShiftTypeId: "HOL" }),
    ];
    expect(groupRequestLines(rs, { includeDate: all })).toHaveLength(4);
  });

  it("includeDate filters days, so a month-boundary request splits between lists day by day", () => {
    const r = req({ kind: "LEAVE", startDate: "2027-01-30", endDate: "2027-02-02", leaveShiftTypeId: "AL" });
    const jan = groupRequestLines([r], { includeDate: (d) => d < "2027-02-01" });
    const feb = groupRequestLines([r], { includeDate: (d) => d >= "2027-02-01" });
    expect(jan.map((l) => [l.startDate, l.endDate])).toEqual([["2027-01-30", "2027-01-31"]]);
    expect(feb.map((l) => [l.startDate, l.endDate])).toEqual([["2027-02-01", "2027-02-02"]]);
  });

  it("no data is merged: the same request ids come back, once per part", () => {
    const rs = [req({ kind: "OFF", startDate: "2027-01-11", id: "a" }), req({ kind: "OFF", startDate: "2027-01-11", id: "b" })];
    const lines = groupRequestLines(rs, { includeDate: all });
    expect(lines).toHaveLength(1);
    expect(lines[0].parts[0].requestIds.sort()).toEqual(["a", "b"]);
  });
});

describe("archive day", () => {
  it("N=0: a day archives the day after its month ends", () => {
    expect(isArchivedDay("2027-01-15", "2027-01-31", 0)).toBe(false);
    expect(isArchivedDay("2027-01-15", "2027-02-01", 0)).toBe(true);
    expect(isArchivedDay("2027-01-31", "2027-02-01", 0)).toBe(true);
    expect(isArchivedDay("2027-02-01", "2027-02-01", 0)).toBe(false);
  });
  it("N=3: waits three days after the month's last day", () => {
    expect(isArchivedDay("2027-01-02", "2027-02-03", 3)).toBe(false);
    expect(isArchivedDay("2027-01-02", "2027-02-04", 3)).toBe(true);
    // February in a non-leap year ends on the 28th.
    expect(isArchivedDay("2027-02-10", "2027-03-03", 3)).toBe(false);
    expect(isArchivedDay("2027-02-10", "2027-03-04", 3)).toBe(true);
  });
  it("today is the Settings zone's calendar date, not UTC's", () => {
    // 2027-02-01 03:00 UTC is still 31 January in Los Angeles.
    const at = new Date("2027-02-01T03:00:00Z");
    expect(dateInZone(at, "UTC")).toBe("2027-02-01");
    expect(dateInZone(at, "America/Los_Angeles")).toBe("2027-01-31");
    expect(isArchivedDay("2027-01-20", dateInZone(at, "America/Los_Angeles"), 0)).toBe(false);
    expect(isArchivedDay("2027-01-20", dateInZone(at, "UTC"), 0)).toBe(true);
    // An invalid stored zone falls back to UTC.
    expect(dateInZone(at, "Not/AZone")).toBe("2027-02-01");
  });
  it("archivedMonths lists the months that have archived days, newest first", () => {
    const rs = [
      req({ kind: "OFF", startDate: "2026-12-30", endDate: "2027-01-02" }),
      req({ kind: "OFF", startDate: "2027-02-10" }),
    ];
    expect(archivedMonths(rs, "2027-02-15", 0)).toEqual(["2027-01", "2026-12"]);
    expect(archivedMonths(rs, "2027-03-01", 0)).toEqual(["2027-02", "2027-01", "2026-12"]);
  });
});

describe("settings values", () => {
  it("leave rule: three values, default any-off, junk falls back", () => {
    expect([...ARCHIVE_LEAVE_RULES]).toEqual(["exact", "any-leave", "any-off"]);
    expect(isArchiveLeaveRule("any-leave")).toBe(true);
    expect(isArchiveLeaveRule("ANY")).toBe(false);
    expect(parseArchiveLeaveRule(undefined)).toBe("any-off");
    expect(parseArchiveLeaveRule("nope")).toBe("any-off");
    expect(parseArchiveLeaveRule("exact")).toBe("exact");
  });
  it("archive days: whole numbers 0–60 only", () => {
    expect(isValidArchiveDays(0)).toBe(true);
    expect(isValidArchiveDays(60)).toBe(true);
    expect(isValidArchiveDays(61)).toBe(false);
    expect(isValidArchiveDays(-1)).toBe(false);
    expect(isValidArchiveDays(1.5)).toBe(false);
    expect(isValidArchiveDays("3")).toBe(false);
  });
});

describe("archived outcome", () => {
  const rules: ArchiveLeaveRule[] = ["exact", "any-leave", "any-off"];
  const o = (r: LineRequest, got: string | null, rule: ArchiveLeaveRule = "any-off") => archivedDayOutcome(r, got, factsOf, rule);

  it("NEGATE: met by any other shift, a day off, leave or a blank day; not met by a negated shift", () => {
    const r = req({ kind: "NEGATE_SHIFT", startDate: "2027-01-11", shiftTypeIds: ["ORC", "ORL"] });
    for (const rule of rules) {
      expect(o(r, "OR", rule)).toBe("met");
      expect(o(r, "X", rule)).toBe("met");
      expect(o(r, "HOL", rule)).toBe("met");
      expect(o(r, null, rule)).toBe("met");
      expect(o(r, "ORC", rule)).toBe("unmet");
      expect(o(r, "ORL", rule)).toBe("unmet");
    }
  });

  it("OFF: met by not working (off, leave or blank); not met by a working shift", () => {
    const r = req({ kind: "OFF", startDate: "2027-01-11" });
    for (const rule of rules) {
      expect(o(r, "X", rule)).toBe("met");
      expect(o(r, "AL", rule)).toBe("met");
      expect(o(r, null, rule)).toBe("met");
      expect(o(r, "OR", rule)).toBe("unmet");
    }
  });

  it("wants a work shift: met only by a wanted shift; a blank day is not met", () => {
    const r = req({ kind: "REQUEST_SHIFT", startDate: "2027-01-18", shiftTypeIds: ["OR"] });
    for (const rule of rules) {
      expect(o(r, "OR", rule)).toBe("met");
      expect(o(r, "HOL", rule)).toBe("unmet");
      expect(o(r, "X", rule)).toBe("unmet");
      expect(o(r, null, rule)).toBe("unmet");
    }
  });

  it("LEAVE under each rule", () => {
    const r = req({ kind: "LEAVE", startDate: "2027-01-11", leaveShiftTypeId: "AL" });
    const table: Record<ArchiveLeaveRule, Record<string, string>> = {
      exact: { AL: "met", HOL: "unmet", X: "unmet", OR: "unmet", blank: "unmet" },
      "any-leave": { AL: "met", HOL: "met", X: "unmet", OR: "unmet", blank: "unmet" },
      "any-off": { AL: "met", HOL: "met", X: "met", OR: "unmet", blank: "met" },
    };
    for (const rule of rules)
      for (const [got, want] of Object.entries(table[rule])) expect([rule, got, o(r, got === "blank" ? null : got, rule)]).toEqual([rule, got, want]);
  });

  it("REQUEST_SHIFT whose wanted shifts are all leave follows the leave rule (My Requests saves leave this way)", () => {
    const r = req({ kind: "REQUEST_SHIFT", startDate: "2027-01-11", shiftTypeIds: ["AL"] });
    expect(isLeaveRequest(r, factsOf)).toBe(true);
    expect(o(r, "AL", "exact")).toBe("met");
    expect(o(r, "HOL", "exact")).toBe("unmet");
    expect(o(r, "HOL", "any-leave")).toBe("met");
    expect(o(r, "X", "any-leave")).toBe("unmet");
    expect(o(r, "X", "any-off")).toBe("met");
    expect(o(r, null, "exact")).toBe("unmet");
    expect(o(r, null, "any-leave")).toBe("unmet");
    expect(o(r, null, "any-off")).toBe("met");
    expect(o(r, "OR", "any-off")).toBe("unmet");
  });

  it("a mixed REQUEST_SHIFT (work and leave options) keeps plain either-or: the leave rule never widens it", () => {
    const r = req({ kind: "REQUEST_SHIFT", startDate: "2027-01-11", shiftTypeIds: ["OR", "AL"] });
    expect(isLeaveRequest(r, factsOf)).toBe(false);
    for (const rule of rules) {
      expect(o(r, "OR", rule)).toBe("met");
      expect(o(r, "AL", rule)).toBe("met");
      expect(o(r, "HOL", rule)).toBe("unmet");
      expect(o(r, "X", rule)).toBe("unmet");
      expect(o(r, null, rule)).toBe("unmet");
    }
  });

  it("an unknown (deleted) shift never counts as leave or off", () => {
    const r = req({ kind: "LEAVE", startDate: "2027-01-11", leaveShiftTypeId: "AL" });
    expect(o(r, "GONE", "any-off")).toBe("unmet");
  });
});

describe("the archive rules never reach the live predicate", () => {
  it("assignmentSatisfiesRequestOnDate keeps the card 175 rule and a blank live day never satisfies", () => {
    const negate = req({ kind: "NEGATE_SHIFT", startDate: "2027-03-01", shiftTypeIds: ["ORC"] });
    const off = req({ kind: "OFF", startDate: "2027-03-01" });
    const leave = req({ kind: "LEAVE", startDate: "2027-03-01", leaveShiftTypeId: "AL" });
    const want = req({ kind: "REQUEST_SHIFT", startDate: "2027-03-01", shiftTypeIds: ["AL"] });
    for (const r of [negate, off, leave, want]) expect(assignmentSatisfiesRequestOnDate(r, null, isOff)).toBe(false);
    expect(assignmentSatisfiesRequestOnDate(leave, "AL", isOff)).toBe(true);
    expect(assignmentSatisfiesRequestOnDate(leave, "X", isOff)).toBe(true);
    expect(assignmentSatisfiesRequestOnDate(leave, "HOL", isOff)).toBe(false);
    expect(assignmentSatisfiesRequestOnDate(off, "AL", isOff)).toBe(false);
    expect(assignmentSatisfiesRequestOnDate(want, "X", isOff)).toBe(false);
  });
});

describe("archived lines", () => {
  const cells: Record<string, string | null> = {
    "BR|2027-01-15": "OR",
    "BR|2027-01-16": "OR",
    "BR|2027-01-17": "PAIN",
    "BR|2027-01-18": "HOL",
    "BR|2027-01-19": "ORC",
  };
  const cellOf = (staffId: string, date: string) => cells[`${staffId}|${date}`] ?? null;
  const archived = (rule: ArchiveLeaveRule = "any-off") => ({ cellOf, factsOf, rule });

  it("a line splits where the outcome differs, and a not-met day says what they got", () => {
    const rs = [req({ kind: "REQUEST_SHIFT", startDate: "2027-01-15", endDate: "2027-01-18", shiftTypeIds: ["OR"], status: "pending" })];
    const lines = groupRequestLines(rs, { includeDate: all, archived: archived() });
    expect(lines.map((l) => [l.startDate, l.endDate, l.parts[0].outcome, l.got])).toEqual([
      ["2027-01-15", "2027-01-16", "met", undefined],
      ["2027-01-17", "2027-01-17", "unmet", "PAIN"],
      ["2027-01-18", "2027-01-18", "unmet", "HOL"],
    ]);
  });

  it("met days with different shifts stay one line (what they got only matters when something was not met)", () => {
    const rs = [req({ kind: "NEGATE_SHIFT", startDate: "2027-01-15", endDate: "2027-01-18", shiftTypeIds: ["ORL"] })];
    const lines = groupRequestLines(rs, { includeDate: all, archived: archived() });
    expect(lines).toHaveLength(1);
    expect(lines[0].parts[0].outcome).toBe("met");
  });

  it("a declined request the schedule gave anyway shows met; a withdrawn one stays withdrawn", () => {
    const rs = [
      req({ kind: "REQUEST_SHIFT", startDate: "2027-01-15", shiftTypeIds: ["OR"], status: "declined" }),
      req({ kind: "OFF", startDate: "2027-01-15", status: "withdrawn" }),
    ];
    const [line] = groupRequestLines(rs, { includeDate: all, archived: archived() });
    const byKind = Object.fromEntries(line.parts.map((p) => [p.kind, p.outcome]));
    expect(byKind).toEqual({ REQUEST_SHIFT: "met", OFF: "withdrawn" });
  });

  it("nothing scheduled shows as a blank got (null)", () => {
    const rs = [req({ kind: "REQUEST_SHIFT", startDate: "2027-01-25", shiftTypeIds: ["OR"] })];
    const [line] = groupRequestLines(rs, { includeDate: all, archived: archived() });
    expect(line.parts[0].outcome).toBe("unmet");
    expect(line.got).toBeNull();
  });

  it("the outcome is live: a changed schedule changes it on the next grouping", () => {
    const rs = [req({ kind: "NEGATE_SHIFT", startDate: "2027-01-19", shiftTypeIds: ["ORC"] })];
    expect(groupRequestLines(rs, { includeDate: all, archived: archived() })[0].parts[0].outcome).toBe("unmet");
    cells["BR|2027-01-19"] = "OR";
    expect(groupRequestLines(rs, { includeDate: all, archived: archived() })[0].parts[0].outcome).toBe("met");
  });

  it("the leave rule setting changes an archived leave line", () => {
    const rs = [req({ kind: "LEAVE", startDate: "2027-01-18", leaveShiftTypeId: "AL" })];
    expect(groupRequestLines(rs, { includeDate: all, archived: archived("exact") })[0].parts[0].outcome).toBe("unmet");
    expect(groupRequestLines(rs, { includeDate: all, archived: archived("any-leave") })[0].parts[0].outcome).toBe("met");
  });
});
