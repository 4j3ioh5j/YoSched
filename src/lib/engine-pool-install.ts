// Card #266: server start-up (src/instrumentation.ts) builds the engine pool and hands its batch
// runner to the auto-scheduler. Anything that stops the pool (no bundle, other release, no
// workers) leaves no runner installed: the spacing trial runs inline, as before.
import os from "node:os";
import { setTrialBatchRunner } from "./auto-scheduler";
import { createEnginePool, poolOptionsFromEnv, type BundleStamp, type EnginePool } from "./engine-pool";

export function installEnginePool(
  env: Record<string, string | undefined>,
  release: BundleStamp,
  log: (message: string) => void = console.log,
  cpus: number = os.availableParallelism(),
): EnginePool | null {
  const pool = createEnginePool({ ...poolOptionsFromEnv(env, release, cpus), log });
  if (!pool) return null;
  setTrialBatchRunner((b) => pool.runBatch(b));
  log(`engine pool: ${pool.size} workers`);
  return pool;
}
