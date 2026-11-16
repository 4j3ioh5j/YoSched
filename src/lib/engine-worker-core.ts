// Card #266: what one engine worker does with a message from the pool (src/lib/engine-pool.ts).
// Kept apart from the thread wiring (engine-worker-entry.ts) so the protocol is tested directly.
//
//   { type: "stage", job, base }        hold this batch's base input (sent once per worker per batch)
//   { type: "run", job, idx, variant }  run one candidate of that batch
//                                       → { job, idx, run } or { job, idx, error }
// A run for a batch the worker does not hold is refused: it never runs on another batch's base.
import { trialRun, trialInput, type AutoScheduleInput, type TrialRun, type TrialVariant } from "./auto-scheduler";

export type WorkerMessage =
  | { type: "stage"; job: number; base: AutoScheduleInput }
  | { type: "run"; job: number; idx: number; variant: TrialVariant };
export type WorkerReply = { job: number; idx: number; run: TrialRun } | { job: number; idx: number; error: string };

export function createTrialWorkerHandler(): (m: WorkerMessage) => WorkerReply | undefined {
  let job = -1;
  let base: AutoScheduleInput | null = null;
  return (m) => {
    if (m.type === "stage") {
      job = m.job;
      base = m.base;
      return undefined;
    }
    if (m.job !== job || !base) return { job: m.job, idx: m.idx, error: `stale stage: this worker holds batch ${job}` };
    try {
      return { job: m.job, idx: m.idx, run: trialRun(trialInput(base, m.variant)) };
    } catch (e) {
      return { job: m.job, idx: m.idx, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    }
  };
}
