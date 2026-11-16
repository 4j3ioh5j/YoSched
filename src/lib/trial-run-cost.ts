// Card #287: the cost book of one run (one autoSchedule call, one Live edit). Every run done on
// this thread is timed, which gives what a run costs here; each pool batch is then compared with
// the same runs done here. `behindMs` is how far the run's pool batches are behind the plain loop,
// the current batch included. Once that reaches the stall time the pool takes over as after a
// stall, so workers that answer slowly but steadily (each answer just inside the stall time) cost
// at most one stall per run, while a pool that keeps up banks the time it saves.
import type { TrialRun, TrialRunState } from "./auto-scheduler";

/** Runs `f` here and records its time on the run's state. */
export function runTimed(run: TrialRunState, f: () => TrialRun): TrialRun {
  const t = performance.now();
  const r = f();
  run.hereMs = (run.hereMs ?? 0) + (performance.now() - t);
  run.hereRuns = (run.hereRuns ?? 0) + 1;
  return r;
}

/** What one run costs here, on average so far in this run; null before any run was done here. */
export const hereCost = (run: TrialRunState): number | null => (run.hereRuns ? (run.hereMs ?? 0) / run.hereRuns : null);

/**
 * How far behind the plain loop the run's pool batches are, counting the current batch of `n` runs
 * after `batchMs`; null while the cost of a run here is unknown (then only the plain stall applies).
 */
export function behindMs(run: TrialRunState, n: number, batchMs: number): number | null {
  const c = hereCost(run);
  return c == null ? null : (run.lostMs ?? 0) + batchMs - n * c;
}

/** Books a finished pool batch of `n` runs that took `batchMs`. */
export function settleBatch(run: TrialRunState, n: number, batchMs: number): void {
  const b = behindMs(run, n, batchMs);
  if (b != null) run.lostMs = b;
}
