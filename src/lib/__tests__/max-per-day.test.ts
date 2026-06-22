import { describe, it, expect } from "vitest";
import { dayCapViolations, type DayCapCell } from "../max-per-day";

// Caps: ORC/ICU = 1 per day, OR = unlimited (null).
const CAP: Record<string, number | null> = { orc: 1, icu: 1, or: null };
const maxPerDayOf = (id: string) => CAP[id];

const cell = (staffId: string, date: string, shiftTypeId: string): DayCapCell => ({ staffId, date, shiftTypeId });

const D = "2026-08-11";

describe("dayCapViolations", () => {
  it("allows the first capped shift of the day", () => {
    const v = dayCapViolations([cell("s1", D, "orc")], [], maxPerDayOf);
    expect(v).toEqual([]);
  });

  it("rejects a second ORC when one already exists that day", () => {
    const current = [cell("s1", D, "orc")];
    const v = dayCapViolations([cell("s2", D, "orc")], current, maxPerDayOf);
    expect(v).toEqual([cell("s2", D, "orc")]);
  });

  it("never caps an uncapped shift (maxPerDay null)", () => {
    const current = [cell("s1", D, "or"), cell("s2", D, "or")];
    const v = dayCapViolations([cell("s3", D, "or")], current, maxPerDayOf);
    expect(v).toEqual([]);
  });

  it("treats a proposed cell as REPLACING the existing cell at its key", () => {
    // s1 already has ORC; re-picking ORC for s1 is not a violation (it overwrites itself).
    const current = [cell("s1", D, "orc")];
    const v = dayCapViolations([cell("s1", D, "orc")], current, maxPerDayOf);
    expect(v).toEqual([]);
  });

  it("allows moving the day's only ORC from one staff to another", () => {
    // s1 has ORC; assign ORC to s2 AND clear/overwrite s1 in the same batch.
    const current = [cell("s1", D, "orc")];
    const proposed = [cell("s2", D, "orc"), cell("s1", D, "or")]; // s1 -> OR frees the cap
    const v = dayCapViolations(proposed, current, maxPerDayOf);
    expect(v).toEqual([]);
  });

  it("allows a move to an EMPTY same-day cell when the caller drops the freed source", () => {
    // Drag s1's only ORC onto empty s2 on the same date. The target is the only
    // proposed cell, so the caller must drop the vacated source from `current`.
    const current = [cell("s1", D, "orc")];
    const currentSansSource = current.filter((c) => !(c.staffId === "s1" && c.date === D));
    const v = dayCapViolations([cell("s2", D, "orc")], currentSansSource, maxPerDayOf);
    expect(v).toEqual([]);
  });

  it("still rejects a move onto a date that already has its only ORC elsewhere", () => {
    // Move s1's ORC (D) to empty s3 on d2 where s2 already holds ORC: over cap on d2.
    const d2 = "2026-08-12";
    const current = [cell("s1", D, "orc"), cell("s2", d2, "orc")];
    const currentSansSource = current.filter((c) => !(c.staffId === "s1" && c.date === D));
    const v = dayCapViolations([cell("s3", d2, "orc")], currentSansSource, maxPerDayOf);
    expect(v).toEqual([cell("s3", d2, "orc")]);
  });

  it("catches a duplicate within a single batch (paste of two ORC on one date)", () => {
    const proposed = [cell("s1", D, "orc"), cell("s2", D, "orc")];
    const v = dayCapViolations(proposed, [], maxPerDayOf);
    expect(v).toEqual([cell("s2", D, "orc")]); // first allowed, second rejected
  });

  it("caps each date independently", () => {
    const d2 = "2026-08-12";
    const current = [cell("s1", D, "orc")];
    const proposed = [cell("s2", D, "orc"), cell("s3", d2, "orc")];
    const v = dayCapViolations(proposed, current, maxPerDayOf);
    expect(v).toEqual([cell("s2", D, "orc")]); // d2's ORC is fine
  });

  it("caps dedicated-column shifts (ICU) the same way", () => {
    const current = [cell("s1", D, "icu")];
    const v = dayCapViolations([cell("s2", D, "icu")], current, maxPerDayOf);
    expect(v).toEqual([cell("s2", D, "icu")]);
  });

  it("ignores other shift types on the same date when counting a cap", () => {
    const current = [cell("s1", D, "or"), cell("s2", D, "or")];
    const v = dayCapViolations([cell("s3", D, "orc")], current, maxPerDayOf);
    expect(v).toEqual([]);
  });
});
