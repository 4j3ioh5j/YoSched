// Card #266: the spacing trial's candidate runs on a pool of worker threads, with the same result
// as the plain loop, and an inline run whenever the pool is missing, stale, broken or slow.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { autoSchedule, setTrialBatchRunner, trialRun, trialInput, spacingTrialSteps, type AutoScheduleInput, type ScheduleStaff, type TrialBatch, type TrialRun } from "../auto-scheduler";
import { createEnginePool, readBundleStamp, stampBanner, type EnginePool } from "../engine-pool";
import { createTrialWorkerHandler } from "../engine-worker-core";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const ELIG = ["st-or", "st-off", "st-orl", "st-hol", "st-al"];
const staff = (id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ELIG, availabilityRules: avail([1, 2, 3, 4, 5]),
  isActive: true, isAutoScheduled: true, specialQualifications: [], ...o,
});
const shift = (id: string, code: string, o: Partial<TestShift> = {}): TestShift => ({
  id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
  countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
  sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
  ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
});
const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = shift("st-or", "OR", { schedulePriority: 30, isFillShift: true });
const HOL = shift("st-hol", "HOL", { isLeave: true, autoSchedulable: false, defaultHoursHoliday: 8 });
const AL = shift("st-al", "AL", { isLeave: true, autoSchedulable: false });
const req = (shiftTypeId: string, code: string, min: number, max: number | null = null) =>
  ["1", "2", "3", "4", "5"].map((dayKey) => ({ shiftTypeId, shiftCode: code, dayKey, minCount: min, preferredCount: min, maxCount: max }));
const D = (n: number) => new Date(Date.parse("2025-05-12T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const weekdays = (n: number) => Array.from({ length: n }, (_, i) => D(i)).filter((d) => ![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay()));
const PPS = [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }, { startDate: "2025-05-25", endDate: "2025-06-07", targetHours: 80 }];
const LIVE = ["hardLimits", "coverage", "underHours", "requests", "spacing", "overHours", "fairness"].map((key, i) => ({ key, sortOrder: i, enabled: true, ...(key === "underHours" ? { hoursPolicy: "prohibited" as const } : {}) }));

/** Two marked shifts, so the trial has an off run and two candidate batches. */
function fixture(days = 20): AutoScheduleInput {
  const ORL = shift("st-orl", "ORL", { defaultHours: 12, schedulePriority: 25, spreadOverMonth: true });
  const ORC = shift("st-orc", "ORC", { defaultHours: 10, schedulePriority: 27, spreadOverMonth: true });
  return withDayCaps({
    dates: weekdays(days),
    staff: ["a", "b", "c", "d", "e", "f"].map((id) => staff(id, { eligibleShiftTypeIds: [...ELIG, "st-orc"] })),
    shiftTypes: [OR, OFF, ORL, ORC, HOL, AL],
    existingAssignments: [],
    payPeriods: PPS,
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [],
    staffingRequirements: [...req("st-or", "OR", 1), ...req("st-orl", "ORL", 2, 2), ...req("st-orc", "ORC", 1, 1)],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3, holidayShiftId: "st-hol" },
    equityFactors: [], followRules: [],
    factorOrder: LIVE,
  });
}

const STAMP = { version: "9.9.9", commit: "abc1234" };
let dir = "";
let bundle = "";
const pools: EnginePool[] = [];
const logs: string[] = [];
function pool(o: Partial<Parameters<typeof createEnginePool>[0]> = {}): EnginePool | null {
  const p = createEnginePool({ bundlePath: bundle, workers: 2, batchTimeoutMs: 20_000, expect: STAMP, log: (m) => logs.push(m), ...o });
  if (p) pools.push(p);
  return p;
}
/** A hand-written worker script (stamped like a real bundle) for the failure paths. */
function fakeWorker(name: string, body: string, stamp = STAMP): string {
  const f = path.join(dir, name);
  fs.writeFileSync(f, `${stampBanner(stamp)}\nconst { workerData } = require("node:worker_threads");\nconst port = workerData.port; const sig = new Int32Array(workerData.sig);\nconst reply = (m) => { port.postMessage(m); Atomics.add(sig, 0, 1); Atomics.notify(sig, 0); };\nlet job = -1;\n${body}\n`);
  return f;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "yosched-pool-"));
  bundle = path.join(dir, "engine-worker.cjs");
  await build({
    entryPoints: [path.resolve(__dirname, "../engine-worker-entry.ts")],
    bundle: true, platform: "node", format: "cjs", target: "node22", outfile: bundle, logLevel: "silent",
    banner: { js: stampBanner(STAMP) },
  });
}, 60_000);
afterAll(async () => {
  setTrialBatchRunner(null);
  for (const p of pools) await p.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const sig = (r: ReturnType<typeof autoSchedule>) => JSON.stringify([r.suggestions, r.warnings, r.quality]);

describe("engine pool (card #266)", { timeout: 60_000 }, () => {
  it("the fixture really runs a trial with candidate batches", () => {
    const steps = spacingTrialSteps(fixture());
    const first = steps.next();
    expect(first.done).toBe(false);
    const sizes: number[] = [];
    let s = first;
    while (!s.done) { sizes.push(s.value.variants.length); s = steps.next(s.value.variants.map((v) => trialRun(trialInput((s as { value: TrialBatch }).value.base, v)))); }
    expect(sizes[0]).toBe(1);
    expect(sizes.slice(1).some((n) => n > 1)).toBe(true);
  });

  it("gives exactly the result of the plain loop, through a real worker bundle", () => {
    const input = fixture();
    const plain = autoSchedule(input);
    const p = pool();
    expect(p).not.toBeNull();
    let batches = 0;
    setTrialBatchRunner((b) => { batches++; return p!.runBatch(b); });
    try {
      const par = autoSchedule(input);
      expect(sig(par)).toBe(sig(plain));
      expect(batches).toBeGreaterThan(0);
      expect(p!.disabled).toBe(false);
    } finally { setTrialBatchRunner(null); }
  }, 60_000);

  it("never sends the off run (one variant) to the pool", () => {
    const sizes: number[] = [];
    setTrialBatchRunner((b) => { sizes.push(b.variants.length); return null; });
    try { autoSchedule(fixture()); } finally { setTrialBatchRunner(null); }
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((n) => n > 1)).toBe(true);
  });

  it("a runner that gives up (null) leaves the plain result", () => {
    const input = fixture();
    const plain = autoSchedule(input);
    setTrialBatchRunner(() => null);
    try { expect(sig(autoSchedule(input))).toBe(sig(plain)); } finally { setTrialBatchRunner(null); }
  });

  it("counts the batches the runner did and the ones that ran inline (for the generate log)", () => {
    const input = fixture();
    const none = { pooled: 0, inline: 0 };
    autoSchedule(input, { trialStats: none });
    expect(none.pooled).toBe(0);
    expect(none.inline).toBeGreaterThan(1); // the off run plus the candidate batches
    const ok = { pooled: 0, inline: 0 };
    setTrialBatchRunner((b) => b.variants.map((v) => trialRun(trialInput(b.base, v))));
    try { autoSchedule(input, { trialStats: ok }); } finally { setTrialBatchRunner(null); }
    expect(ok.inline).toBe(1); // only the off run
    expect(ok.pooled).toBe(none.inline - 1);
    const gaveUp = { pooled: 0, inline: 0 };
    setTrialBatchRunner(() => null);
    try { autoSchedule(input, { trialStats: gaveUp }); } finally { setTrialBatchRunner(null); }
    expect(gaveUp).toEqual(none);
  });

  it("a runner that returns the wrong number of runs is refused, not trusted", () => {
    const input = fixture();
    const plain = autoSchedule(input);
    setTrialBatchRunner((b) => b.variants.slice(1).map((v) => trialRun(trialInput(b.base, v))));
    try { expect(sig(autoSchedule(input))).toBe(sig(plain)); } finally { setTrialBatchRunner(null); }
  });

  it("is not built when the bundle is missing", () => {
    logs.length = 0;
    expect(pool({ bundlePath: path.join(dir, "nope.cjs") })).toBeNull();
    expect(logs.join("\n")).toMatch(/missing/);
  });

  it("is not built when the bundle is from another release", () => {
    logs.length = 0;
    expect(pool({ expect: { version: "9.9.9", commit: "fff0000" } })).toBeNull();
    expect(pool({ expect: { version: "1.0.0", commit: "abc1234" } })).toBeNull();
    expect(logs.join("\n")).toMatch(/another release/);
  });

  it("is not built when the bundle has no stamp, or the release is unknown", () => {
    const f = path.join(dir, "nostamp.cjs");
    fs.writeFileSync(f, "// no stamp\n");
    expect(readBundleStamp(f)).toBeNull();
    expect(pool({ bundlePath: f })).toBeNull();
    expect(pool({ expect: { version: "", commit: "" } })).toBeNull();
  });

  it("is not built with zero workers", () => {
    expect(pool({ workers: 0 })).toBeNull();
  });

  it("puts each run back in its candidate's place, whatever order the workers answer in", () => {
    // Each answer is the variant's own minGapDays, after a delay that reverses the order.
    const f = fakeWorker("order.cjs", `port.on("message", (m) => {
      if (m.type === "stage") { job = m.job; return; }
      setTimeout(() => reply({ job: m.job, idx: m.idx, run: { n: m.variant.minGapDays } }), 200 - m.variant.minGapDays * 20);
    });`);
    const p = pool({ bundlePath: f, workers: 3 })!;
    const variants = [2, 3, 4, 5, 6].map((n) => ({ shiftTypeId: "s", minGapDays: n, minGapStrength: "rule" as const }));
    const out = p.runBatch({ base: fixture(), variants }) as unknown as { n: number }[];
    expect(out.map((r) => r.n)).toEqual([2, 3, 4, 5, 6]);
  });

  it("a worker that throws makes the batch run inline, and is reported", () => {
    logs.length = 0;
    const f = fakeWorker("throw.cjs", `port.on("message", (m) => {
      if (m.type === "stage") { job = m.job; return; }
      reply({ job: m.job, idx: m.idx, error: "boom" });
    });`);
    const p = pool({ bundlePath: f })!;
    const input = fixture();
    const plain = autoSchedule(input);
    setTrialBatchRunner((b) => p.runBatch(b));
    try { expect(sig(autoSchedule(input))).toBe(sig(plain)); } finally { setTrialBatchRunner(null); }
    expect(logs.join("\n")).toMatch(/boom/);
    expect(p.disabled).toBe(true); // two failures in a row turn it off for this process
  });

  it("a worker that dies makes the batch run inline within the time limit", () => {
    const f = fakeWorker("die.cjs", `port.on("message", (m) => { if (m.type !== "stage") process.exit(3); });`);
    const p = pool({ bundlePath: f, batchTimeoutMs: 1_500 })!;
    const t = performance.now();
    expect(p.runBatch({ base: fixture(), variants: [{ shiftTypeId: "s", minGapDays: 2, minGapStrength: "rule" }, null] })).toBeNull();
    expect(performance.now() - t).toBeLessThan(5_000);
  });

  it("a worker that hangs makes the batch run inline after the batch time limit", () => {
    logs.length = 0;
    const f = fakeWorker("hang.cjs", `port.on("message", () => {});`);
    const p = pool({ bundlePath: f, batchTimeoutMs: 400 })!;
    const t = performance.now();
    expect(p.runBatch({ base: fixture(), variants: [null, null] })).toBeNull();
    const ms = performance.now() - t;
    expect(ms).toBeGreaterThanOrEqual(350);
    expect(ms).toBeLessThan(3_000);
    expect(logs.join("\n")).toMatch(/time limit/);
  });

  it("ignores an answer that belongs to an earlier batch", () => {
    // The worker answers every variant twice: once tagged with an older job (must be dropped).
    const f = fakeWorker("stale.cjs", `port.on("message", (m) => {
      if (m.type === "stage") { job = m.job; return; }
      reply({ job: m.job - 1, idx: m.idx, run: { n: -1 } });
      reply({ job: m.job, idx: m.idx, run: { n: m.idx } });
    });`);
    const p = pool({ bundlePath: f })!;
    const out = p.runBatch({ base: fixture(), variants: [null, null, null] }) as unknown as { n: number }[];
    expect(out.map((r) => r.n)).toEqual([0, 1, 2]);
  });
});

describe("worker handler (card #266)", () => {
  it("refuses a variant for a batch it does not hold", () => {
    const h = createTrialWorkerHandler();
    expect(h({ type: "run", job: 1, idx: 0, variant: null })).toEqual({ job: 1, idx: 0, error: "stale stage: this worker holds batch -1" });
    h({ type: "stage", job: 2, base: fixture(6) });
    expect(h({ type: "run", job: 1, idx: 0, variant: null })).toMatchObject({ job: 1, idx: 0, error: expect.stringMatching(/stale stage/) });
  });

  it("runs a variant on the batch's base", () => {
    const h = createTrialWorkerHandler();
    const base = fixture(6);
    h({ type: "stage", job: 5, base });
    const out = h({ type: "run", job: 5, idx: 3, variant: null }) as { job: number; idx: number; run: TrialRun };
    expect(out.job).toBe(5);
    expect(out.idx).toBe(3);
    expect(JSON.stringify(out.run.result.suggestions)).toBe(JSON.stringify(trialRun(base).result.suggestions));
  });

  it("reports an engine error instead of dying", () => {
    const h = createTrialWorkerHandler();
    h({ type: "stage", job: 1, base: { broken: true } as unknown as AutoScheduleInput });
    expect(h({ type: "run", job: 1, idx: 0, variant: null })).toMatchObject({ job: 1, idx: 0, error: expect.any(String) });
  });
});
