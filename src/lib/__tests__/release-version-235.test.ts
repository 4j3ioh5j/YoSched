import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Card #235: every release raises the version. deploy.sh runs this check (exactly like
// this: `node scripts/check-release-version.mjs <head sha> <released sha> <head version>
// <released version>`) before it pushes, and stops the release unless it passes.
const SCRIPT = join(__dirname, "..", "..", "..", "scripts", "check-release-version.mjs");
const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

describe("check-release-version", () => {
  it("passes a higher version", () => {
    expect(run("bbbbbbb", "aaaaaaa", "0.2.0", "0.1.0").status).toBe(0);
    expect(run("bbbbbbb", "aaaaaaa", "0.10.0", "0.9.0").status).toBe(0); // numeric, not text order
    expect(run("bbbbbbb", "aaaaaaa", "1.0.0", "0.9.9").status).toBe(0);
  });

  it("refuses the same version on a new commit, and says what to do", () => {
    const r = run("bbbbbbb", "aaaaaaa", "0.2.0", "0.2.0");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/0\.2\.0/);
    expect(r.stderr).toMatch(/0\.3\.0/); // suggests the next minor
  });

  it("refuses a lower version", () => {
    expect(run("bbbbbbb", "aaaaaaa", "0.1.0", "0.2.0").status).toBe(1);
    expect(run("bbbbbbb", "aaaaaaa", "0.9.0", "0.10.0").status).toBe(1);
  });

  it("allows re-deploying the commit that is already released", () => {
    expect(run("aaaaaaa", "aaaaaaa", "0.2.0", "0.2.0").status).toBe(0);
  });

  it("fails closed on missing or malformed input", () => {
    expect(run().status).toBe(2);
    expect(run("bbbbbbb", "aaaaaaa", "0.2.0").status).toBe(2);
    expect(run("bbbbbbb", "aaaaaaa", "0.2", "0.1.0").status).toBe(2);
    expect(run("bbbbbbb", "aaaaaaa", "0.2.0", "").status).toBe(2);
    expect(run("", "aaaaaaa", "0.2.0", "0.1.0").status).toBe(2);
  });
});
