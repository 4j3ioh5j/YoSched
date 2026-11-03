import { describe, it, expect } from "vitest";
import { randomInt } from "node:crypto";
import { generatePassword, UPPER, LOWER, DIGITS, GENERATED_PASSWORD_LENGTH } from "../generate-password";
import { validatePassword } from "../password";

const ALPHABET = new Set(UPPER + LOWER + DIGITS);

describe("generatePassword", () => {
  it("is 16 chars, passes the password rules, uses only the unambiguous alphabet (1000 runs)", () => {
    for (let i = 0; i < 1000; i++) {
      const p = generatePassword(randomInt);
      expect(p).toHaveLength(GENERATED_PASSWORD_LENGTH);
      expect(validatePassword(p).valid).toBe(true);
      for (const c of p) expect(ALPHABET.has(c)).toBe(true);
      expect(p).not.toMatch(/[0O1lIo]/);
    }
  });
  it("guarantees every class even with a degenerate source (always 0)", () => {
    const p = generatePassword(() => 0);
    expect(validatePassword(p).valid).toBe(true);
  });
  it("is not repetitive across calls", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePassword(randomInt)));
    expect(seen.size).toBe(200);
  });
  it("fails closed on a broken random source or bad length", () => {
    expect(() => generatePassword(() => 999)).toThrow();
    expect(() => generatePassword(() => -1)).toThrow();
    expect(() => generatePassword(() => NaN)).toThrow();
    expect(() => generatePassword(randomInt, 4)).toThrow();
  });
});
