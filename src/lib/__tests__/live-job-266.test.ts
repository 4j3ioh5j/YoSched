// Card #266 slice B: a Live edit runs asynchronously (its batches on Web Workers), so the grid
// needs to know which edit is current. Only the newest job may land; cancel (Undo of the edit in
// flight, Cancel, Accept, leaving the page) drops the one in flight, and "busy" always clears.
import { describe, it, expect } from "vitest";
import { createLiveJobs, runLiveSteps, webWorkerCount } from "../live-job";
import { applyScenario, applyScenarioSteps } from "../scenario";
import { trialInput, trialRun, type TrialBatch, type TrialRun } from "../auto-scheduler";
import { fixture } from "./engine-266-fixture";

const inline = async (b: TrialBatch): Promise<TrialRun[] | null> => b.variants.map((v) => trialRun(trialInput(b.base, v)));

describe("Live jobs (card #266 slice B)", { timeout: 60_000 }, () => {
  it("a job is current until another starts or the jobs are cancelled; busy follows it", () => {
    const seen: boolean[] = [];
    const jobs = createLiveJobs((b) => seen.push(b));
    expect(jobs.busy).toBe(false);
    const a = jobs.start();
    expect(jobs.busy).toBe(true);
    expect(a.isCurrent()).toBe(true);
    const b = jobs.start();
    expect(a.isCurrent()).toBe(false);
    expect(b.isCurrent()).toBe(true);
    expect(a.finish()).toBe(false); // a stale job never clears busy for the current one
    expect(jobs.busy).toBe(true);
    expect(b.finish()).toBe(true);
    expect(jobs.busy).toBe(false);
    const c = jobs.start();
    jobs.cancel();
    expect(c.isCurrent()).toBe(false);
    expect(jobs.busy).toBe(false);
    expect(c.finish()).toBe(false);
    expect(seen).toEqual([true, false, true, false]);
  });

  it("cancel with nothing running does not report busy changes", () => {
    const seen: boolean[] = [];
    const jobs = createLiveJobs((b) => seen.push(b));
    jobs.cancel();
    expect(seen).toEqual([]);
  });

  it("runLiveSteps gives the same outcome as the synchronous applyScenario", async () => {
    const input = fixture();
    const jobs = createLiveJobs();
    const out = await runLiveSteps(jobs, () => applyScenarioSteps(input, [], []), inline);
    expect(out).not.toBeNull();
    expect(JSON.stringify(out)).toBe(JSON.stringify(applyScenario(input, [], [])));
    expect(jobs.busy).toBe(false);
  });

  it("a job cancelled mid-run resolves null and leaves the jobs idle", async () => {
    const input = fixture();
    const jobs = createLiveJobs();
    let calls = 0;
    const run = async (b: TrialBatch) => { calls++; if (calls === 1) jobs.cancel(); return inline(b); };
    const out = await runLiveSteps(jobs, () => applyScenarioSteps(input, [], []), run);
    expect(calls).toBeGreaterThan(0);
    expect(out).toBeNull();
    expect(jobs.busy).toBe(false);
  });

  it("a newer job supersedes an older one: only the newer lands, busy clears once", async () => {
    const input = fixture();
    const seen: boolean[] = [];
    const jobs = createLiveJobs((b) => seen.push(b));
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const slow = async (b: TrialBatch) => { await gate; return inline(b); };
    const first = runLiveSteps(jobs, () => applyScenarioSteps(input, [], []), slow);
    const second = runLiveSteps(jobs, () => applyScenarioSteps(input, [], []), inline);
    expect(await second).not.toBeNull();
    release();
    expect(await first).toBeNull();
    expect(jobs.busy).toBe(false);
    expect(seen.filter((b) => !b).length).toBe(1);
  });

  it("an engine error clears busy and rethrows", async () => {
    const jobs = createLiveJobs();
    function* broken(): Generator<TrialBatch, never, TrialRun[]> { throw new Error("engine bug"); }
    await expect(runLiveSteps(jobs, broken, inline)).rejects.toThrow("engine bug");
    expect(jobs.busy).toBe(false);
  });

  it("a runner that fails (null or throws) falls back here with the same outcome", async () => {
    const input = fixture();
    const jobs = createLiveJobs();
    const out1 = await runLiveSteps(jobs, () => applyScenarioSteps(input, [], []), async () => null);
    const out2 = await runLiveSteps(jobs, () => applyScenarioSteps(input, [], []), async () => { throw new Error("worker died"); });
    const want = JSON.stringify(applyScenario(input, [], []));
    expect(JSON.stringify(out1)).toBe(want);
    expect(JSON.stringify(out2)).toBe(want);
  });

  it("uses one core fewer than the browser has, at most 8, none on a one-core or unknown device", () => {
    expect(webWorkerCount(undefined)).toBe(0);
    expect(webWorkerCount(1)).toBe(0);
    expect(webWorkerCount(2)).toBe(1);
    expect(webWorkerCount(4)).toBe(3);
    expect(webWorkerCount(16)).toBe(8);
    expect(webWorkerCount(Number.NaN)).toBe(0);
  });
});
