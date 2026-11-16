// Card #287: a pool whose workers answer slowly but steadily (each answer just inside the stall
// time) must not cost more than one stall per run over the plain loop. The pools measure what a run
// costs here and keep, per run, how far the pool's batches are behind the same runs done here; once
// that passes the stall time, the run takes over as after a stall.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TrialRun, type TrialRunState } from "../auto-scheduler";
import { createEnginePool, stampBanner, type EnginePool } from "../engine-pool";
import { behindMs, hereCost, runTimed, settleBatch } from "../trial-run-cost";
import { fixture } from "./engine-266-fixture";

const STAMP = { version: "9.9.9", commit: "abc1234" };
let dir = "";
const pools: EnginePool[] = [];
const logs: string[] = [];
function fakeWorker(name: string, body: string): string {
  const f = path.join(dir, name);
  fs.writeFileSync(f, `${stampBanner(STAMP)}\nconst { workerData } = require("node:worker_threads");\nconst port = workerData.port; const sig = new Int32Array(workerData.sig);\nconst reply = (m) => { port.postMessage(m); Atomics.add(sig, 0, 1); Atomics.notify(sig, 0); };\n${body}\n`);
  return f;
}
const newRun = (): TrialRunState => ({ stalled: false, inline: false });
const tagged = (run = newRun(), costMs = 0) => ({
  startedAt: performance.now(),
  run,
  runHere: (idx: number) => {
    const t = performance.now();
    while (performance.now() - t < costMs) { /* a run's cost */ }
    return { n: idx, by: "here" } as unknown as TrialRun;
  },
});
const variants = (k: number) => Array.from({ length: k }, (_, i) => ({ shiftTypeId: "s", minGapDays: i + 2, minGapStrength: "rule" as const }));
/** Answers every run after `ms`, one at a time: never silent for the stall time, just slow. */
const slowWorker = (name: string, ms: number) => fakeWorker(name, `const q = []; let busy = false;
const go = () => { if (busy || !q.length) return; busy = true; const m = q.shift();
  setTimeout(() => { reply({ job: m.job, idx: m.idx, run: { n: m.idx, by: "worker" } }); busy = false; go(); }, ${ms}); };
port.on("message", (m) => { if (m.type === "run") { q.push(m); go(); } });`);

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "yosched-pool-287-")); });
afterAll(async () => {
  for (const p of pools) await p.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("slow but steady workers cost one stall per run (card #287)", { timeout: 120_000 }, () => {
  it("the cost book: a run here is timed; behind = earlier batches + this batch − the same runs here", () => {
    const run = newRun();
    expect(hereCost(run)).toBeNull();
    expect(behindMs(run, 4, 500)).toBeNull(); // nothing known yet: only the plain stall applies
    runTimed(run, () => { const t = performance.now(); while (performance.now() - t < 20) { /* cost */ } return null as unknown as TrialRun; });
    const c = hereCost(run)!;
    expect(c).toBeGreaterThanOrEqual(19);
    expect(behindMs(run, 4, 500)).toBeCloseTo(500 - 4 * c, 5);
    settleBatch(run, 4, 500);
    expect(run.lostMs).toBeCloseTo(500 - 4 * c, 5);
    expect(behindMs(run, 2, 0)).toBeCloseTo(500 - 6 * c, 5);
    // A pool faster than here banks the time it saved.
    settleBatch(run, 100, 0);
    expect(run.lostMs!).toBeLessThan(0);
  });

  it("workers that each answer just inside the stall time: the run takes over after one stall's worth of lag", () => {
    logs.length = 0;
    const stallMs = 400;
    const p = createEnginePool({ bundlePath: slowWorker("slow.cjs", 320), workers: 2, stallMs, expect: STAMP, log: (m) => logs.push(m) })!;
    pools.push(p);
    const run = newRun();
    const t = performance.now();
    for (let i = 0; i < 5; i++) {
      const out = p.runBatch({ base: fixture(6), variants: variants(4) }, tagged(run, 5)) as unknown as { n: number }[];
      expect(out.map((r) => r.n)).toEqual([0, 1, 2, 3]);
    }
    // Before: every batch waited ~640 ms (two answers per worker, 320 ms apart), 3.2 s in all.
    expect(performance.now() - t).toBeLessThan(stallMs + 5 * 4 * 5 + 600);
    expect(run.stalled).toBe(true);
    expect(run.inline).toBe(false); // the workers did answer: not a failure, just slower than here
    expect(p.disabled).toBe(false);
    expect(logs.join("\n")).toMatch(/slower than/);
  });

  it("a pool that keeps up is never taken over: workers as fast as here, many batches", () => {
    const p = createEnginePool({ bundlePath: slowWorker("steady.cjs", 10), workers: 2, stallMs: 150, expect: STAMP, log: (m) => logs.push(m) })!;
    pools.push(p);
    const run = newRun();
    for (let i = 0; i < 30; i++) p.runBatch({ base: fixture(6), variants: variants(6) }, tagged(run, 10));
    expect(run.stalled).toBe(false);
    expect(run.hereRuns).toBeGreaterThan(0);
  });
});
