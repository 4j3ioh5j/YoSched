import { describe, it, expect } from "vitest";
import { gapBreaks, gapList, gapListShrank, gapTrialBeats } from "../shift-gap";

// Card #260: "at least N days between two of the same shift for one person". Consecutive days
// form one block; the gap runs from the last day of one block to the first day of the next.

const has = (days: string[]) => (d: string) => days.includes(d);
const may = (n: number) => `2025-05-${String(n).padStart(2, "0")}`;

describe("blocks and gaps (card #260)", () => {
  it("consecutive days are one block, so 10/11/12 has no gap at all", () => {
    expect([...gapBreaks(has([may(10), may(11), may(12)]), may(1), may(31), 5)]).toEqual([]);
  });

  it("taking the middle day out of 10/11/12 splits it into two blocks 2 days apart", () => {
    expect([...gapBreaks(has([may(10), may(12)]), may(1), may(31), 5)]).toEqual([`${may(10)}|${may(12)}`]);
  });

  it("measures block to block: Sat–Sun then the next Saturday is 6 days, under 7", () => {
    // 2025-05-10 is a Saturday.
    const days = [may(10), may(11), may(17), may(18)];
    expect([...gapBreaks(has(days), may(1), may(31), 7)]).toEqual([`${may(11)}|${may(17)}`]);
    expect([...gapBreaks(has(days), may(1), may(31), 6)]).toEqual([]);
  });

  it("a Friday plus a Sat–Sun group is one block 3 days long, not a 1-day gap", () => {
    expect([...gapBreaks(has([may(9), may(10), may(11)]), may(1), may(31), 5)]).toEqual([]);
  });

  it("finds a block's real edges outside the window it is asked about", () => {
    // Block 8..12, asked about 12 only: the next block at 15 is 3 days after the 12th.
    const days = [may(8), may(9), may(10), may(11), may(12), may(15)];
    expect([...gapBreaks(has(days), may(12), may(12), 5)]).toEqual([`${may(12)}|${may(15)}`]);
  });

  it("only reports pairs that touch the window ± N", () => {
    const days = [may(1), may(3), may(25), may(27)];
    expect([...gapBreaks(has(days), may(20), may(31), 5)]).toEqual([`${may(25)}|${may(27)}`]);
  });

  it("lists the gaps in the window, smallest first", () => {
    expect(gapList(has([may(2), may(4), may(14)]), may(1), may(31))).toEqual([2, 10]);
  });

  it("per day (the spread swap's reading), two in a row are 1 apart, not one stretch", () => {
    expect(gapList(has([may(2), may(3), may(14)]), may(1), may(31))).toEqual([11]);
    expect(gapList(has([may(2), may(3), may(14)]), may(1), may(31), true)).toEqual([1, 11]);
  });
});

describe("a swap never shrinks a close gap (card #260, Codex #1190/#1195)", () => {
  it("2,10 → 2,5 is refused (the 10-day gap shrinks) whatever the other person gains", () => {
    expect(gapListShrank([2, 10], [2, 5], 14)).toBe(true);
  });
  it("2,10 → 3,9 is refused when both gaps are close (each gap is compared on its own)", () => {
    expect(gapListShrank([2, 10], [3, 9], 14)).toBe(true);
  });
  it("a gap may shrink while it stays at or above the minimum: 2,12 → 3,11 with N=5", () => {
    expect(gapListShrank([2, 12], [3, 11], 5)).toBe(false);
  });
  it("a new close gap is refused", () => {
    expect(gapListShrank([10], [3, 10], 5)).toBe(true);
  });
  it("widening is allowed", () => {
    expect(gapListShrank([2], [3], 5)).toBe(false);
    expect(gapListShrank([2, 10], [2, 11], 14)).toBe(false);
  });
});

describe("the minimum-gap trial keeps a result only when it costs nothing (card #260)", () => {
  const base = { covered: 10, broken: 0, most: 2, over: 0, short: 8, close: 2 };
  it("fewer too-close pairs and no worse elsewhere: kept", () => {
    expect(gapTrialBeats({ ...base, close: 1 }, base)).toBe(true);
    expect(gapTrialBeats({ ...base, close: 1, short: 4, over: 0 }, base)).toBe(true);
  });
  it("no fewer too-close pairs: not kept", () => {
    expect(gapTrialBeats(base, base)).toBe(false);
    expect(gapTrialBeats({ ...base, close: 3 }, base)).toBe(false);
  });
  it.each([
    ["a day less covered", { covered: 9 }],
    ["a lone ORL more", { broken: 1 }],
    ["someone holding more than anyone did", { most: 3 }],
    ["one more person over target", { over: 1 }],
    ["4 h more short", { short: 12 }],
  ])("better spaced but %s: not kept", (_why, worse) => {
    expect(gapTrialBeats({ ...base, close: 0, ...worse }, base)).toBe(false);
  });
});
