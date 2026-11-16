// Card #266: the worker thread's entry point. scripts/build-engine-worker.mjs bundles this file
// (with the engine) into .next/standalone/engine-worker.cjs. The pool hands each worker its own
// message port and a shared counter; after every reply the worker bumps the counter and wakes
// the pool, which waits on it with Atomics.wait (see engine-pool.ts).
import { workerData, type MessagePort } from "node:worker_threads";
import { createTrialWorkerHandler, type WorkerMessage } from "./engine-worker-core";

const { port, sig } = workerData as { port: MessagePort; sig: SharedArrayBuffer };
const counter = new Int32Array(sig);
const handle = createTrialWorkerHandler();
port.on("message", (m: WorkerMessage) => {
  const reply = handle(m);
  if (!reply) return;
  port.postMessage(reply);
  Atomics.add(counter, 0, 1);
  Atomics.notify(counter, 0);
});
