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
    url: "/yosched/engine-worker-abc1234.js", workers: 3, expect: STAMP, stallMs: 20_000,
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
const newRun = () => ({ run: { stalled: false, inline: false } });
const runAllHere = (b: TrialBatch): TrialRun[] => b.variants.map((v) => trialRun(trialInput(b.base, v)));

describe("Web Worker pool for Live edits (card #266 slice B)", { timeout: 120_000 }, () => {
  it("a Live edit on the workers gives exactly the plain outcome", async () => {
    const { b2, free } = edit();
    const plain = applyScenario(b2, [], [free]);
    const { pool } = makePool(realEngine);
    let batches = 0;
    const out = await runStepsAsync(applyScenarioSteps(b2, [], [free]), (b, ctx) => { batches++; return pool!.runBatch(b, ctx); });
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
    const out = await runStepsAsync(applyScenarioExpandingSteps(b2, [], [free], touched, new Map(), "range"), (b, ctx) => pool!.runBatch(b, ctx));
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
    await pool!.warm();
    const out = (await pool!.runBatch({ base: fixture(6), variants }, newRun())) as unknown as { n: number }[];
    expect(out.map((r) => r.n)).toEqual([2, 3, 4, 5, 6]);
  });

  it("ignores an answer that belongs to an earlier batch", async () => {
    const { pool } = makePool(() => (m, reply) => {
      if (m.type === "stage") return;
      reply({ job: m.job - 1, idx: m.idx, run: { n: -1 } });
      reply({ job: m.job, idx: m.idx, run: { n: m.idx } });
    });
    await pool!.warm();
    const out = (await pool!.runBatch({ base: fixture(6), variants: [null, null, null] }, newRun())) as unknown as { n: number }[];
    expect(out.map((r) => r.n)).toEqual([0, 1, 2]);
  });

  it("a worker file that fails to load (an old tab after a deploy): runs here, and the pool turns off", async () => {
    const logs: string[] = [];
    const p = createWebEnginePool({
      url: "/x.js", workers: 2, expect: STAMP, stallMs: 5_000, log: (m) => logs.push(m),
      makeWorker: () => { const w = new FakeWorker(() => {}, null); setTimeout(() => w.onerror?.({ message: "404" }), 5); return w; },
    })!;
    await p.warm();
    const t = performance.now();
    const ctx = newRun();
    expect((await p.runBatch({ base: fixture(6), variants: [null, null] }, ctx))!.length).toBe(2);
    expect(performance.now() - t).toBeLessThan(2_000);
    await p.warm();
    expect((await p.runBatch({ base: fixture(6), variants: [null, null] }, newRun()))!.length).toBe(2);
    expect(logs.join("\n")).toMatch(/failed to load/);
  });

  it("a worker that never says hello gets no work: the batch runs here, at once", async () => {
    const { pool } = makePool(realEngine, { hello: null });
    const t = performance.now();
    const b = { base: fixture(6), variants: [null, null] };
    const out = await pool!.runBatch(b, newRun());
    expect(JSON.stringify(out!.map((r) => r.result.suggestions))).toBe(JSON.stringify(runAllHere(b).map((r) => r.result.suggestions)));
    expect(performance.now() - t).toBeLessThan(2_000);
  });

  it("a worker from another release is never used, and the pool turns off", async () => {
    const { pool, made, logs } = makePool(realEngine, { hello: { type: "hello", version: "9.9.9", commit: "fff0000" } });
    await pool!.warm();
    expect(pool!.disabled).toBe(true);
    expect(made.every((w) => w.terminated)).toBe(true);
    expect(await pool!.runBatch({ base: fixture(6), variants: [null, null] }, newRun())).toBeNull();
    expect(logs.join("\n")).toMatch(/another release/);
  });

  it("a worker that hangs is taken over after the stall time; one that throws is set aside", async () => {
    const hang = makePool(() => () => {}, { stallMs: 300 });
    await hang.pool!.warm();
    const t = performance.now();
    expect((await hang.pool!.runBatch({ base: fixture(6), variants: [null, null] }, newRun()))!.length).toBe(2);
    const ms = performance.now() - t;
    expect(ms).toBeGreaterThanOrEqual(250);
    expect(ms).toBeLessThan(2_000);
    expect(hang.logs.join("\n")).toMatch(/no answer/);
    expect(hang.made[0].terminated).toBe(true); // the one that held both runs (two per worker)

    const boom = makePool(() => (m, reply) => { if (m.type !== "stage") reply({ job: m.job, idx: m.idx, error: "boom" }); });
    await boom.pool!.warm();
    expect((await boom.pool!.runBatch({ base: fixture(6), variants: [null, null] }, newRun()))!.length).toBe(2);
    await boom.pool!.warm();
    expect((await boom.pool!.runBatch({ base: fixture(6), variants: [null, null] }, newRun()))!.length).toBe(2);
    expect(boom.pool!.disabled).toBe(true);
    expect(boom.logs.join("\n")).toMatch(/boom/);
  });

  it("a failure, then a success, keeps the pool on (two failures IN A ROW turn it off)", async () => {
    let failNext = true;
    const { pool } = makePool(() => { const real = realEngine(); return (m, reply, w) => {
      if (m.type !== "stage" && failNext) { failNext = false; reply({ job: m.job, idx: m.idx, error: "once" }); return; }
      real(m, reply, w);
    }; }, { workers: 1 });
    await pool!.warm();
    const r1 = newRun();
    await pool!.runBatch({ base: fixture(6), variants: [null] }, r1);
    expect(r1.run.inline).toBe(true);
    await pool!.warm();
    const r2 = newRun();
    await pool!.runBatch({ base: fixture(6), variants: [null] }, r2);
    expect(r2.run.inline).toBe(false);
    failNext = true;
    await pool!.warm();
    await pool!.runBatch({ base: fixture(6), variants: [null] }, newRun());
    expect(pool!.disabled).toBe(false);
  });

  it("batches asked for at the same time run one after the other, each with its own result", async () => {
    const { pool } = makePool(realEngine);
    const a = fixture(6), b = fixture(8);
    await pool!.warm();
    const [ra, rb] = await Promise.all([pool!.runBatch({ base: a, variants: [null] }, newRun()), pool!.runBatch({ base: b, variants: [null] }, newRun())]);
    expect(JSON.stringify(ra![0].result.suggestions)).toBe(JSON.stringify(trialRun(a).result.suggestions));
    expect(JSON.stringify(rb![0].result.suggestions)).toBe(JSON.stringify(trialRun(b).result.suggestions));
  });

  it("is not built with no workers or an unknown release; a closed pool answers null", async () => {
    expect(makePool(realEngine, { workers: 0 }).pool).toBeNull();
    expect(makePool(realEngine, { expect: { version: "", commit: "" } }).pool).toBeNull();
    const { pool, made } = makePool(realEngine);
    expect(await pool!.runBatch({ base: fixture(6), variants: [null] }, newRun())).not.toBeNull();
    pool!.close();
    expect(made.every((w) => w.terminated)).toBe(true);
    expect(await pool!.runBatch({ base: fixture(6), variants: [null] }, newRun())).toBeNull();
  });
});
