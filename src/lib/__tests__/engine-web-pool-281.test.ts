// Card #281 (browser): the page helps its Web Workers and takes over after a stall, so a broken
// pool costs at most one stall per Live edit; a cancel gets through between runs done here.
import { describe, it, expect } from "vitest";
import { type TrialRun, type TrialRunState } from "../auto-scheduler";
import { applyScenario, applyScenarioSteps, runStepsAsync } from "../scenario";
import { createWebEnginePool, type WorkerLike, type WebPoolOptions } from "../engine-web-pool";
import { createTrialWorkerHandler, type WorkerMessage } from "../engine-worker-core";
import { fixture } from "./engine-266-fixture";

const STAMP = { version: "9.9.9", commit: "abc1234" };
type Behaviour = (m: WorkerMessage, reply: (r: unknown) => void) => void;
class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  constructor(private behave: Behaviour) { setTimeout(() => this.emit({ type: "hello", ...STAMP }), 1); }
  emit(data: unknown) { if (!this.terminated) this.onmessage?.({ data }); }
  postMessage(m: unknown) { if (!this.terminated) setTimeout(() => this.behave(m as WorkerMessage, (r) => this.emit(r)), 1); }
  terminate() { this.terminated = true; }
}
function makePool(behave: () => Behaviour, o: Partial<WebPoolOptions> = {}) {
  const logs: string[] = [];
  const made: FakeWorker[] = [];
  const pool = createWebEnginePool({
    url: "/w.js", workers: 2, expect: STAMP, stallMs: 200, log: (m) => logs.push(m),
    makeWorker: () => { const w = new FakeWorker(behave()); made.push(w); return w; }, ...o,
  })!;
  return { pool, logs, made };
}
const realEngine = (): Behaviour => { const h = createTrialWorkerHandler(); return (m, reply) => { const r = h(m); if (r) reply(r); }; };
const hang = (): Behaviour => () => {};
const newRun = (): TrialRunState => ({ stalled: false, inline: false });
const tagged = (run = newRun(), costMs = 0, isCurrent?: () => boolean) => ({
  run, isCurrent,
  runHere: (idx: number) => {
    const t = performance.now();
    while (performance.now() - t < costMs) { /* a run's cost */ }
    return { n: idx, by: "here" } as unknown as TrialRun;
  },
});
const variants = (k: number) => Array.from({ length: k }, (_, i) => ({ shiftTypeId: "s", minGapDays: i + 2, minGapStrength: "rule" as const }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const input = fixture();
const base = { ...input, existingAssignments: [] };
const edit = () => {
  const out = applyScenario(base, [], []);
  const c = out.grid.find((g) => g.code !== "X")!;
  return { b2: { ...input, existingAssignments: out.grid.map((g) => ({ ...g, isLocked: false, source: "auto" })) }, free: { staffId: c.staffId, date: c.date } };
};

describe("the page helps its workers and takes over (card #281)", { timeout: 120_000 }, () => {
  it("with every worker hung, a Live edit gives the plain outcome within inline time + one stall + a margin", async () => {
    const { b2, free } = edit();
    let t = performance.now();
    const plain = JSON.stringify(applyScenario(b2, [], [free]));
    const inlineMs = performance.now() - t;
    const { pool } = makePool(hang, { stallMs: 300 });
    await pool.warm();
    t = performance.now();
    const out = await runStepsAsync(applyScenarioSteps(b2, [], [free]), (b, ctx) => pool.runBatch(b, ctx));
    expect(JSON.stringify(out.ok && out.value)).toBe(plain);
    expect(performance.now() - t).toBeLessThan(inlineMs * 1.5 + 300 + 1_500);
  });

  it("with real workers, the outcome is the plain one", async () => {
    const { b2, free } = edit();
    const plain = JSON.stringify(applyScenario(b2, [], [free]));
    const { pool } = makePool(realEngine, { stallMs: 10_000 });
    await pool.warm();
    const out = await runStepsAsync(applyScenarioSteps(b2, [], [free]), (b, ctx) => pool.runBatch(b, ctx));
    expect(JSON.stringify(out.ok && out.value)).toBe(plain);
    expect(pool.disabled).toBe(false);
  });

  it("takes what the workers answer and runs the rest here (partial answers)", async () => {
    const { pool } = makePool(() => (m, reply) => { if (m.type === "run" && m.idx % 2 === 0) reply({ job: m.job, idx: m.idx, run: { n: m.idx, by: "worker" } }); });
    await pool.warm();
    const ctx = tagged();
    const out = (await pool.runBatch({ base: fixture(6), variants: variants(9) }, ctx)) as unknown as { n: number; by: string }[];
    expect(out.map((r) => r.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.some((r) => r.by === "worker")).toBe(true);
    expect(out.filter((r) => r.n % 2 === 1).every((r) => r.by === "here")).toBe(true);
    expect(ctx.run.inline).toBe(false);
  });

  it("ignores a late answer for a run it already took over", async () => {
    const { pool } = makePool(() => (m, reply) => {
      if (m.type !== "run") return;
      const d = m.idx === 0 ? 600 : 0;
      setTimeout(() => reply({ job: m.job, idx: m.idx, run: { n: m.idx, by: d ? "late" : "worker" } }), d);
    }, { workers: 1, stallMs: 150 });
    await pool.warm();
    const run = newRun();
    const out = (await pool.runBatch({ base: fixture(6), variants: variants(2) }, tagged(run))) as unknown as { n: number; by: string }[];
    expect(out).toEqual([{ n: 0, by: "here" }, { n: 1, by: "worker" }]);
    await sleep(700);
    await pool.warm();
    const out2 = (await pool.runBatch({ base: fixture(6), variants: variants(2) }, tagged(run))) as unknown as { n: number; by: string }[];
    expect(out2.map((r) => r.n)).toEqual([0, 1]);
    expect(out2.every((r) => r.by !== "late")).toBe(true);
  });

  it("a batch where no worker answered sends the rest of the edit here; two in a row turn the pool off", async () => {
    const { pool, logs } = makePool(hang, { stallMs: 100 });
    await pool.warm();
    const r1 = newRun();
    const out = (await pool.runBatch({ base: fixture(6), variants: variants(3) }, tagged(r1))) as unknown as { n: number }[];
    expect(out.map((r) => r.n)).toEqual([0, 1, 2]);
    expect(r1.inline).toBe(true);
    expect(pool.disabled).toBe(false);
    await pool.warm();
    const r2 = newRun();
    expect(await pool.runBatch({ base: fixture(6), variants: variants(3) }, tagged(r2))).not.toBeNull();
    expect(r2.inline).toBe(true);
    expect(pool.disabled).toBe(true);
    expect(logs.join("\n")).toMatch(/off for this page/);
  });

  it("an edit whose rest is inline never asks the runner again", async () => {
    const { b2, free } = edit();
    const plain = JSON.stringify(applyScenario(b2, [], [free]));
    let calls = 0;
    const out = await runStepsAsync(applyScenarioSteps(b2, [], [free]), async (_b, ctx) => { calls++; ctx.run.inline = true; return null; });
    expect(JSON.stringify(out.ok && out.value)).toBe(plain);
    expect(calls).toBe(1);
  });

  it("partial progress in every batch costs one stall per edit, not one per batch", async () => {
    const { pool } = makePool(() => { let seen = -1; return (m, reply) => {
      if (m.type !== "run" || m.job === seen) return;
      seen = m.job;
      reply({ job: m.job, idx: m.idx, run: { n: m.idx, by: "worker" } });
    }; }, { stallMs: 400 });
    await pool.warm();
    const run = newRun();
    const t = performance.now();
    for (let i = 0; i < 6; i++) {
      const out = (await pool.runBatch({ base: fixture(6), variants: variants(6) }, tagged(run, 5))) as unknown as { n: number }[];
      expect(out.map((r) => r.n)).toEqual([0, 1, 2, 3, 4, 5]);
    }
    expect(performance.now() - t).toBeLessThan(400 + 6 * 6 * 5 + 800);
    expect(run.stalled).toBe(true);
    expect(run.inline).toBe(false);
  });

  it("a cancel lands between runs done here: the batch answers null at once, and the next batch runs", async () => {
    const { pool } = makePool(hang, { stallMs: 60_000 });
    await pool.warm();
    let current = true;
    let ran = 0;
    const ctx = { run: newRun(), isCurrent: () => current, runHere: (idx: number) => { ran++; if (ran === 3) current = false; const t = performance.now(); while (performance.now() - t < 20) { /* cost */ } return { n: idx } as unknown as TrialRun; } };
    const t = performance.now();
    expect(await pool.runBatch({ base: fixture(6), variants: variants(12) }, ctx)).toBeNull();
    expect(ran).toBe(3);
    expect(performance.now() - t).toBeLessThan(1_000);
    // The same with close(): a batch waiting on hung workers resolves null at once.
    const p2 = makePool(hang, { stallMs: 60_000 }).pool;
    await p2.warm();
    const pending = p2.runBatch({ base: fixture(6), variants: variants(2) }, tagged());
    await sleep(50);
    const t2 = performance.now();
    p2.close();
    expect(await pending).toBeNull();
    expect(performance.now() - t2).toBeLessThan(200);
    // A cancelled batch does not hold up the chain: the pool's next batch runs.
    const next = (await pool.runBatch({ base: fixture(6), variants: variants(2) }, tagged(newRun(), 0))) as unknown as { n: number }[] | null;
    expect(next).not.toBeNull();
  });
});
