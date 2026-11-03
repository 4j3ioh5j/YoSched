import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The app runs under basePath "/yosched". A raw <a href="/x"> is NOT prefixed by Next,
// so it lands on yologiq.com/x (404). In-app links must use next/link's <Link>, which
// adds basePath. (fetch("/api/...") is covered separately by base-path-fetch.ts.)
const SRC = join(__dirname, "..", "..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "generated" ? [] : tsxFiles(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

// An <a ...> opening tag (possibly multi-line) whose href is a root-relative path.
const RAW_ROOT_ANCHOR = /<a\b[^>]*?\bhref\s*=\s*(?:"\/(?!\/)|'\/(?!\/)|\{\s*["'`]\/(?!\/))/g;

describe("in-app links respect basePath", () => {
  it("no raw <a href=\"/...\"> in src (use next/link <Link>)", () => {
    const offenders: string[] = [];
    for (const f of tsxFiles(SRC)) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(RAW_ROOT_ANCHOR)) {
        const line = text.slice(0, m.index).split("\n").length;
        offenders.push(`${f.slice(SRC.length + 1)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the pattern catches the regression it guards against", () => {
    const bad = `<a\n  href="/users"\n  className="x"\n>`;
    expect(bad.match(RAW_ROOT_ANCHOR)).not.toBeNull();
    expect(`<Link href="/users">`.match(RAW_ROOT_ANCHOR)).toBeNull();
    expect(`<a href="https://yologiq.com/x">`.match(RAW_ROOT_ANCHOR)).toBeNull();
    expect(`<a href="//cdn.example/x">`.match(RAW_ROOT_ANCHOR)).toBeNull();
  });
});
