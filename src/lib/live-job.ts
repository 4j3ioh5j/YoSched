// Card #266 slice B: Live edits run asynchronously (their engine batches on Web Workers), so the
// grid needs one rule for which result may land: only the newest job's. Starting a job makes every
// earlier one stale; cancel() (Undo of the edit in flight, Cancel, Accept, leaving the page) makes
// the one in flight stale too. `busy` is true while the current job runs and always clears, on
// success, on a stale finish of the current job, on cancel, and when the engine throws.
import type { TrialBatch, TrialRun, TrialRunState } from "./auto-scheduler";
import { runStepsAsync } from "./scenario";

export type LiveJob = {
  isCurrent(): boolean;
  /** Ends this job; true when it was still the current one (busy then clears). */
  finish(): boolean;
};
export type LiveJobs = {
  start(): LiveJob;
  cancel(): void;
  readonly busy: boolean;
};

export function createLiveJobs(onBusy: (busy: boolean) => void = () => {}): LiveJobs {
  let gen = 0;
  let busy = false;
  const setBusy = (b: boolean) => { if (busy !== b) { busy = b; onBusy(b); } };
  return {
    start() {
      const mine = ++gen;
      setBusy(true);
      return {
        isCurrent: () => mine === gen,
        finish: () => {
          if (mine !== gen) return false;
          setBusy(false);
          return true;
        },
      };
    },
    cancel() { gen++; setBusy(false); },
    get busy() { return busy; },
  };
}

/**
 * Runs one Live edit's steps as the current job: resolves to its outcome, or null when a newer
 * job or a cancel made it stale. Batches the runner gives up on run here (runStepsAsync), so the
 * outcome is always the synchronous one.
 */
export async function runLiveSteps<R>(
  jobs: LiveJobs,
  steps: () => Generator<TrialBatch, R, TrialRun[]>,
  run: (batch: TrialBatch, ctx: { run: TrialRunState; isCurrent: () => boolean }) => Promise<TrialRun[] | null>,
): Promise<R | null> {
  const job = jobs.start();
  try {
    const r = await runStepsAsync(steps(), run, job.isCurrent);
    return r.ok && job.isCurrent() ? r.value : null;
  } finally {
    job.finish();
  }
}

/** Web Workers for Live edits: one core fewer than the device has (the page keeps one), at most 8. */
export function webWorkerCount(hardwareConcurrency: number | undefined): number {
  const n = Math.floor(Number(hardwareConcurrency)) - 1;
  return Number.isFinite(n) ? Math.max(0, Math.min(8, n)) : 0;
}
