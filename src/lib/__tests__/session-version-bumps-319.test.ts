import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Card #319: every write that changes how a login proves who it is (password, two-factor)
// moves its session version, ending every session and trusted-device cookie issued before.
const SRC = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
const BUMP = /sessionVersion:\s*\{\s*increment:\s*1\s*\}/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (n === "__tests__" || n === "generated" || n === "node_modules") return [];
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("session version moves on every credential change (card #319)", () => {
  it.each([
    "app/api/auth/password/route.ts",
    "app/api/auth/totp/route.ts",
    "app/api/users/generate-password/route.ts",
    "app/api/users/reset-totp/route.ts",
    "app/api/users/reset/route.ts",
  ])("%s bumps it", (rel) => {
    expect(read(rel)).toMatch(BUMP);
  });

  it("users PUT bumps it when a password is set", () => {
    const src = read("app/api/users/route.ts");
    const put = src.slice(src.indexOf("if (password) {\n    const { valid, errors }"));
    expect(put.slice(0, 600)).toMatch(/data\.sessionVersion\s*=\s*\{\s*increment:\s*1\s*\}/);
  });

  it("no other file writes a password hash or two-factor state without bumping it", () => {
    // Creating a login (version starts at 0) and type-only files are not changes. `true` is
    // left out: in a select it's a read (the enrol write is in the list above).
    const CREATES = new Set(["app/api/users/route.ts", "lib/staff-login-backfill.ts", "lib/user-lifecycle.ts" /* parameter type only */, "app/api/settings/require-totp/route.ts" /* a count, read only */]);
    const WRITE = /(passwordHash\s*[:=]\s*(?!true\b)[^,}\n]+)|(totpEnabled:\s*false)|(totpSecret:\s*(null|encrypt))/;
    const offenders = walk(SRC)
      .map((f) => path.relative(SRC, f))
      .filter((rel) => !rel.endsWith(".tsx") && !CREATES.has(rel))
      .filter((rel) => { const s = read(rel); return WRITE.test(s.replace(/^\s*(export )?type .*$/gm, "")) && !BUMP.test(s) && /prisma\.|db\.|tx\./.test(s); });
    expect(offenders).toEqual([]);
  });
});
