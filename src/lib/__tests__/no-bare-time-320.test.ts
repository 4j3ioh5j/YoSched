// Card #320: every time YoSched shows goes through src/lib/time-zone.ts (Settings zone + label).
// A raw clock read in app or lib code is how a time ends up in the server's or the browser's
// zone with no label, so it fails here unless it is on the allowlist with a reason.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["app", "lib"].map((d) => path.join(ROOT, d));
const SKIP_DIRS = new Set(["__tests__", "generated", "node_modules"]);

const FORBIDDEN: [RegExp, string][] = [
  [/\.getHours\(/, "getHours"],
  [/\.getMinutes\(/, "getMinutes"],
  [/\.getUTCHours\(/, "getUTCHours"],
  [/\.getUTCMinutes\(/, "getUTCMinutes"],
  [/toLocaleTimeString/, "toLocaleTimeString"],
  [/\bhour\s*:/, "an Intl/toLocaleString option with hour"],
];

/** file (relative to src) → why its raw clock reads are fine. */
const ALLOW: Record<string, string> = {
  "lib/time-zone.ts": "the one place that turns an instant into a zoned wall clock",
  "lib/backup/auto.ts": "automatic backup file names are machine names and say UTC",
  "lib/backup/reminder.ts": "downloaded backup file names are machine names and say UTC",
};

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) out.push(...files(p)); continue; }
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("no bare time display (card #320)", () => {
  const all = DIRS.flatMap(files);
  it("finds the source files", () => {
    expect(all.length).toBeGreaterThan(100);
    expect(all.some((f) => f.endsWith(path.join("lib", "time-zone.ts")))).toBe(true);
  });
  it("every raw clock read is on the allowlist", () => {
    const bad: string[] = [];
    for (const f of all) {
      const rel = path.relative(ROOT, f).split(path.sep).join("/");
      if (ALLOW[rel]) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return; // comments
        for (const [re, what] of FORBIDDEN) if (re.test(line)) bad.push(`${rel}:${i + 1} ${what}`);
      });
    }
    expect(bad).toEqual([]);
  });
  it("the allowlist names real files (no stale entries)", () => {
    for (const rel of Object.keys(ALLOW)) expect(statSync(path.join(ROOT, rel)).isFile()).toBe(true);
  });
  it("the guard catches a bare time", () => {
    const sample = "const t = `${d.getHours()}:${d.getMinutes()}`; x.toLocaleTimeString(); y.toLocaleString(undefined, { hour: '2-digit' });";
    expect(FORBIDDEN.filter(([re]) => re.test(sample)).map(([, w]) => w)).toEqual(["getHours", "getMinutes", "toLocaleTimeString", "an Intl/toLocaleString option with hour"]);
  });
});
