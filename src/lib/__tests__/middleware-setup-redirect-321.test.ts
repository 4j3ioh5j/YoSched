import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Card #321: the middleware only sees the sign-in token. Its two-factor-setup flag goes stale
// when an admin turns the requirement off, so the middleware must not redirect on it; the page
// guard (getPageSession, which reads the database) decides instead.
const SRC = path.join(__dirname, "../..");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return pages(p);
    return n === "page.tsx" ? [p] : [];
  });
}

describe("two-factor setup redirect lives in the page guard (card #321)", () => {
  it("the middleware does not read the token's setup flag", () => {
    const src = readFileSync(path.join(SRC, "middleware.ts"), "utf8");
    expect(src).not.toContain("mustSetUpTotp");
    expect(src).not.toContain("SETUP_2FA_QUERY");
  });

  it("every signed-in page runs the database-backed guard", () => {
    const PUBLIC = new Set(["login", "privacy", "setup/restore"]);
    const app = path.join(SRC, "app");
    const missing = pages(app)
      .map((p) => ({ p, rel: path.relative(app, path.dirname(p)) }))
      .filter(({ rel }) => !PUBLIC.has(rel))
      .filter(({ p }) => !/getPageSession\(|getSession\(/.test(readFileSync(p, "utf8")))
      .map(({ rel }) => rel || "/");
    expect(missing).toEqual([]);
  });
});
