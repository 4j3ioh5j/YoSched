// Card #266 slice B: Live edits in the browser run their engine batches on Web Workers, with
// exactly the outcome of the plain call, and fall back to running here whenever the workers are
// missing, from another release, broken or slow. A job that is no longer current is dropped.
import { describe, it, expect } from "vitest";
import { trialRun, trialInput, type TrialBatch, type TrialRun } from "../auto-scheduler";
import { applyScenario, applyScenarioExpanding, applyScenarioSteps, applyScenarioExpandingSteps, runStepsAsync } from "../scenario";
import { createWebEnginePool, type WorkerLike, type WebPoolOptions } from "../engine-web-pool";
import { createTrialWorkerHandler, type WorkerMessage } from "../engine-worker-core";
import { fixture } from "./engine-266-fixture";

const STAMP = { version: "9.9.9", commit: "abc1234" };
type Behaviour = (m: WorkerMessage, reply: (r: unknown) => void, w: FakeWorker) => void;

/** A stand-in for a browser Worker: answers asynchronously, like the real one. */
class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  constructor(private behave: Behaviour, hello: unknown | null) {
    if (hello) setTimeout(() => this.emit(hello), 1);
  }
  emit(data: unknown) { if (!this.terminated) this.onmessage?.({ data }); }
  postMessage(m: unknown) {
    if (this.terminated) return;
    setTimeout(() => this.behave(m as WorkerMessage, (r) => this.emit(r), this), 1);
  }
  terminate() { this.terminated = true; }
}

/** A real engine behind the fake: every message goes through the worker handler. */
const realEngine = (): Behaviour => {
  const h = createTrialWorkerHandler();
  return (m, reply) => { const r = h(m); if (r) reply(r); };
};

function makePool(behave: () => Behaviour, o: Partial<WebPoolOptions> & { hello?: unknown | null } = {}) {
  const made: FakeWorker[] = [];
  const logs: string[] = [];
  const hello = o.hello === undefined ? { type: "hello", ...STAMP } : o.hello;
  const pool = createWebEnginePool({
    url: "/yosched/engine-worker-abc1234.js", workers: 3, expect: STAMP, startTimeoutMs: 2_000, batchTimeoutMs: 20_000,
    makeWorker: () => { const w = new FakeWorker(behave(), hello); made.push(w); return w; },
    log: (m) => logs.push(m),
    ...o,
  });
  return { pool, made, logs };
}

const input = fixture();
const base = { ...input, existingAssignments: [] };
const edit = () => {
  const out = applyScenario(base, [], []);
  const c = out.grid.find((g) => g.code !== "X")!;
  return { b2: { ...input, existingAssignments: out.grid.map((g) => ({ ...g, isLocked: false, source: "auto" })) }, free: { staffId: c.staffId, date: c.date } };
};
const runAllHere = (b: TrialBatch): TrialRun[] => b.variants.map((v) => trialRun(trialInput(b.base, v)));

describe("Web Worker pool for Live edits (card #266 slice B)", { timeout: 120_000 }, () => {
  it("a Live edit on the workers gives exactly the plain outcome", async () => {
    const { b2, free } = edit();
    const plain = applyScenario(b2, [], [free]);
    const { pool } = makePool(realEngine);
    let batches = 0;
    const out = await runStepsAsync(applyScenarioSteps(b2, [], [free]), (b) => { batches++; return pool!.runBatch(b); });
    expect(out.ok).toBe(true);
    expect(JSON.stringify(out.ok && out.value)).toBe(JSON.stringify(plain));
    expect(batches).toBeGreaterThan(2);
    expect(pool!.disabled).toBe(false);
  });

  it("a widening Live edit on the workers gives exactly the plain outcome", async () => {
    const { b2, free } = edit();
    const touched = new Set([free.date]);
    const plain = applyScenarioExpanding(b2, [], [free], touched, new Map(), "range");
    const { pool } = makePool(realEngine);
    const out = await runStepsAsync(applyScenarioExpandingSteps(b2, [], [free], touched, new Map(), "range"), (b) => pool!.runBatch(b));
    expect(JSON.stringify(out.ok && out.value)).toBe(JSON.stringify(plain));
  });

  it("a job that stops being current is dropped, and runs no further batch", async () => {
    const { b2, free } = edit();
    let current = true;
    let batches = 0;
    const out = await runStepsAsync(applyScenarioSteps(b2, [], [free]), async (b) => { batches++; current = false; return runAllHere(b); }, () => current);
    expect(out.ok).toBe(false);
    expect(batches).toBe(1);
    const never = await runStepsAsync(applyScenarioSteps(b2, [], [free]), async (b) => { batches++; return runAllHere(b); }, () => false);
    expect(never.ok).toBe(false);
    expect(batches).toBe(1);
  });

  it("a batch the workers give up on (null, a throw, the wrong count) runs here, same outcome", async () => {
    const { b2, free } = edit();
    const plain = JSON.stringify(applyScenario(b2, [], [free]));
    for (const run of [
      async () => null,
      async () => { throw new Error("boom"); },
      async (b: TrialBatch) => runAllHere(b).slice(1),
    ]) {
      const out = await runStepsAsync(applyScenarioSteps(b2, [], [free]), run as (b: TrialBatch) => Promise<TrialRun[] | null>);
      expect(JSON.stringify(out.ok && out.value)).toBe(plain);
    }
  });

  it("puts each run back in its candidate's place, whatever order the workers answer in", async () => {
    const { pool } = makePool(() => (m, reply) => {
      if (m.type === "stage") return;
      setTimeout(() => reply({ job: m.job, idx: m.idx, run: { n: m.variant!.minGapDays } }), 120 - m.variant!.minGapDays * 15);
    });
    const variants = [2, 3, 4, 5, 6].map((n) => ({ shiftTypeId: "s", minGapDays: n, minGapStrength: "rule" as const }));
    const out = (await pool!.runBatch({ base: fixture(6), variants })) as unknown as { n: number }[];
    expect(out.map((r) => r.n)).toEqual([2, 3, 4, 5, 6]);
  });

  it("ignores an answer that belongs to an earlier batch", async () => {
    const { pool } = makePool(() => (m, reply) => {
      if (m.type === "stage") return;
      reply({ job: m.job - 1, idx: m.idx, run: { n: -1 } });
      reply({ job: m.job, idx: m.idx, run: { n: m.idx } });
    });
    const out = (await pool!.runBatch({ base: fixture(6), variants: [null, null, null] })) as unknown as { n: number }[];
    expect(out.map((r) => r.n)).toEqual([0, 1, 2]);
  });

  it("a worker file that fails to load (an old tab after a deploy) means runs here, and the pool turns off", async () => {
    const { pool, logs } = makePool(() => () => {}, { hello: null });
    // The browser reports a failed script load as an error event on the Worker.
    const p = createWebEnginePool({
      url: "/x.js", workers: 2, expect: STAMP, startTimeoutMs: 5_000, batchTimeoutMs: 5_000, log: (m) => logs.push(m),
      makeWorker: () => { const w = new FakeWorker(() => {}, null); setTimeout(() => w.onerror?.({ message: "404" }), 5); return w; },
    })!;
    const t = performance.now();
    expect(await p.runBatch({ base: fixture(6), variants: [null, null] })).toBeNull();
    expect(performance.now() - t).toBeLessThan(2_000);
    expect(await p.runBatch({ base: fixture(6), variants: [null, null] })).toBeNull();
    expect(p.disabled).toBe(true);
    expect(await p.runBatch({ base: fixture(6), variants: [null] })).toBeNull();
    expect(logs.join("\n")).toMatch(/could not start|failed to load/);
    pool!.close();
  });

  it("a worker that never says hello runs here after the start time limit", async () => {
    const { pool, logs } = makePool(realEngine, { hello: null, startTimeoutMs: 300 });
    const t = performance.now();
    expect(await pool!.runBatch({ base: fixture(6), variants: [null, null] })).toBeNull();
    const ms = performance.now() - t;
    expect(ms).toBeGreaterThanOrEqual(250);
    expect(ms).toBeLessThan(2_000);
    expect(logs.join("\n")).toMatch(/start/);
  });

  it("a worker from another release is never used", async () => {
    const { pool, made, logs } = makePool(realEngine, { hello: { type: "hello", version: "9.9.9", commit: "fff0000" } });
    expect(await pool!.runBatch({ base: fixture(6), variants: [null, null] })).toBeNull();
    expect(pool!.disabled).toBe(true);
    expect(made.every((w) => w.terminated)).toBe(true);
    expect(logs.join("\n")).toMatch(/another release/);
  });

  it("a worker that hangs runs here after the batch time limit; one that throws too", async () => {
    const hang = makePool(() => () => {}, { batchTimeoutMs: 300 });
    const t = performance.now();
    expect(await hang.pool!.runBatch({ base: fixture(6), variants: [null, null] })).toBeNull();
    const ms = performance.now() - t;
    expect(ms).toBeGreaterThanOrEqual(250);
    expect(ms).toBeLessThan(2_000);
    expect(hang.logs.join("\n")).toMatch(/time limit/);
    expect(hang.made.every((w) => w.terminated)).toBe(true);

    const boom = makePool(() => (m, reply) => { if (m.type !== "stage") reply({ job: m.job, idx: m.idx, error: "boom" }); });
    expect(await boom.pool!.runBatch({ base: fixture(6), variants: [null, null] })).toBeNull();
    expect(await boom.pool!.runBatch({ base: fixture(6), variants: [null, null] })).toBeNull();
    expect(boom.pool!.disabled).toBe(true);
    expect(boom.logs.join("\n")).toMatch(/boom/);
  });

  it("a failure, then a success, keeps the pool on (two failures IN A ROW turn it off)", async () => {
    let failNext = true;
    const { pool } = makePool(() => { const real = realEngine(); return (m, reply, w) => {
      if (m.type !== "stage" && failNext) { failNext = false; reply({ job: m.job, idx: m.idx, error: "once" }); return; }
      real(m, reply, w);
    }; });
    expect(await pool!.runBatch({ base: fixture(6), variants: [null, null] })).toBeNull();
    expect(await pool!.runBatch({ base: fixture(6), variants: [null, null] })).not.toBeNull();
    failNext = true;
    expect(await pool!.runBatch({ base: fixture(6), variants: [null, null] })).toBeNull();
    expect(pool!.disabled).toBe(false);
  });

  it("batches asked for at the same time run one after the other, each with its own result", async () => {
    const { pool } = makePool(realEngine);
    const a = fixture(6), b = fixture(8);
    const [ra, rb] = await Promise.all([pool!.runBatch({ base: a, variants: [null] }), pool!.runBatch({ base: b, variants: [null] })]);
    expect(JSON.stringify(ra![0].result.suggestions)).toBe(JSON.stringify(trialRun(a).result.suggestions));
    expect(JSON.stringify(rb![0].result.suggestions)).toBe(JSON.stringify(trialRun(b).result.suggestions));
  });

  it("is not built with no workers or an unknown release; a closed pool answers null", async () => {
    expect(makePool(realEngine, { workers: 0 }).pool).toBeNull();
    expect(makePool(realEngine, { expect: { version: "", commit: "" } }).pool).toBeNull();
    const { pool, made } = makePool(realEngine);
    expect(await pool!.runBatch({ base: fixture(6), variants: [null] })).not.toBeNull();
    pool!.close();
    expect(made.every((w) => w.terminated)).toBe(true);
    expect(await pool!.runBatch({ base: fixture(6), variants: [null] })).toBeNull();
  });
});
