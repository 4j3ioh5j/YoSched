import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { decimalFieldChars } from "@/lib/decimal-input";

// Card #361: every number box takes any reasonable value by typing: no browser
// up/down arrows (type="number"), and wide enough for the largest allowed value.
const root = path.resolve(__dirname, "../..");
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" || n === "node_modules" ? [] : tsxFiles(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

describe("number boxes (card #361)", () => {
  it("no input in the app is a browser number box", () => {
    const offenders = tsxFiles(root).flatMap((f) =>
      readFileSync(f, "utf8").split("\n").flatMap((l, i) => (/type=["{]+number/.test(l) && !l.trim().startsWith("//") ? [`${path.relative(root, f)}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
  it("width fits the largest allowed value, its decimals and a minus sign", () => {
    expect(decimalFieldChars({ integer: true, max: 99 })).toBe(2);
    expect(decimalFieldChars({ integer: true, max: 365 })).toBe(3);
    expect(decimalFieldChars({ integer: true, max: 65535 })).toBe(5);
    expect(decimalFieldChars({ max: 9.999, decimals: 3 })).toBe(5);
    expect(decimalFieldChars({ max: 999, decimals: 2 })).toBe(6);
    expect(decimalFieldChars({ integer: true, min: -30, max: 30, allowNegative: true })).toBe(3);
    // no upper bound: room for four digits (and the decimals)
    expect(decimalFieldChars({ integer: true })).toBe(4);
    expect(decimalFieldChars({ decimals: 2 })).toBe(7);
  });
  it("DecimalField sets that width as a minimum, so a narrow class cannot clip the value", () => {
    const src = readFileSync(path.join(root, "components/decimal-field.tsx"), "utf8");
    expect(src).toMatch(/minWidth: `calc\(\$\{decimalFieldChars\(opts\)\}ch \+ 1\.25rem\)`/);
  });
});
