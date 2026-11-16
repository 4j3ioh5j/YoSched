// Card #266 slice B: a pool of Web Workers for Live edits in the browser.
//
// The browser's main thread cannot wait (no Atomics.wait there), so this pool is ASYNC: runBatch
// returns a promise, and the caller drives a Live edit's steps with runStepsAsync (scenario.ts).
// The protocol is the server pool's (engine-worker-core.ts): one "stage" per worker per batch,
// then the runs handed out (up to two at a time per worker), answers put back in the candidates'
// order. A worker first says hello with the release it was built from; it gets no work before
// that, and one from another release is never used (the pool turns off for the page).
//
// Card #281: the same rules as the server pool. This page HELPS: a run no worker holds is run here
// (between runs it yields, so worker answers and a cancel get through). When every remaining run is
// held by a worker and none has answered for the stall time, the lowest unanswered run is run
// here (a late answer for it is ignored); after one stall in a run, later batches of that run take
// over at once. A batch where no worker answered (a stall, a load failure, an error) sends the rest
// of the run here; two in a row turn the pool off. A batch only answers null when it was cancelled
// (the job stopped being current, or the pool was closed) or the pool is off.
//
// Card #287: each run keeps a cost book (trial-run-cost.ts). Runs done here are timed (the first
// batch with no known cost keeps its last run here to learn it), and once the run's pool batches
// are a stall behind the same runs done here, this page takes over as after a stall. So workers
// that answer slowly but steadily also cost at most one stall per run.
import { trialRun, trialInput, type TrialBatch, type TrialRun, type TrialRunState } from "./auto-scheduler";
import type { WorkerMessage, WorkerReply } from "./engine-worker-core";
import { behindMs, hereCost, runTimed, settleBatch } from "./trial-run-cost";

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
  /** How long the workers may go without answering before this page takes over their runs. */
  stallMs: number;
  makeWorker?: (url: string) => WorkerLike;
  log?: (message: string) => void;
  /** Lets worker answers and a cancel through between runs done here (default: a 0 ms timer). */
  yieldToLoop?: () => Promise<void>;
};
/** One batch's context: its run's state, whether its job is still wanted, and a run done here. */
export type WebBatchCtx = { run: TrialRunState; isCurrent?: () => boolean; runHere?: (idx: number) => TrialRun };
export type WebEnginePool = {
  runBatch(batch: TrialBatch, ctx: WebBatchCtx): Promise<TrialRun[] | null>;
  /** Starts the workers now; resolves once each has said hello or failed to load. */
  warm(): Promise<void>;
  close(): void;
  readonly disabled: boolean;
};
/** The first message a worker sends: the release it was built from. */
export type WorkerHello = { type: "hello"; version: string; commit: string };

const FAILS_TO_DISABLE = 2;
const PER_WORKER = 2;
const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e));

type Slot = {
  w: WorkerLike;
  ready: boolean;
  dead: boolean;
  /** Resolves once the worker said hello (either release), failed, or was terminated. */
  settled: Promise<void>;
  settle: () => void;
  onReady: (() => void) | null;
  onReply: ((m: WorkerReply) => void) | null;
  onFail: ((why: string) => void) | null;
};

export function createWebEnginePool(o: WebPoolOptions): WebEnginePool | null {
  const log = o.log ?? ((m: string) => console.warn(m));
  if (!Number.isInteger(o.workers) || o.workers < 1) return null;
  if (!o.expect.version || !o.expect.commit) return null;
  const makeWorker = o.makeWorker ?? ((url: string) => new Worker(url) as unknown as WorkerLike);
  const yieldToLoop = o.yieldToLoop ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const stallMs = Math.max(0, o.stallMs);
  const slots: Slot[] = [];
  let job = 0;
  let fails = 0;
  let disabled = false;
  let chain: Promise<unknown> = Promise.resolve();
  let abortCurrent: (() => void) | null = null;

  const spawn = (): Slot => {
    let settle: () => void = () => {};
    const slot: Slot = { w: null as unknown as WorkerLike, ready: false, dead: false, settled: new Promise((r) => { settle = r; }), settle: () => settle(), onReady: null, onReply: null, onFail: null };
    let said = false;
    const w = makeWorker(o.url);
    slot.w = w;
    w.onmessage = (e) => {
      const m = e.data as WorkerHello | WorkerReply;
      if (m && typeof m === "object" && "type" in m && m.type === "hello") {
        if (said) return;
        said = true;
        settle();
        if (m.version !== o.expect.version || m.commit !== o.expect.commit) {
          log(`engine workers off: a worker is from another release (${m.version} ${m.commit}; this page is ${o.expect.version} ${o.expect.commit}); Live edits run here`);
          disabled = true;
          slot.dead = true;
          slot.onFail?.("a worker is from another release");
          reset();
          return;
        }
        slot.ready = true;
        slot.onReady?.();
        return;
      }
      if (slot.ready) slot.onReply?.(m as WorkerReply);
    };
    w.onerror = (e) => {
      slot.dead = true;
      if (!said) { said = true; settle(); log(`engine workers: a worker failed to load (${errText(e)})`); }
      slot.onFail?.(`a worker failed: ${errText(e)}`);
    };
    return slot;
  };
  function reset() { for (const s of slots.splice(0)) { s.onReply = null; s.onFail = null; s.onReady = null; s.dead = true; s.w.terminate(); s.settle(); } }
  const prune = () => { for (let i = slots.length - 1; i >= 0; i--) if (slots[i].dead) { const s = slots.splice(i, 1)[0]; s.w.terminate(); s.settle(); } };
  const failed = (why: string) => {
    fails++;
    if (fails >= FAILS_TO_DISABLE) {
      disabled = true;
      reset();
      log(`engine workers off for this page after ${fails} failures in a row (${why}); Live edits run here`);
    } else {
      log(`engine workers: ${why}; the rest of this edit runs here`);
    }
  };
  const ensure = (k: number): boolean => {
    prune();
    try {
      while (slots.length < k) slots.push(spawn());
      return true;
    } catch (e) {
      reset();
      failed(`a worker could not start: ${errText(e)}`);
      return false;
    }
  };

  async function run(b: TrialBatch, ctx: WebBatchCtx): Promise<TrialRun[] | null> {
    if (disabled) return null;
    const isCurrent = ctx.isCurrent ?? (() => true);
    if (!isCurrent()) return null;
    const n = b.variants.length;
    if (n === 0) return [];
    if (!ensure(Math.min(o.workers, n))) return null;
    const plainHere = ctx.runHere ?? ((idx: number) => trialRun(trialInput(b.base, b.variants[idx])));
    // Card #287: every run done here is timed for the run's cost book. While a run here has no
    // known cost yet, this page keeps the batch's last run for itself, to learn it.
    const runHere = (idx: number) => runTimed(ctx.run, () => plainHere(idx));
    const reserved = hereCost(ctx.run) == null && n >= 2 ? n - 1 : -1;
    const end = reserved >= 0 ? n - 1 : n;
    const id = ++job;
    type Live = { slot: Slot; held: Set<number>; ok: boolean; staged: boolean; lastAnswer: number };
    const t0 = performance.now();
    const active: Live[] = slots.slice(0, Math.min(o.workers, n)).map((slot) => ({ slot, held: new Set(), ok: true, staged: false, lastAnswer: t0 }));
    const out: (TrialRun | undefined)[] = new Array(n).fill(undefined);
    let got = 0;
    let answers = 0;
    let errors: string | null = null;
    let stalledHere = false;
    let lastWorkerAnswer = t0;
    let aborted = false;
    let wake: (() => void) | null = null;
    const poke = () => { const w = wake; wake = null; w?.(); };
    let next = 0;
    const back: number[] = [];
    const take = (): number | null => {
      while (back.length) { const i = back.shift()!; if (out[i] === undefined) return i; }
      while (next < end) { const i = next++; if (out[i] === undefined) return i; }
      return null;
    };
    const put = (idx: number, r: TrialRun) => { out[idx] = r; got++; };
    const retire = (l: Live) => {
      if (!l.ok) return;
      l.ok = false;
      for (const i of l.held) if (out[i] === undefined) back.push(i);
      back.sort((x, y) => x - y);
      l.held.clear();
      l.slot.onReady = null; l.slot.onReply = null; l.slot.onFail = null;
      l.slot.dead = true;
    };
    const send = (l: Live, m: WorkerMessage): boolean => {
      try { l.slot.w.postMessage(m); return true; } catch (e) { errors ??= `the batch could not be sent: ${errText(e)}`; retire(l); return false; }
    };
    const fill = () => {
      for (const l of active) {
        if (!l.ok || !l.slot.ready) continue;
        if (!l.staged) { if (!send(l, { type: "stage", job: id, base: b.base })) continue; l.staged = true; l.lastAnswer = performance.now(); }
        while (l.ok && l.held.size < PER_WORKER) {
          const idx = take();
          if (idx == null) return;
          if (send(l, { type: "run", job: id, idx, variant: b.variants[idx] })) l.held.add(idx);
          else back.push(idx);
        }
      }
    };
    for (const l of active) {
      l.slot.onReady = () => { fill(); poke(); };
      l.slot.onFail = (why) => { errors ??= why; retire(l); poke(); };
      l.slot.onReply = (m) => {
        if (!l.ok || !m || m.job !== id) return; // an answer for an earlier batch
        if ("error" in m) { errors ??= `a worker failed: ${m.error}`; retire(l); poke(); return; }
        if (!Number.isInteger(m.idx) || !l.held.has(m.idx)) { errors ??= "a worker answered out of turn"; retire(l); poke(); return; }
        l.held.delete(m.idx);
        l.lastAnswer = lastWorkerAnswer = performance.now();
        if (out[m.idx] === undefined) { put(m.idx, m.run); answers++; }
        fill();
        poke();
      };
    }
    abortCurrent = () => { aborted = true; poke(); };
    const cleanup = () => {
      abortCurrent = null;
      for (const l of active) { if (l.ok) { l.slot.onReady = null; l.slot.onReply = null; l.slot.onFail = null; } }
    };

    try {
      fill();
      if (reserved >= 0) { put(reserved, runHere(reserved)); await yieldToLoop(); }
      while (got < n) {
        if (aborted || !isCurrent()) return null;
        const free = take();
        if (free != null) { put(free, runHere(free)); await yieldToLoop(); continue; }
        const now = performance.now();
        const idle = now - lastWorkerAnswer;
        // Card #287: steady answers just inside the stall time still lose time against running here.
        const behind = behindMs(ctx.run, n, now - t0);
        if (ctx.run.stalled || idle >= stallMs || (behind != null && behind >= stallMs)) {
          if (!ctx.run.stalled) {
            log(idle >= stallMs
              ? `engine workers: no answer for ${Math.round(idle)} ms; this page finishes the edit's batches itself`
              : `engine workers: the workers answer slower than this page runs the batches (${Math.round(behind!)} ms behind); this page finishes the edit's batches itself`);
            ctx.run.stalled = true;
            stalledHere = true;
          }
          let low = -1;
          for (let i = 0; i < n; i++) if (out[i] === undefined) { low = i; break; }
          if (low >= 0) put(low, runHere(low));
          await yieldToLoop();
          continue;
        }
        await new Promise<void>((r) => {
          const timer = setTimeout(() => { if (wake === done) wake = null; r(); }, Math.max(1, Math.min(stallMs - idle, behind == null ? Infinity : stallMs - behind)));
          const done = () => { clearTimeout(timer); r(); };
          wake = done;
        });
      }
    } finally {
      cleanup();
    }

    const now = performance.now();
    settleBatch(ctx.run, n, now - t0);
    for (const l of active) if (l.ok && l.held.size > 0 && now - l.lastAnswer >= stallMs) { retire(l); }
    prune();
    if (answers > 0) fails = 0;
    else if (!disabled && (stalledHere || errors)) { ctx.run.inline = true; failed(errors ?? `no worker answered within ${stallMs} ms`); }
    else if (disabled) ctx.run.inline = true;
    return out as TrialRun[];
  }

  return {
    // One batch at a time: the workers hold one stage each.
    runBatch(b, ctx) {
      const p = chain.then(() => run(b, ctx));
      chain = p.catch(() => undefined);
      return p.catch(() => null);
    },
    async warm() {
      if (disabled || !ensure(o.workers)) return;
      await Promise.all(slots.map((s) => s.settled));
    },
    close() { disabled = true; abortCurrent?.(); reset(); },
    get disabled() { return disabled; },
  };
}
