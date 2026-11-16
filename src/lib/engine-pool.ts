// Card #266: a pool of worker threads for the spacing trial (server only; node built-ins only).
//
// The trial (auto-scheduler.ts spacingTrialSteps) is a sequence of batches whose candidate runs
// all start from one base and do not depend on each other. runBatch sends the base to each worker
// once, hands out the candidates (up to two at a time per worker), and returns the runs in the
// candidates' order, so the trial picks exactly what the plain loop picks.
//
// runBatch is SYNCHRONOUS: the caller (autoSchedule, and through it applyScenario and request
// approval) stays a plain function. It waits on a shared counter with Atomics.wait, which Node
// allows on its main thread, and reads replies with receiveMessageOnPort. Node's worker `error`
// and `exit` events cannot fire while it loops, so a dead worker looks like a silent one.
//
// Card #281: the main thread HELPS. Whenever a run is held by no worker, it runs that run itself
// (ctx.runHere). When every remaining run is held by a worker and no worker has answered for the
// stall time, it runs the lowest unanswered run itself (a late answer for it is ignored); after
// one stall in a run, later batches of that run take over at once. So a hung, dead or broken pool
// costs at most one stall per run on top of the plain loop, and the result is always the plain
// loop's. A batch where no worker answered (a stall or an error) sends the rest of its run inline;
// two such batches in a row turn the pool off for the process.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker, MessageChannel, receiveMessageOnPort, type MessagePort } from "node:worker_threads";
import type { TrialBatch, TrialBatchCtx, TrialBatchRunner, TrialRun } from "./auto-scheduler";
import type { WorkerReply } from "./engine-worker-core";

export type BundleStamp = { version: string; commit: string };
const STAMP_RE = /^\/\* yosched-engine-worker (\{[^\n]*?\}) \*\//;
/** The first line of a worker bundle: the release it was built from. */
export const stampBanner = (s: BundleStamp): string => `/* yosched-engine-worker ${JSON.stringify(s)} */`;

/** The release stamp on a bundle's first line, or null when it has none (or is unreadable). */
export function readBundleStamp(file: string): BundleStamp | null {
  let head: string;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(512);
      head = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString("utf8");
    } finally { fs.closeSync(fd); }
  } catch { return null; }
  const m = STAMP_RE.exec(head);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]) as Partial<BundleStamp>;
    return typeof v.version === "string" && typeof v.commit === "string" ? { version: v.version, commit: v.commit } : null;
  } catch { return null; }
}

export type EnginePoolOptions = {
  bundlePath: string;
  workers: number;
  /** How long the workers may go without answering before this thread takes over their runs. */
  stallMs: number;
  /** The release this server was built from; the bundle must carry the same stamp. */
  expect: BundleStamp;
  log?: (message: string) => void;
};
/** What runBatch needs of its batch's context (auto-scheduler.ts TrialBatchCtx). */
export type PoolBatchCtx = Pick<TrialBatchCtx, "run" | "runHere">;
export type EnginePool = {
  /** Every run of the batch, in order (some run here, through ctx.runHere), or null when the pool is off or cannot start. */
  runBatch(batch: TrialBatch, ctx: PoolBatchCtx): TrialRun[] | null;
  close(): Promise<void>;
  readonly size: number;
  readonly disabled: boolean;
};

const FAILS_TO_DISABLE = 2;
/** Runs handed to one worker at a time: one to work on, one queued so it never waits on us. */
const PER_WORKER = 2;
const WAIT_SLICE_MS = 50;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createEnginePool(o: EnginePoolOptions): EnginePool | null {
  const log = o.log ?? ((m: string) => console.warn(m));
  const off = (why: string) => { log(`engine pool off: ${why}; the spacing trial runs inline`); return null; };
  if (!Number.isInteger(o.workers) || o.workers < 1) return off("no workers configured");
  if (!fs.existsSync(o.bundlePath)) return off(`the worker bundle is missing (${o.bundlePath})`);
  const stamp = readBundleStamp(o.bundlePath);
  if (!stamp) return off(`the worker bundle has no release stamp (${o.bundlePath})`);
  if (!o.expect.version || stamp.version !== o.expect.version || stamp.commit !== o.expect.commit) {
    return off(`the worker bundle is from another release (${stamp.version} ${stamp.commit}; this server is ${o.expect.version || "unknown"} ${o.expect.commit || "unknown"})`);
  }
  const stallMs = Math.max(0, o.stallMs);

  type Slot = { worker: Worker; port: MessagePort; dead: boolean };
  const counter = new Int32Array(new SharedArrayBuffer(4));
  const slots: Slot[] = [];
  let job = 0;
  let fails = 0;
  let disabled = false;

  const spawn = (): Slot => {
    const { port1, port2 } = new MessageChannel();
    const worker = new Worker(o.bundlePath, { workerData: { port: port2, sig: counter.buffer }, transferList: [port2] });
    const slot: Slot = { worker, port: port1, dead: false };
    worker.on("error", () => { slot.dead = true; });
    worker.on("exit", () => { slot.dead = true; });
    worker.unref();
    port1.unref();
    return slot;
  };
  const drop = (s: Slot): Promise<unknown> => { s.dead = true; s.port.close(); return s.worker.terminate().catch(() => undefined); };
  const reset = () => Promise.all(slots.splice(0).map(drop));
  const failed = (why: string, what: string) => {
    fails++;
    if (fails >= FAILS_TO_DISABLE) {
      disabled = true;
      void reset();
      log(`engine pool off for this process after ${fails} failures in a row (${why}); the spacing trial runs inline`);
    } else {
      log(`engine pool: ${why}; ${what}`);
    }
  };

  function runBatch(b: TrialBatch, ctx: PoolBatchCtx): TrialRun[] | null {
    if (disabled) return null;
    const n = b.variants.length;
    if (n === 0) return [];
    for (let i = slots.length - 1; i >= 0; i--) if (slots[i].dead) void drop(slots.splice(i, 1)[0]);
    const k = Math.min(o.workers, n);
    try {
      while (slots.length < k) slots.push(spawn());
    } catch (e) {
      void reset();
      failed(`a worker could not start: ${errText(e)}`, "this batch runs inline");
      return null;
    }
    const id = ++job;
    type Live = { slot: Slot; held: Set<number>; ok: boolean; lastAnswer: number };
    const t0 = performance.now();
    const active: Live[] = slots.slice(0, k).map((slot) => ({ slot, held: new Set(), ok: true, lastAnswer: t0 }));
    const out: (TrialRun | undefined)[] = new Array(n).fill(undefined);
    let got = 0;
    let answers = 0;
    let errors: string | null = null;
    let stalledHere = false;
    let lastWorkerAnswer = t0;
    // Runs no worker holds: the never-sent ones from `next`, and any a failed worker gave back.
    let next = 0;
    const back: number[] = [];
    const take = (): number | null => {
      while (back.length) { const i = back.shift()!; if (out[i] === undefined) return i; }
      while (next < n) { const i = next++; if (out[i] === undefined) return i; }
      return null;
    };
    const put = (idx: number, run: TrialRun) => { out[idx] = run; got++; };
    const retire = (l: Live) => {
      l.ok = false;
      for (const i of [...l.held].sort((x, y) => x - y)) if (out[i] === undefined) back.push(i);
      back.sort((x, y) => x - y);
      l.held.clear();
      void drop(l.slot);
    };
    const fill = () => {
      for (const l of active) {
        while (l.ok && l.held.size < PER_WORKER) {
          const idx = take();
          if (idx == null) return;
          try { l.slot.port.postMessage({ type: "run", job: id, idx, variant: b.variants[idx] }); l.held.add(idx); }
          catch (e) { back.push(idx); errors ??= `a run could not be sent: ${errText(e)}`; retire(l); }
        }
      }
    };

    for (const l of active) {
      try { l.slot.port.postMessage({ type: "stage", job: id, base: b.base }); }
      catch (e) { errors ??= `the batch could not be sent: ${errText(e)}`; retire(l); }
    }
    fill();
    while (got < n) {
      const seen = Atomics.load(counter, 0);
      let progressed = false;
      for (const l of active) {
        if (!l.ok) continue;
        for (let r = receiveMessageOnPort(l.slot.port); r; r = receiveMessageOnPort(l.slot.port)) {
          const m = r.message as WorkerReply;
          if (!m || m.job !== id) continue; // an answer for an earlier batch
          if ("error" in m) { errors ??= `a worker failed: ${m.error}`; retire(l); break; }
          if (!Number.isInteger(m.idx) || !l.held.has(m.idx)) { errors ??= "a worker answered out of turn"; retire(l); break; }
          l.held.delete(m.idx);
          l.lastAnswer = lastWorkerAnswer = performance.now();
          if (out[m.idx] !== undefined) continue; // already run here after a stall: the late answer is ignored
          put(m.idx, m.run);
          answers++;
          progressed = true;
        }
      }
      fill();
      if (got >= n || progressed) continue;
      // Help: a run nobody holds is run here.
      const free = take();
      if (free != null) { put(free, ctx.runHere(free)); continue; }
      const idle = performance.now() - lastWorkerAnswer;
      if (ctx.run.stalled || idle >= stallMs) {
        if (!ctx.run.stalled) {
          log(`engine pool: no answer from the workers for ${Math.round(idle)} ms; this server finishes the run's batches itself`);
          ctx.run.stalled = true;
          stalledHere = true;
        }
        // Take over the lowest unanswered run; a worker's late answer for it is ignored.
        let low = -1;
        for (let i = 0; i < n; i++) if (out[i] === undefined) { low = i; break; }
        if (low >= 0) put(low, ctx.runHere(low));
        continue;
      }
      // A short slice: a reply posted just before `seen` was read is picked up on the next pass.
      Atomics.wait(counter, 0, seen, Math.min(stallMs - idle, WAIT_SLICE_MS));
    }

    // A worker that still holds runs and has said nothing for the stall time is replaced next batch.
    const now = performance.now();
    for (const l of active) if (l.ok && l.held.size > 0 && now - l.lastAnswer >= stallMs) retire(l);
    for (let i = slots.length - 1; i >= 0; i--) if (slots[i].dead) slots.splice(i, 1);
    if (answers > 0) fails = 0;
    else if (stalledHere || errors) {
      ctx.run.inline = true;
      failed(errors ?? `no worker answered within ${stallMs} ms`, "the rest of this run is done here");
    }
    return out as TrialRun[];
  }

  return {
    runBatch,
    close: async () => { disabled = true; await reset(); },
    get size() { return o.workers; },
    get disabled() { return disabled; },
  };
}

const DEFAULT_WORKERS = 8;
// David's budget for generating a month is 10 s at most, 3 s preferred. A broken pool costs at
// most one stall per run on top of the plain loop.
const DEFAULT_STALL_MS = 1_000;
/** Settings card #281 removed: still read once at start-up, only to say they are ignored. */
export const OBSOLETE_POOL_ENV = ["YOSCHED_ENGINE_BATCH_TIMEOUT_MS", "YOSCHED_ENGINE_TRIAL_DEADLINE_MS"] as const;

/** The installed runner: each batch goes to the pool with its run's context. */
export function poolRunner(pool: Pick<EnginePool, "runBatch">): TrialBatchRunner {
  return (batch, ctx) => pool.runBatch(batch, ctx);
}

/** The pool's settings from the environment (server operations, not scheduling policy). */
export function poolOptionsFromEnv(env: Record<string, string | undefined>, expect: BundleStamp, cpus: number = os.availableParallelism()): Omit<EnginePoolOptions, "log"> & { obsolete: string[] } {
  const int = (v: string | undefined, dflt: number, min: number) => {
    if (v == null || v.trim() === "") return dflt;
    const n = Number(v);
    return Number.isInteger(n) && n >= min ? n : dflt;
  };
  return {
    bundlePath: env.YOSCHED_ENGINE_WORKER?.trim() || path.join(process.cwd(), "engine-worker.cjs"),
    workers: Math.min(int(env.YOSCHED_ENGINE_WORKERS, DEFAULT_WORKERS, 0), Math.max(0, cpus - 1)),
    stallMs: int(env.YOSCHED_ENGINE_STALL_MS, DEFAULT_STALL_MS, 0),
    expect,
    obsolete: OBSOLETE_POOL_ENV.filter((k) => (env[k] ?? "").trim() !== ""),
  };
}
