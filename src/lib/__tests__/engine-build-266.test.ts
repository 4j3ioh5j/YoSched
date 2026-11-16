// Card #266: the worker bundle's build script, and the server start-up that installs the pool.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { readBundleStamp } from "../engine-pool";
import { installEnginePool } from "../engine-pool-install";
import { setTrialBatchRunner } from "../auto-scheduler";

const ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(ROOT, "scripts/build-engine-worker.mjs");
let dir = "";
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-build-266-")); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); setTrialBatchRunner(null); });

describe("scripts/build-engine-worker.mjs", { timeout: 60_000 }, () => {
  it("writes a bundle stamped with this checkout's version and commit", () => {
    const out = path.join(dir, "w.cjs");
    const r = spawnSync(process.execPath, [SCRIPT, "--out", out], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string };
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    expect(readBundleStamp(out)).toEqual({ version: pkg.version, commit });
  });

  it("fails (non-zero, no file) when the entry does not build", () => {
    const out = path.join(dir, "bad.cjs");
    const r = spawnSync(process.execPath, [SCRIPT, "--out", out, "--entry", path.join(dir, "missing.ts")], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("refuses to stamp a bundle when the version or commit is unknown", () => {
    const out = path.join(dir, "nogit.cjs");
    const r = spawnSync(process.execPath, [SCRIPT, "--out", out], { cwd: ROOT, encoding: "utf8", env: { ...process.env, GIT_DIR: path.join(dir, "no-such-git") } });
    expect(r.status).not.toBe(0);
    expect(fs.existsSync(out)).toBe(false);
  });
});

describe("installEnginePool", { timeout: 60_000 }, () => {
  it("installs no runner when the pool cannot be built (no bundle)", () => {
    setTrialBatchRunner(null);
    const logs: string[] = [];
    const pool = installEnginePool({ YOSCHED_ENGINE_WORKER: path.join(dir, "none.cjs"), YOSCHED_ENGINE_WORKERS: "2" }, { version: "1.0.0", commit: "abc" }, (m) => logs.push(m), 4);
    expect(pool).toBeNull();
    expect(setTrialBatchRunner(null)).toBeNull();
    expect(logs.join("\n")).toMatch(/engine pool off: the worker bundle is missing/);
  });

  it("installs the pool's runner when the bundle matches this release", async () => {
    const out = path.join(dir, "ok.cjs");
    expect(spawnSync(process.execPath, [SCRIPT, "--out", out], { cwd: ROOT }).status).toBe(0);
    const stamp = readBundleStamp(out)!;
    setTrialBatchRunner(null);
    const logs: string[] = [];
    const pool = installEnginePool({ YOSCHED_ENGINE_WORKER: out, YOSCHED_ENGINE_WORKERS: "2" }, stamp, (m) => logs.push(m), 4);
    expect(pool).not.toBeNull();
    expect(setTrialBatchRunner(null)).toBeTypeOf("function");
    expect(logs).toContain("engine pool: 2 workers");
    await pool!.close();
  });

  it("installs no runner when this server's version is unknown", () => {
    const out = path.join(dir, "ok.cjs");
    setTrialBatchRunner(null);
    const pool = installEnginePool({ YOSCHED_ENGINE_WORKER: out }, { version: "", commit: "" }, () => undefined, 4);
    expect(pool).toBeNull();
    expect(setTrialBatchRunner(null)).toBeNull();
  });
});
