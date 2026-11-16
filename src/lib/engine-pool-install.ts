// Card #266: server start-up (src/instrumentation.ts) builds the engine pool and hands its batch
// runner to the auto-scheduler. Anything that stops the pool (no bundle, other release, no
// workers) leaves no runner installed: the spacing trial runs inline, as before.
import os from "node:os";
import { setTrialBatchRunner } from "./auto-scheduler";
import { createEnginePool, poolOptionsFromEnv, poolRunner, type BundleStamp, type EnginePool } from "./engine-pool";

export function installEnginePool(
  env: Record<string, string | undefined>,
  release: BundleStamp,
  log: (message: string) => void = console.log,
  cpus: number = os.availableParallelism(),
): EnginePool | null {
  const { obsolete, ...opts } = poolOptionsFromEnv(env, release, cpus);
  // Card #281: the batch time limit and the trial deadline are gone (the stall takeover replaces them).
  for (const k of obsolete) log(`engine pool: ${k} is no longer used (card #281: the server takes over after YOSCHED_ENGINE_STALL_MS instead)`);
  const pool = createEnginePool({ ...opts, log });
  if (!pool) return null;
  setTrialBatchRunner(poolRunner(pool));
  log(`engine pool: ${pool.size} workers (stall ${opts.stallMs} ms)`);
  return pool;
}
