// Card #287 (browser): slow but steady workers cost one stall per Live edit, and once an edit runs
// here (inline) a cancel still lands between runs instead of after the whole edit.
import { describe, it, expect } from "vitest";
import { type TrialRun, type TrialRunState } from "../auto-scheduler";
import { applyScenario, applyScenarioSteps, runStepsAsync } from "../scenario";
import { createWebEnginePool, type WorkerLike } from "../engine-web-pool";
import type { WorkerMessage } from "../engine-worker-core";
import { fixture } from "./engine-266-fixture";

const STAMP = { version: "9.9.9", commit: "abc1234" };
/** Answers every run after `ms`, one at a time, like a busy but working worker. */
class SlowWorker implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  private q: Extract<WorkerMessage, { type: "run" }>[] = [];
  private busy = false;
  constructor(private ms: number) { setTimeout(() => this.emit({ type: "hello", ...STAMP }), 1); }
  emit(data: unknown) { if (!this.terminated) this.onmessage?.({ data }); }
  private go() {
    if (this.busy || !this.q.length) return;
    this.busy = true;
    const m = this.q.shift()!;
    setTimeout(() => { this.emit({ job: m.job, idx: m.idx, run: { n: m.idx, by: "worker" } }); this.busy = false; this.go(); }, this.ms);
  }
  postMessage(m: unknown) { const w = m as WorkerMessage; if (!this.terminated && w.type === "run") { this.q.push(w); this.go(); } }
  terminate() { this.terminated = true; }
}
const newRun = (): TrialRunState => ({ stalled: false, inline: false });
const tagged = (run = newRun(), costMs = 0) => ({
  run,
  runHere: (idx: number) => {
    const t = performance.now();
    while (performance.now() - t < costMs) { /* a run's cost */ }
    return { n: idx, by: "here" } as unknown as TrialRun;
  },
});
const variants = (k: number) => Array.from({ length: k }, (_, i) => ({ shiftTypeId: "s", minGapDays: i + 2, minGapStrength: "rule" as const }));

const input = fixture();
const base = { ...input, existingAssignments: [] };
const edit = () => {
  const out = applyScenario(base, [], []);
  const c = out.grid.find((g) => g.code !== "X")!;
  return { b2: { ...input, existingAssignments: out.grid.map((g) => ({ ...g, isLocked: false, source: "auto" })) }, free: { staffId: c.staffId, date: c.date } };
};

describe("slow workers and cancels on the inline path (card #287)", { timeout: 120_000 }, () => {
  it("workers that each answer just inside the stall time: the edit takes over after one stall's worth of lag", async () => {
    const logs: string[] = [];
    const stallMs = 400;
    const pool = createWebEnginePool({ url: "/w.js", workers: 2, expect: STAMP, stallMs, log: (m) => logs.push(m), makeWorker: () => new SlowWorker(320) })!;
    await pool.warm();
    const run = newRun();
    const t = performance.now();
    for (let i = 0; i < 5; i++) {
      const out = (await pool.runBatch({ base: fixture(6), variants: variants(4) }, tagged(run, 5))) as unknown as { n: number }[];
      expect(out.map((r) => r.n)).toEqual([0, 1, 2, 3]);
    }
    expect(performance.now() - t).toBeLessThan(stallMs + 5 * 4 * 5 + 800);
    expect(run.stalled).toBe(true);
    expect(run.inline).toBe(false);
    expect(pool.disabled).toBe(false);
    expect(logs.join("\n")).toMatch(/slower than/);
  });

  it("a pool that keeps up is never taken over", async () => {
    const pool = createWebEnginePool({ url: "/w.js", workers: 2, expect: STAMP, stallMs: 150, log: () => {}, makeWorker: () => new SlowWorker(10) })!;
    await pool.warm();
    const run = newRun();
    for (let i = 0; i < 20; i++) await pool.runBatch({ base: fixture(6), variants: variants(6) }, tagged(run, 10));
    expect(run.stalled).toBe(false);
  });

  it("once the edit runs here, a cancel lands before the next run, not after the whole edit", async () => {
    const { b2, free } = edit();
    let current = true;
    let state: TrialRunState | null = null;
    const out = await runStepsAsync(applyScenarioSteps(b2, [], [free]), async (_b, ctx) => {
      state = ctx.run;
      ctx.run.inline = true; // as after a batch no worker answered
      setTimeout(() => { current = false; }, 0); // the edit is undone right away
      return null;
    }, () => current);
    expect(out.ok).toBe(false);
    expect(state!.hereRuns ?? 0).toBeLessThanOrEqual(1);
  });

  it("an edit that runs here to the end still gives the plain outcome", async () => {
    const { b2, free } = edit();
    const plain = JSON.stringify(applyScenario(b2, [], [free]));
    let state: TrialRunState | null = null;
    const out = await runStepsAsync(applyScenarioSteps(b2, [], [free]), async (_b, ctx) => { state = ctx.run; ctx.run.inline = true; return null; });
    expect(JSON.stringify(out.ok && out.value)).toBe(plain);
    expect(state!.hereRuns).toBeGreaterThan(2); // every run done here is timed for the cost book
  });
});
