import { describe, it, expect } from "vitest";
import { parseDecimalInput, formatDecimal, draftAfterExternal } from "../decimal-input";

// Card #307: every number field takes any ordinary way of writing a decimal
// (0.2, 0.20, .4, 00.45, 5, 5.) and shows the stored value back without rounding it away.

describe("parseDecimalInput (card #307)", () => {
  it("accepts every ordinary decimal form", () => {
    const cases: [string, number][] = [
      ["0.2", 0.2], ["0.20", 0.2], [".4", 0.4], ["00.45", 0.45], ["5", 5], ["5.", 5],
      ["  0.75 ", 0.75], ["1", 1], ["012", 12], ["0", 0], ["0.000", 0],
    ];
    for (const [s, v] of cases) expect(parseDecimalInput(s), s).toEqual({ ok: true, value: v });
  });

  it("blank is null (no value), not zero", () => {
    expect(parseDecimalInput("")).toEqual({ ok: true, value: null });
    expect(parseDecimalInput("   ")).toEqual({ ok: true, value: null });
  });

  it("a blank is refused when the field needs a value", () => {
    expect(parseDecimalInput("", { required: true }).ok).toBe(false);
  });

  it("rejects text that is not a plain decimal", () => {
    for (const bad of [".", "abc", "1.2.3", "1e3", "0x10", "1,5", "--1", "1-", "Infinity", "NaN", "+"]) {
      expect(parseDecimalInput(bad).ok, bad).toBe(false);
    }
  });

  it("negatives only where the field allows them", () => {
    expect(parseDecimalInput("-0.5").ok).toBe(false);
    expect(parseDecimalInput("-0.5", { allowNegative: true })).toEqual({ ok: true, value: -0.5 });
    expect(parseDecimalInput("-.5", { allowNegative: true })).toEqual({ ok: true, value: -0.5 });
  });

  it("whole-number fields refuse a fraction but take 5. and 05", () => {
    expect(parseDecimalInput("2.5", { integer: true }).ok).toBe(false);
    expect(parseDecimalInput("5.", { integer: true })).toEqual({ ok: true, value: 5 });
    expect(parseDecimalInput("05", { integer: true })).toEqual({ ok: true, value: 5 });
    expect(parseDecimalInput("5.0", { integer: true })).toEqual({ ok: true, value: 5 });
  });

  it("checks min and max, inclusive", () => {
    expect(parseDecimalInput("0.2", { min: 0, max: 9.999 })).toEqual({ ok: true, value: 0.2 });
    expect(parseDecimalInput("9.999", { max: 9.999 }).ok).toBe(true);
    expect(parseDecimalInput("10", { max: 9.999 }).ok).toBe(false);
    expect(parseDecimalInput("0.1", { min: 0.25 }).ok).toBe(false);
  });

  it("rounds to the field's decimals and checks the bounds after rounding", () => {
    expect(parseDecimalInput("0.12345", { decimals: 3 })).toEqual({ ok: true, value: 0.123 });
    expect(parseDecimalInput("0.1235", { decimals: 3 })).toEqual({ ok: true, value: 0.124 });
    expect(parseDecimalInput("1.005", { decimals: 2 })).toEqual({ ok: true, value: 1.01 });
  });

  it("tiny and long inputs round to a real number, never NaN (Codex r1 warning)", () => {
    expect(parseDecimalInput("0.0000001", { decimals: 3 })).toEqual({ ok: true, value: 0 });
    expect(parseDecimalInput("0.0000006", { decimals: 6 })).toEqual({ ok: true, value: 0.000001 });
    expect(parseDecimalInput("123456789012345678901234567890", { decimals: 2 })).toEqual({ ok: true, value: 1.2345678901234568e29 });
    for (const s of ["0.0000001", "00000.00000000001", "9".repeat(400) + ".5"]) {
      const r = parseDecimalInput(s, { decimals: 2 });
      if (r.ok) expect(Number.isFinite(r.value as number), s).toBe(true);
    }
    expect(parseDecimalInput("9".repeat(400)).ok).toBe(false);
  });

  it("a refusal says why in plain words", () => {
    const r = parseDecimalInput("10", { max: 9.999 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/9\.999/);
    const r2 = parseDecimalInput("abc");
    if (!r2.ok) expect(r2.error).toMatch(/number/i);
  });
});

describe("formatDecimal (card #307)", () => {
  it("shows the value exactly, no rounding to whole numbers, no trailing zeros", () => {
    expect(formatDecimal(0.2)).toBe("0.2");
    expect(formatDecimal(0.45)).toBe("0.45");
    expect(formatDecimal(1)).toBe("1");
    expect(formatDecimal(0)).toBe("0");
    expect(formatDecimal(null)).toBe("");
    expect(formatDecimal(0.1 + 0.2)).toBe("0.3");
    expect(formatDecimal(12.5)).toBe("12.5");
  });

  it("fixed decimals when the field asks for them", () => {
    expect(formatDecimal(1, { minDecimals: 1 })).toBe("1.0");
    expect(formatDecimal(0.875, { minDecimals: 1 })).toBe("0.875");
  });
});

describe("draftAfterExternal: the typed text survives until the value really changes (card #307)", () => {
  it("keeps the draft while the stored value has not changed", () => {
    expect(draftAfterExternal("0.", 0, 0)).toBe("0.");
    expect(draftAfterExternal(".", null, null)).toBe(".");
    expect(draftAfterExternal("1.2.", 1.2, 1.2)).toBe("1.2."); // invalid: kept so it can be fixed
  });

  it("keeps a draft that is what the new value was committed from", () => {
    expect(draftAfterExternal("00.45", 0.2, 0.45)).toBe("00.45");
    expect(draftAfterExternal("0.20", null, 0.2)).toBe("0.20");
    expect(draftAfterExternal("", 3, null)).toBe("");
  });

  it("replaces the draft when the value changed from elsewhere (reset, reload, undo)", () => {
    expect(draftAfterExternal("0.2", 0.2, 0.5)).toBe("0.5");
    expect(draftAfterExternal("0.2", 0.2, null)).toBe("");
    expect(draftAfterExternal("", null, 3)).toBe("3");
    expect(draftAfterExternal("1.2.", 1.2, 4)).toBe("4");
  });
});
