// Card #266: a pool of worker threads for the spacing trial (server only; node built-ins only).
//
// The trial (auto-scheduler.ts spacingTrialSteps) is a sequence of batches whose candidate runs
// all start from one base and do not depend on each other. runBatch sends the base to each worker
// once, hands out the candidates one at a time, and returns the runs in the candidates' order,
// so the trial picks exactly what the plain loop picks.
//
// runBatch is SYNCHRONOUS: the caller (autoSchedule, and through it applyScenario and request
// approval) stays a plain function. It waits on a shared counter with Atomics.wait, which Node
// allows on its main thread, and reads replies with receiveMessageOnPort. The server's event loop
// is blocked for the batch, as it already was for the whole trial before; it is just shorter now.
//
// Anything unexpected (no bundle, a bundle from another release, a worker that throws, dies or
// does not answer within the batch time limit) returns null, and the caller runs that batch
// inline: slower, never different. Two failures in a row turn the pool off for the process.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker, MessageChannel, receiveMessageOnPort, type MessagePort } from "node:worker_threads";
import type { TrialBatch, TrialBatchRunner, TrialRun } from "./auto-scheduler";
import type { WorkerMessage, WorkerReply } from "./engine-worker-core";

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
  /** How long one batch may take before it is given up and run inline. */
  batchTimeoutMs: number;
  /** The release this server was built from; the bundle must carry the same stamp. */
  expect: BundleStamp;
  log?: (message: string) => void;
};
export type EnginePool = {
  /** `timeoutMs` (when shorter) replaces the pool's batch time limit for this batch. */
  runBatch(batch: TrialBatch, timeoutMs?: number): TrialRun[] | null;
  close(): Promise<void>;
  readonly size: number;
  readonly disabled: boolean;
};

const FAILS_TO_DISABLE = 2;
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
  const fail = (why: string): null => {
    void reset();
    fails++;
    if (fails >= FAILS_TO_DISABLE) {
      disabled = true;
      log(`engine pool off for this process after ${fails} failures in a row (${why}); the spacing trial runs inline`);
    } else {
      log(`engine pool: ${why}; this batch runs inline`);
    }
    return null;
  };

  function runBatch(b: TrialBatch, timeoutMs?: number): TrialRun[] | null {
    if (disabled) return null;
    const n = b.variants.length;
    if (n === 0) return [];
    for (let i = slots.length - 1; i >= 0; i--) if (slots[i].dead) void drop(slots.splice(i, 1)[0]);
    const k = Math.min(o.workers, n);
    try {
      while (slots.length < k) slots.push(spawn());
    } catch (e) { return fail(`a worker could not start: ${errText(e)}`); }
    const active = slots.slice(0, k);
    const id = ++job;
    const limitMs = timeoutMs != null && timeoutMs > 0 ? Math.min(timeoutMs, o.batchTimeoutMs) : o.batchTimeoutMs;
    const deadline = performance.now() + limitMs;
    const out: (TrialRun | undefined)[] = new Array(n).fill(undefined);
    let got = 0;
    let next = 0;
    const send = (s: Slot, m: WorkerMessage) => s.port.postMessage(m);
    const sendNext = (s: Slot) => { if (next < n) { const idx = next++; send(s, { type: "run", job: id, idx, variant: b.variants[idx] }); } };
    try {
      for (const s of active) send(s, { type: "stage", job: id, base: b.base });
      for (const s of active) sendNext(s);
      while (got < n) {
        const seen = Atomics.load(counter, 0);
        let progressed = false;
        for (const s of active) {
          for (let r = receiveMessageOnPort(s.port); r; r = receiveMessageOnPort(s.port)) {
            const m = r.message as WorkerReply;
            if (m.job !== id) continue; // an answer for an earlier batch
            if ("error" in m) return fail(`a worker failed: ${m.error}`);
            if (!Number.isInteger(m.idx) || m.idx < 0 || m.idx >= n || out[m.idx] !== undefined) return fail("a worker answered out of turn");
            out[m.idx] = m.run;
            got++;
            progressed = true;
            sendNext(s);
          }
        }
        if (got >= n || progressed) continue;
        const left = deadline - performance.now();
        if (left <= 0) return fail(`no answer within the batch time limit (${Math.round(limitMs)} ms)`);
        // A short slice: a reply posted just before `seen` was read is picked up on the next pass.
        Atomics.wait(counter, 0, seen, Math.min(left, WAIT_SLICE_MS));
      }
    } catch (e) { return fail(`the batch could not be sent: ${errText(e)}`); }
    fails = 0;
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
// David's budget for generating a month is 10 s at most. A hung or broken pool waits at most the
// trial deadline in total before every remaining batch runs inline (a batch the pool gives up on
// reruns inline too), so the deadline plus an inline trial stays near that budget.
const DEFAULT_BATCH_TIMEOUT_MS = 3_000;
const DEFAULT_TRIAL_DEADLINE_MS = 6_000;

/**
 * The installed runner: one run's batches go to the pool until `trialDeadlineMs` after the run
 * started; each gets the pool's batch limit or the time left, whichever is less. After that, null:
 * the rest of the run's batches run inline (the same result).
 */
export function deadlineRunner(
  pool: Pick<EnginePool, "runBatch">,
  o: { batchTimeoutMs: number; trialDeadlineMs: number },
  now: () => number = () => performance.now(),
): TrialBatchRunner {
  return (batch, { startedAt }) => {
    const left = o.trialDeadlineMs - (now() - startedAt);
    if (left <= 0) return null;
    return pool.runBatch(batch, Math.min(o.batchTimeoutMs, left));
  };
}

/** The pool's settings from the environment (server operations, not scheduling policy). */
export function poolOptionsFromEnv(env: Record<string, string | undefined>, expect: BundleStamp, cpus: number = os.availableParallelism()): Omit<EnginePoolOptions, "log"> & { trialDeadlineMs: number } {
  const int = (v: string | undefined, dflt: number, min: number) => {
    if (v == null || v.trim() === "") return dflt;
    const n = Number(v);
    return Number.isInteger(n) && n >= min ? n : dflt;
  };
  return {
    bundlePath: env.YOSCHED_ENGINE_WORKER?.trim() || path.join(process.cwd(), "engine-worker.cjs"),
    workers: Math.min(int(env.YOSCHED_ENGINE_WORKERS, DEFAULT_WORKERS, 0), Math.max(0, cpus - 1)),
    batchTimeoutMs: int(env.YOSCHED_ENGINE_BATCH_TIMEOUT_MS, DEFAULT_BATCH_TIMEOUT_MS, 1),
    trialDeadlineMs: int(env.YOSCHED_ENGINE_TRIAL_DEADLINE_MS, DEFAULT_TRIAL_DEADLINE_MS, 1),
    expect,
  };
}
