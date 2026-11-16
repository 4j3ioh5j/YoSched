// Card #266 slice B: a pool of Web Workers for Live edits in the browser.
//
// The browser's main thread cannot wait (no Atomics.wait there), so this pool is ASYNC: runBatch
// returns a promise, and the caller drives a Live edit's steps with runStepsAsync (scenario.ts).
// The protocol is the server pool's (engine-worker-core.ts): one "stage" per worker per batch,
// then the runs handed out one at a time, answers put back in the candidates' order. A worker
// first says hello with the release it was built from; one from another release is never used.
//
// Anything unexpected (the worker file fails to load, no hello within the start time limit, a
// worker that throws or does not answer within the batch time limit) returns null, and the caller
// runs that batch on the main thread: slower, never different. Two failures in a row, or a worker
// from another release, turn the pool off for this page.
import type { TrialBatch, TrialRun } from "./auto-scheduler";
import type { WorkerMessage, WorkerReply } from "./engine-worker-core";

export type BundleStamp = { version: string; commit: string };
/** What the pool needs of a Worker (a real one in the browser, a stand-in in tests). */
export type WorkerLike = {
  postMessage(m: unknown): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
};
export type WebPoolOptions = {
  url: string;
  workers: number;
  /** The release this page was built from; each worker's hello must match it. */
  expect: BundleStamp;
  /** How long a new worker may take to load and say hello. */
  startTimeoutMs: number;
  /** How long one batch may take before it is given up and run on the main thread. */
  batchTimeoutMs: number;
  makeWorker?: (url: string) => WorkerLike;
  log?: (message: string) => void;
};
export type WebEnginePool = {
  runBatch(batch: TrialBatch): Promise<TrialRun[] | null>;
  close(): void;
  readonly disabled: boolean;
};
/** The first message a worker sends: the release it was built from. */
export type WorkerHello = { type: "hello"; version: string; commit: string };

const FAILS_TO_DISABLE = 2;
const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e));

type Slot = {
  w: WorkerLike;
  /** Resolves true once the worker said hello with this release, false on any failure. */
  ready: Promise<"ok" | "error" | "release">;
  onReply: ((m: WorkerReply) => void) | null;
  onFail: ((why: string) => void) | null;
  dead: boolean;
};

export function createWebEnginePool(o: WebPoolOptions): WebEnginePool | null {
  const log = o.log ?? ((m: string) => console.warn(m));
  if (!Number.isInteger(o.workers) || o.workers < 1) return null;
  if (!o.expect.version || !o.expect.commit) return null;
  const makeWorker = o.makeWorker ?? ((url: string) => new Worker(url) as unknown as WorkerLike);
  const slots: Slot[] = [];
  let job = 0;
  let fails = 0;
  let disabled = false;
  let chain: Promise<unknown> = Promise.resolve();
  let abortCurrent: (() => void) | null = null;

  const spawn = (): Slot => {
    let settle: (v: "ok" | "error" | "release") => void = () => {};
    const slot: Slot = { w: null as unknown as WorkerLike, ready: new Promise((r) => { settle = r; }), onReply: null, onFail: null, dead: false };
    let said = false;
    const timer = setTimeout(() => settle("error"), o.startTimeoutMs);
    const w = makeWorker(o.url);
    slot.w = w;
    w.onmessage = (e) => {
      const m = e.data as WorkerHello | WorkerReply;
      if (m && typeof m === "object" && "type" in m && m.type === "hello") {
        if (said) return;
        said = true;
        clearTimeout(timer);
        settle(m.version === o.expect.version && m.commit === o.expect.commit ? "ok" : "release");
        if (m.version !== o.expect.version || m.commit !== o.expect.commit) {
          log(`engine workers off: a worker is from another release (${m.version} ${m.commit}; this page is ${o.expect.version} ${o.expect.commit}); Live edits run here`);
        }
        return;
      }
      slot.onReply?.(m as WorkerReply);
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      slot.dead = true;
      if (!said) { said = true; log(`engine workers: a worker failed to load (${errText(e)})`); settle("error"); }
      slot.onFail?.(`a worker failed: ${errText(e)}`);
    };
    return slot;
  };
  const reset = () => { for (const s of slots.splice(0)) { s.onReply = null; s.onFail = null; s.w.terminate(); } };
  const fail = (why: string): null => {
    reset();
    fails++;
    if (fails >= FAILS_TO_DISABLE) {
      disabled = true;
      log(`engine workers off for this page after ${fails} failures in a row (${why}); Live edits run here`);
    } else {
      log(`engine workers: ${why}; this batch runs here`);
    }
    return null;
  };

  async function run(b: TrialBatch): Promise<TrialRun[] | null> {
    if (disabled) return null;
    const n = b.variants.length;
    if (n === 0) return [];
    const k = Math.min(o.workers, n);
    for (let i = slots.length - 1; i >= 0; i--) if (slots[i].dead) slots.splice(i, 1)[0].w.terminate();
    try {
      while (slots.length < k) slots.push(spawn());
    } catch (e) { return fail(`a worker could not start: ${errText(e)}`); }
    const active = slots.slice(0, k);
    const states = await Promise.all(active.map((s) => s.ready));
    if (disabled) return null; // closed while starting
    if (states.includes("release")) { reset(); disabled = true; return null; }
    if (states.includes("error")) return fail(`a worker could not start within ${o.startTimeoutMs} ms`);

    const id = ++job;
    return new Promise<TrialRun[] | null>((resolve) => {
      const out: (TrialRun | undefined)[] = new Array(n).fill(undefined);
      let got = 0;
      let next = 0;
      let done = false;
      const finish = (v: TrialRun[] | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        abortCurrent = null;
        for (const s of active) { s.onReply = null; s.onFail = null; }
        resolve(v);
      };
      const timer = setTimeout(() => finish(fail(`no answer within the batch time limit (${o.batchTimeoutMs} ms)`)), o.batchTimeoutMs);
      abortCurrent = () => finish(null);
      const send = (s: Slot, m: WorkerMessage) => s.w.postMessage(m);
      const sendNext = (s: Slot) => { if (next < n) { const idx = next++; send(s, { type: "run", job: id, idx, variant: b.variants[idx] }); } };
      for (const s of active) {
        s.onFail = (why) => finish(fail(why));
        s.onReply = (m) => {
          if (done || !m || m.job !== id) return; // an answer for an earlier batch
          if ("error" in m) { finish(fail(`a worker failed: ${m.error}`)); return; }
          if (!Number.isInteger(m.idx) || m.idx < 0 || m.idx >= n || out[m.idx] !== undefined) { finish(fail("a worker answered out of turn")); return; }
          out[m.idx] = m.run;
          got++;
          if (got >= n) { fails = 0; finish(out as TrialRun[]); return; }
          sendNext(s);
        };
      }
      try {
        for (const s of active) send(s, { type: "stage", job: id, base: b.base });
        for (const s of active) sendNext(s);
      } catch (e) { finish(fail(`the batch could not be sent: ${errText(e)}`)); }
    });
  }

  return {
    // One batch at a time: the workers hold one stage each.
    runBatch(b) {
      const p = chain.then(() => run(b));
      chain = p.catch(() => undefined);
      return p.catch(() => null);
    },
    close() { disabled = true; abortCurrent?.(); reset(); },
    get disabled() { return disabled; },
  };
}
