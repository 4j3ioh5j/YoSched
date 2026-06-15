import { describe, it, expect } from "vitest";
import { awayShiftChoices } from "../request-away-choices";

const AL = { code: "AL", isLeave: true, isOffShift: false };
const SL = { code: "SL", isLeave: true, isOffShift: false };
const ORC = { code: "ORC", isLeave: false, isOffShift: false };
// The real-world trouble case: "X"/Off is flagged BOTH isLeave and isOffShift.
const X = { code: "X", isLeave: true, isOffShift: true };

describe("awayShiftChoices", () => {
  it("lists the Off shift exactly once when it is also flagged isLeave (the X bug)", () => {
    const codes = awayShiftChoices([AL, SL, ORC, X], true).map((s) => s.code);
    expect(codes).toEqual(["AL", "SL", "X"]);
    expect(codes.filter((c) => c === "X")).toHaveLength(1);
  });

  it("appends the Off shift after the leave types in Request mode", () => {
    expect(awayShiftChoices([AL, X], true).map((s) => s.code)).toEqual(["AL", "X"]);
  });

  it("omits the Off shift entirely when not requesting a shift", () => {
    expect(awayShiftChoices([AL, SL, X], false).map((s) => s.code)).toEqual(["AL", "SL"]);
  });

  it("excludes work shifts", () => {
    expect(awayShiftChoices([AL, ORC], true).map((s) => s.code)).toEqual(["AL"]);
  });

  it("handles no Off shift configured", () => {
    expect(awayShiftChoices([AL, SL], true).map((s) => s.code)).toEqual(["AL", "SL"]);
  });

  it("handles a pure Off shift (isOffShift only, not isLeave)", () => {
    const pureOff = { code: "X", isLeave: false, isOffShift: true };
    expect(awayShiftChoices([AL, pureOff], true).map((s) => s.code)).toEqual(["AL", "X"]);
    expect(awayShiftChoices([AL, pureOff], false).map((s) => s.code)).toEqual(["AL"]);
  });
});
