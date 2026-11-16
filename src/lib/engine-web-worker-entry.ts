// Card #266 slice B: the browser Web Worker's entry point. scripts/build-engine-worker.mjs bundles
// this file (with the engine) into public/engine-worker-<commit>.js, and defines the release
// stamp below. The worker says hello with it first; the page's pool (engine-web-pool.ts) uses
// only a worker from its own release.
import { createTrialWorkerHandler, type WorkerMessage } from "./engine-worker-core";

declare const __YOSCHED_ENGINE_STAMP__: { version: string; commit: string };
type Scope = { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null };
const scope = self as unknown as Scope;
const handle = createTrialWorkerHandler();
scope.onmessage = (e) => {
  const reply = handle(e.data as WorkerMessage);
  if (reply) scope.postMessage(reply);
};
scope.postMessage({ type: "hello", ...__YOSCHED_ENGINE_STAMP__ });
