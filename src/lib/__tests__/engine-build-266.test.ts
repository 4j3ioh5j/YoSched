// Card #266: the worker bundle's build script, and the server start-up that installs the pool.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { readBundleStamp } from "../engine-pool";
import { installEnginePool } from "../engine-pool-install";
import vm from "node:vm";
import { setTrialBatchRunner, trialRun } from "../auto-scheduler";
import { fixture } from "./engine-266-fixture";

const ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(ROOT, "scripts/build-engine-worker.mjs");
let dir = "";
let n = 0;
/** A fresh, private folder for the browser bundle (never the checkout's public/). */
const web = () => { const d = path.join(dir, `web-${++n}`); fs.mkdirSync(d); return d; };
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-build-266-")); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); setTrialBatchRunner(null); });

describe("scripts/build-engine-worker.mjs", { timeout: 60_000 }, () => {
  it("writes a bundle stamped with this checkout's version and commit", () => {
    const out = path.join(dir, "w.cjs");
    const r = spawnSync(process.execPath, [SCRIPT, "--out", out, "--web-dir", web()], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string };
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    expect(readBundleStamp(out)).toEqual({ version: pkg.version, commit });
  });

  it("fails (non-zero, no file) when the entry does not build", () => {
    const out = path.join(dir, "bad.cjs");
    const r = spawnSync(process.execPath, [SCRIPT, "--out", out, "--web-dir", web(), "--entry", path.join(dir, "missing.ts")], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("refuses to stamp a bundle when the version or commit is unknown", () => {
    const out = path.join(dir, "nogit.cjs");
    const r = spawnSync(process.execPath, [SCRIPT, "--out", out, "--web-dir", web()], { cwd: ROOT, encoding: "utf8", env: { ...process.env, GIT_DIR: path.join(dir, "no-such-git") } });
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
    expect(spawnSync(process.execPath, [SCRIPT, "--out", out, "--web-dir", web()], { cwd: ROOT }).status).toBe(0);
    const stamp = readBundleStamp(out)!;
    setTrialBatchRunner(null);
    const logs: string[] = [];
    const pool = installEnginePool({ YOSCHED_ENGINE_WORKER: out, YOSCHED_ENGINE_WORKERS: "2" }, stamp, (m) => logs.push(m), 4);
    expect(pool).not.toBeNull();
    expect(setTrialBatchRunner(null)).toBeTypeOf("function");
    expect(logs).toContain("engine pool: 2 workers (stall 1000 ms)");
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

describe("the browser worker bundle (card #266 slice B)", { timeout: 60_000 }, () => {
  const commit = () => execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const version = () => (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }).version;

  it("is written as engine-worker-<commit>.js, replaces older ones, and leaves other files alone", () => {
    const w = web();
    fs.writeFileSync(path.join(w, "engine-worker-0000000.js"), "old");
    fs.writeFileSync(path.join(w, "engine-worker-notes.txt"), "keep");
    fs.writeFileSync(path.join(w, "logo.svg"), "keep");
    const r = spawnSync(process.execPath, [SCRIPT, "--out", path.join(dir, "x.cjs"), "--web-dir", w], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readdirSync(w).sort()).toEqual([`engine-worker-${commit()}.js`, "engine-worker-notes.txt", "logo.svg"]);
  });

  it("says hello with this release and runs a batch entry exactly as the engine does", async () => {
    const w = web();
    expect(spawnSync(process.execPath, [SCRIPT, "--out", path.join(dir, "y.cjs"), "--web-dir", w], { cwd: ROOT }).status).toBe(0);
    const code = fs.readFileSync(path.join(w, `engine-worker-${commit()}.js`), "utf8");
    const sent: unknown[] = [];
    const self: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null } = { postMessage: (m) => sent.push(structuredClone(m)), onmessage: null };
    vm.runInNewContext(code, { self, console });
    expect(sent[0]).toEqual({ type: "hello", version: version(), commit: commit() });
    const base = fixture(6);
    self.onmessage!({ data: structuredClone({ type: "stage", job: 1, base }) });
    self.onmessage!({ data: { type: "run", job: 1, idx: 0, variant: null } });
    const reply = sent[1] as { job: number; idx: number; run: { result: { suggestions: unknown } } };
    expect(reply.job).toBe(1);
    expect(JSON.stringify(reply.run.result.suggestions)).toBe(JSON.stringify(trialRun(base).result.suggestions));
  });

  it("a failed browser build fails the script and leaves the older bundle in place", () => {
    const w = web();
    fs.writeFileSync(path.join(w, "engine-worker-0000000.js"), "old");
    const out = path.join(dir, "z.cjs");
    const r = spawnSync(process.execPath, [SCRIPT, "--out", out, "--web-dir", w, "--web-entry", path.join(dir, "missing.ts")], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(fs.readdirSync(w)).toEqual(["engine-worker-0000000.js"]);
    expect(fs.existsSync(out)).toBe(false);
  });
});
