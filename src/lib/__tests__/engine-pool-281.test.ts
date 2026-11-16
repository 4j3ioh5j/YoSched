// Card #281: a broken worker pool must never cost more than a short stall. The server's main thread
// helps the pool (it runs the runs nobody holds) and, when the workers give no answer for the stall
// time, runs the lowest unanswered run itself. A batch where no worker answered sends the rest of
// that run inline; two such batches in a row turn the pool off. There is no batch time limit and
// no trial deadline any more.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import {
  autoSchedule, setTrialBatchRunner, trialRun, trialInput,
  type TrialBatch, type TrialRun, type TrialRunState,
} from "../auto-scheduler";
import { createEnginePool, stampBanner, poolOptionsFromEnv, poolRunner, type EnginePool } from "../engine-pool";
import { installEnginePool } from "../engine-pool-install";
import { fixture } from "./engine-266-fixture";

const STAMP = { version: "9.9.9", commit: "abc1234" };
let dir = "";
let bundle = "";
const pools: EnginePool[] = [];
const logs: string[] = [];
function pool(o: Partial<Parameters<typeof createEnginePool>[0]> = {}): EnginePool {
  const p = createEnginePool({ bundlePath: bundle, workers: 2, stallMs: 300, expect: STAMP, log: (m) => logs.push(m), ...o });
  if (!p) throw new Error("pool not built");
  pools.push(p);
  return p;
}
function fakeWorker(name: string, body: string): string {
  const f = path.join(dir, name);
  fs.writeFileSync(f, `${stampBanner(STAMP)}\nconst { workerData } = require("node:worker_threads");\nconst port = workerData.port; const sig = new Int32Array(workerData.sig);\nconst reply = (m) => { port.postMessage(m); Atomics.add(sig, 0, 1); Atomics.notify(sig, 0); };\n${body}\n`);
  return f;
}
const newRun = (): TrialRunState => ({ stalled: false, inline: false });
/** A ctx whose here-runs are tagged, so a test can tell who ran what. */
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
const sig = (r: ReturnType<typeof autoSchedule>) => JSON.stringify([r.suggestions, r.warnings, r.quality]);

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "yosched-pool-281-"));
  bundle = path.join(dir, "engine-worker.cjs");
  await build({
    entryPoints: [path.resolve(__dirname, "../engine-worker-entry.ts")],
    bundle: true, platform: "node", format: "cjs", target: "node22", outfile: bundle, logLevel: "silent",
    banner: { js: stampBanner(STAMP) },
  });
}, 60_000);
afterAll(async () => {
  setTrialBatchRunner(null);
  for (const p of pools) await p.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the main thread helps and takes over (card #281)", { timeout: 120_000 }, () => {
  it("with every worker hung, the result is the plain one, within inline time + one stall + a margin", () => {
    const input = fixture();
    let t = performance.now();
    const plain = sig(autoSchedule(input));
    const inlineMs = performance.now() - t;
    const p = pool({ bundlePath: fakeWorker("hang.cjs", `port.on("message", () => {});`), stallMs: 300 });
    setTrialBatchRunner(poolRunner(p));
    try {
      t = performance.now();
      const stats = { pooled: 0, inline: 0 };
      expect(sig(autoSchedule(input, { trialStats: stats }))).toBe(plain);
      const ms = performance.now() - t;
      expect(ms).toBeLessThan(inlineMs * 1.5 + 300 + 1_000);
      expect(stats.pooled).toBe(1); // the batch that stalled, finished here
    } finally { setTrialBatchRunner(null); }
    expect(logs.join("\n")).toMatch(/no answer/);
  });

  it("with the real bundle, the result is the plain one and the workers did some of the runs", () => {
    const input = fixture();
    const plain = sig(autoSchedule(input));
    const p = pool({ stallMs: 5_000 });
    let worker = 0;
    setTrialBatchRunner((b, ctx) => {
      const r = p.runBatch(b, { ...ctx, runHere: (i) => { worker--; return ctx.runHere(i); } });
      worker += r ? r.length : 0;
      return r;
    });
    try { expect(sig(autoSchedule(input))).toBe(plain); } finally { setTrialBatchRunner(null); }
    expect(worker).toBeGreaterThan(0);
    expect(p.disabled).toBe(false);
  });

  it("takes what the workers answer and runs the rest here (partial answers)", () => {
    const f = fakeWorker("half.cjs", `port.on("message", (m) => {
      if (m.type === "run" && m.idx % 2 === 0) reply({ job: m.job, idx: m.idx, run: { n: m.idx, by: "worker" } });
    });`);
    const p = pool({ bundlePath: f, workers: 2, stallMs: 200 });
    const ctx = tagged();
    const out = p.runBatch({ base: fixture(6), variants: variants(9) }, ctx) as unknown as { n: number; by: string }[];
    expect(out.map((r) => r.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.some((r) => r.by === "worker")).toBe(true);
    expect(out.filter((r) => r.n % 2 === 1).every((r) => r.by === "here")).toBe(true);
    expect(ctx.run.inline).toBe(false);
    expect(p.disabled).toBe(false);
  });

  it("ignores a late answer for a run it already took over, in this batch and the next", () => {
    // idx 1 answers at once; idx 0 answers 700 ms late (after the steal), tagged "late".
    const f = fakeWorker("late.cjs", `port.on("message", (m) => {
      if (m.type !== "run") return;
      const d = m.idx === 0 ? 700 : 0;
      setTimeout(() => reply({ job: m.job, idx: m.idx, run: { n: m.idx, by: d ? "late" : "worker" } }), d);
    });`);
    const p = pool({ bundlePath: f, workers: 1, stallMs: 150 });
    const run: TrialRunState = { ...newRun(), hereMs: 0, hereRuns: 1 }; // cost known: the worker gets both runs
    const t = performance.now();
    const out = p.runBatch({ base: fixture(6), variants: variants(2) }, tagged(run)) as unknown as { n: number; by: string }[];
    expect(performance.now() - t).toBeLessThan(650);
    expect(out).toEqual([{ n: 0, by: "here" }, { n: 1, by: "worker" }]);
    const t2 = performance.now();
    while (performance.now() - t2 < 800) { /* let the late answer arrive */ }
    const out2 = p.runBatch({ base: fixture(6), variants: variants(2) }, tagged(run)) as unknown as { n: number; by: string }[];
    expect(out2.map((r) => r.n)).toEqual([0, 1]);
    expect(out2.every((r) => r.by !== "late")).toBe(true);
  });

  it("a batch where no worker answered sends the rest of that run inline; two in a row turn the pool off", () => {
    logs.length = 0;
    const p = pool({ bundlePath: fakeWorker("hang2.cjs", `port.on("message", () => {});`), stallMs: 100 });
    const r1 = newRun();
    const out = p.runBatch({ base: fixture(6), variants: variants(3) }, tagged(r1)) as unknown as { n: number }[];
    expect(out.map((r) => r.n)).toEqual([0, 1, 2]); // the completed results come back: no second replay
    expect(r1.inline).toBe(true);
    expect(p.disabled).toBe(false);
    const r2 = newRun();
    expect(p.runBatch({ base: fixture(6), variants: variants(3) }, tagged(r2))).not.toBeNull();
    expect(r2.inline).toBe(true);
    expect(p.disabled).toBe(true);
    expect(p.runBatch({ base: fixture(6), variants: variants(3) }, tagged(newRun()))).toBeNull();
    expect(logs.join("\n")).toMatch(/off for this process/);
  });

  it("a run whose rest is inline never asks the runner again", () => {
    const input = fixture();
    const plain = sig(autoSchedule(input));
    let calls = 0;
    setTrialBatchRunner((_b, ctx) => { calls++; ctx.run.inline = true; return null; });
    try {
      const stats = { pooled: 0, inline: 0 };
      expect(sig(autoSchedule(input, { trialStats: stats }))).toBe(plain);
      expect(calls).toBe(1);
      expect(stats.inline).toBeGreaterThan(2);
    } finally { setTrialBatchRunner(null); }
  });

  it("partial progress in every batch costs one stall per run, not one per batch", () => {
    // Each worker answers the first run it gets in a batch, then hangs on the rest of that batch.
    const f = fakeWorker("first.cjs", `let seen = -1; port.on("message", (m) => {
      if (m.type !== "run" || m.job === seen) return;
      seen = m.job;
      reply({ job: m.job, idx: m.idx, run: { n: m.idx, by: "worker" } });
    });`);
    const p = pool({ bundlePath: f, workers: 2, stallMs: 400 });
    const run = newRun();
    const t = performance.now();
    for (let i = 0; i < 6; i++) {
      const out = p.runBatch({ base: fixture(6), variants: variants(6) }, tagged(run, 5)) as unknown as { n: number }[];
      expect(out.map((r) => r.n)).toEqual([0, 1, 2, 3, 4, 5]);
    }
    expect(performance.now() - t).toBeLessThan(400 + 6 * 6 * 5 + 600);
    expect(run.stalled).toBe(true);
    expect(run.inline).toBe(false);
  });

  it("a worker that reports an error is set aside; the batch still finishes with every run", () => {
    logs.length = 0;
    const f = fakeWorker("boom.cjs", `port.on("message", (m) => { if (m.type === "run") reply({ job: m.job, idx: m.idx, error: "boom" }); });`);
    const p = pool({ bundlePath: f, stallMs: 5_000 });
    const t = performance.now();
    const out = p.runBatch({ base: fixture(6), variants: variants(4) }, tagged()) as unknown as { n: number }[];
    expect(out.map((r) => r.n)).toEqual([0, 1, 2, 3]);
    expect(performance.now() - t).toBeLessThan(2_000); // no stall wait: nothing is left with a worker
    expect(logs.join("\n")).toMatch(/boom/);
  });

  it("a worker that dies costs one stall, not a time limit", () => {
    const f = fakeWorker("die.cjs", `port.on("message", (m) => { if (m.type === "run") process.exit(3); });`);
    const p = pool({ bundlePath: f, stallMs: 250 });
    const t = performance.now();
    const out = p.runBatch({ base: fixture(6), variants: variants(2) }, tagged()) as unknown as { n: number }[];
    expect(out.map((r) => r.n)).toEqual([0, 1]);
    expect(performance.now() - t).toBeLessThan(1_500);
  });
});

describe("settings (card #281)", () => {
  it("reads the stall time from the environment (default 1 s) and names the settings that are gone", () => {
    expect(poolOptionsFromEnv({}, STAMP, 16).stallMs).toBe(1_000);
    expect(poolOptionsFromEnv({ YOSCHED_ENGINE_STALL_MS: "250" }, STAMP, 16).stallMs).toBe(250);
    expect(poolOptionsFromEnv({ YOSCHED_ENGINE_STALL_MS: "soon" }, STAMP, 16).stallMs).toBe(1_000);
    expect(poolOptionsFromEnv({}, STAMP, 16).obsolete).toEqual([]);
    expect(poolOptionsFromEnv({ YOSCHED_ENGINE_BATCH_TIMEOUT_MS: "3000", YOSCHED_ENGINE_TRIAL_DEADLINE_MS: "" }, STAMP, 16).obsolete)
      .toEqual(["YOSCHED_ENGINE_BATCH_TIMEOUT_MS"]);
  });

  it("start-up logs once when an old setting is still set, and says the stall time", () => {
    const out: string[] = [];
    const p = installEnginePool({ YOSCHED_ENGINE_WORKER: bundle, YOSCHED_ENGINE_WORKERS: "2", YOSCHED_ENGINE_TRIAL_DEADLINE_MS: "6000" }, STAMP, (m) => out.push(m), 16);
    try {
      expect(p).not.toBeNull();
      expect(out.filter((m) => /YOSCHED_ENGINE_TRIAL_DEADLINE_MS/.test(m))).toHaveLength(1);
      expect(out.join("\n")).toMatch(/2 workers \(stall 1000 ms\)/);
    } finally { setTrialBatchRunner(null); void p?.close(); }
  });
});

describe("the batch function gives every batch of one run the same run state (card #281)", { timeout: 60_000 }, () => {
  it("one state per run, a fresh one for the next run", () => {
    const seen: TrialRunState[] = [];
    setTrialBatchRunner((b: TrialBatch, ctx) => { seen.push(ctx.run); return b.variants.map((_, i) => ctx.runHere(i)); });
    try {
      autoSchedule(fixture());
      const first = seen.length;
      expect(first).toBeGreaterThan(1);
      expect(new Set(seen).size).toBe(1);
      autoSchedule(fixture());
      expect(new Set(seen).size).toBe(2);
    } finally { setTrialBatchRunner(null); }
  });

  it("runHere runs that entry of the batch, exactly as the plain loop would", () => {
    let ok = false;
    setTrialBatchRunner((b, ctx) => {
      ok = JSON.stringify(ctx.runHere(1).result.suggestions) === JSON.stringify(trialRun(trialInput(b.base, b.variants[1])).result.suggestions);
      return null;
    });
    try { autoSchedule(fixture()); } finally { setTrialBatchRunner(null); }
    expect(ok).toBe(true);
  });
});
