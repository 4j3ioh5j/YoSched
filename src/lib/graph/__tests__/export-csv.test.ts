import { describe, it, expect } from "vitest";
import { toCsvText, buildEquityCsvRows, type EquityCsvRow, type EquityCsvOptions } from "../export-csv";

describe("toCsvText", () => {
  it("joins cells with commas and rows with CRLF", () => {
    expect(toCsvText([["a", "b"], [1, 2]])).toBe("a,b\r\n1,2");
  });

  it("quotes cells containing a comma, quote, or newline and doubles quotes", () => {
    expect(toCsvText([["a,b", 'say "hi"', "line\nbreak"]])).toBe('"a,b","say ""hi""","line\nbreak"');
  });

  it("leaves plain cells unquoted", () => {
    expect(toCsvText([["plain", 42]])).toBe("plain,42");
  });

  it("renders null/undefined as empty cells", () => {
    expect(toCsvText([[null as unknown as string, undefined as unknown as string, "x"]])).toBe(",,x");
  });
});

const baseRow: EquityCsvRow = {
  initials: "AB",
  name: "Alice Brown",
  employmentTypeName: "FTE",
  ftePercentage: 0.5,
  displayDeviation: { desirability: -0.3 },
  deviation: { desirability: 0.12 },
  holidayWorkCount: 2,
  shiftCounts: { CALL: 5, ORC: 1 },
  shiftTally: { CALL: 9 },
  totalHours: 1200,
  totalWorkDays: 100,
  totalLeaveDays: 4,
};

const allOff: EquityCsvOptions = {
  showDesirability: false,
  showHoliday: false,
  activeShiftCodes: [],
  showTallies: false,
  tallyCodes: [],
};

describe("buildEquityCsvRows", () => {
  it("emits the base columns and an FTE percentage", () => {
    const [header, row] = buildEquityCsvRows([baseRow], allOff);
    expect(header).toEqual(["Initials", "Name", "Type", "FTE%", "Hours", "Work Days", "Leave Days"]);
    expect(row).toEqual(["AB", "Alice Brown", "FTE", 50, 1200, 100, 4]);
  });

  it("adds desirability columns using the negated convention, rounded to 2dp", () => {
    const [header, row] = buildEquityCsvRows([baseRow], { ...allOff, showDesirability: true });
    expect(header.slice(4, 6)).toEqual(["Desirability", "Opp. Adj."]);
    // -(-0.3) = 0.3 ; -(0.12) = -0.12
    expect(row[4]).toBe(0.3);
    expect(row[5]).toBe(-0.12);
  });

  it("adds holiday, per-code, and tally columns in order", () => {
    const [header, row] = buildEquityCsvRows([baseRow], {
      showDesirability: false,
      showHoliday: true,
      activeShiftCodes: ["CALL", "ORC"],
      showTallies: true,
      tallyCodes: ["CALL"],
    });
    expect(header).toEqual(["Initials", "Name", "Type", "FTE%", "Holidays", "CALL", "ORC", "Hours", "Work Days", "Leave Days", "Tally CALL"]);
    // holiday=2, CALL=5, ORC=1, hours/work/leave, tally CALL=9
    expect(row).toEqual(["AB", "Alice Brown", "FTE", 50, 2, 5, 1, 1200, 100, 4, 9]);
  });

  it("defaults missing shift counts and tallies to 0", () => {
    const [, row] = buildEquityCsvRows([baseRow], {
      ...allOff,
      activeShiftCodes: ["ZZZ"],
      showTallies: true,
      tallyCodes: ["ZZZ"],
    });
    // ZZZ count missing -> 0 ; ZZZ tally missing -> 0
    expect(row).toContain(0);
    expect(row[4]).toBe(0); // the ZZZ shift count column
  });
});
