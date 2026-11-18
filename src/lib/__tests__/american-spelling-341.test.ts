import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Card #341: text people read uses American spelling. Scans string literals and JSX text in src
// (not comments, not tests) for British forms. "cancelled" is allowed only as an internal value
// ("cancelled" as a quoted result kind), which nobody reads.
const BRITISH = /\b(honour|honoured|colour|colours|behaviour|favour|favoured|organis\w*|prioritis\w*|normalis\w*|licence|centre|enrol)\b/i;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__" && name !== "generated") files(p, out); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("card #341: American spelling in on-screen text", () => {
  it("no British spelling in a string or JSX text line", () => {
    const hits: string[] = [];
    for (const f of files(join(__dirname, "..", ".."))) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        const code = line.replace(/\/\/.*$/, ""); // trailing comment
        if (!/["'`>]/.test(code)) return;
        if (BRITISH.test(code)) hits.push(`${f}:${i + 1}: ${t.slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
